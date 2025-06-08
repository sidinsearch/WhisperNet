import React, { useState, useRef, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import FingerprintJS from '@fingerprintjs/fingerprintjs';

const BASE_NODE_URL = process.env.REACT_APP_BASE_NODE_URL || "http://localhost:5000";

// Initialize the fingerprint agent
const fpPromise = FingerprintJS.load();

function App() {
  const [username, setUsername] = useState('');
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Checking relay status...');
  const [deviceId, setDeviceId] = useState('');
  const [connectionDetails, setConnectionDetails] = useState({});
  const [showConnectionInfo, setShowConnectionInfo] = useState(false);
  const [securityAlert, setSecurityAlert] = useState(null);
  const [typing, setTyping] = useState(false);
  const [relayServerUrl, setRelayServerUrl] = useState('Unknown');
  const [relayStatus, setRelayStatus] = useState('checking');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [recipientStatus, setRecipientStatus] = useState({ exists: false, online: false });
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState(true);
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);

  // Get device fingerprint on component mount
  useEffect(() => {
    const getDeviceId = async () => {
      try {
        const fp = await fpPromise;
        const result = await fp.get();
        setDeviceId(result.visitorId);
      } catch (error) {
        console.error('Failed to get device fingerprint:', error);
        // Generate a fallback device ID
        setDeviceId('fallback-' + Math.random().toString(36).substr(2, 9));
      }
    };
    getDeviceId();
  }, []);

  // Check relay status on initial load
  useEffect(() => {
    if (deviceId) {
      checkRelayStatus();
    }
  }, [deviceId]);

  // Function to check relay status
  const checkRelayStatus = async () => {
    setStatus('Checking base node status...');
    setRelayStatus('checking');
    
    try {
      // First try HTTP health check
      const response = await axios.get(`${BASE_NODE_URL}/health`, { 
        timeout: 5000 
      });
      
      if (response.status === 200) {
        setRelayStatus('online');
        setStatus('Base node online. Please login.');
        return;
      }
    } catch (error) {
      console.log('HTTP health check failed, trying socket connection:', error.message);
    }
    
    // Fallback to socket connection test
    const tempSocket = io(BASE_NODE_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 2,
      reconnectionDelay: 1000,
      timeout: 5000,
      forceNew: true
    });
    
    const connectionTimeout = setTimeout(() => {
      setRelayStatus('timeout');
      setStatus('Connection timeout. Base node may be offline.');
      tempSocket.disconnect();
    }, 8000);
    
    tempSocket.on('connect', () => {
      clearTimeout(connectionTimeout);
      setRelayStatus('online');
      setStatus('Base node online. Please login.');
      tempSocket.disconnect();
    });
    
    tempSocket.on('connect_error', (err) => {
      clearTimeout(connectionTimeout);
      console.error('Socket connection error:', err);
      setRelayStatus('offline');
      setStatus('Base node offline. Please try again later.');
      tempSocket.disconnect();
    });
  };

  // Main socket connection effect
  useEffect(() => {
    if (connected && username && deviceId) {
      connectToBaseNode();
    }
    
    return () => {
      if (socketRef.current) {
        clearInterval(pingIntervalRef.current);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [connected, username, deviceId]);

  const connectToBaseNode = () => {
    // Clear any previous connection
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    
    console.log('Connecting to base node:', BASE_NODE_URL);
    setStatus('Connecting to base node...');
    
    socketRef.current = io(BASE_NODE_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      query: { 
        deviceId,
        username 
      },
      forceNew: true
    });
    
    // Connection event handlers
    socketRef.current.on('connect', () => {
      console.log('Connected to base node with socket ID:', socketRef.current.id);
      setStatus('Connected to base node');
      setConnectionDetails({
        socketId: socketRef.current.id,
        transport: socketRef.current.io.engine.transport.name,
        baseNodeUrl: BASE_NODE_URL
      });
      
      // Register with base node
      socketRef.current.emit('registerUser', { 
        username, 
        deviceId 
      }, (response) => {
        console.log('Registration response:', response);
        if (response && response.success) {
          setStatus('Registered successfully');
          
          // Get initial data
          getOnlineUsers();
          startPingInterval();
          
        } else {
          const errorMsg = response?.reason || 'Registration failed';
          setStatus(`Registration failed: ${errorMsg}`);
          setSecurityAlert({
            username: username,
            message: `Registration failed: ${errorMsg}`
          });
        }
      });
    });
    
    socketRef.current.on('connect_error', (err) => {
      console.error('Base node connection error:', err);
      setStatus(`Connection failed: ${err.message}`);
      setRelayStatus('offline');
    });
    
    socketRef.current.on('disconnect', (reason) => {
      console.log('Disconnected from base node:', reason);
      setStatus(`Disconnected: ${reason}`);
      setRelayStatus('offline');
      clearInterval(pingIntervalRef.current);
      
      // Don't auto-reconnect if user manually disconnected
      if (reason !== 'io client disconnect') {
        setTimeout(() => {
          if (connected) {
            connectToBaseNode();
          }
        }, 3000);
      }
    });
    
    // Message handling
    socketRef.current.on('message', (data) => {
      console.log('Received message:', data);
      const { from, message, fromDeviceId, timestamp } = data;
      
      // Security check for device ID changes
      const previousMessages = messages.filter(msg => msg.from === from);
      if (previousMessages.length > 0 && previousMessages[0].fromDeviceId && 
          previousMessages[0].fromDeviceId !== fromDeviceId) {
        setSecurityAlert({
          username: from,
          message: `Warning: ${from} appears to be messaging from a different device!`
        });
      }
      
      setMessages(msgs => [...msgs, { 
        from, 
        message, 
        fromDeviceId, 
        timestamp: new Date(timestamp || new Date()) 
      }]);
    });
    
    // User status updates
    socketRef.current.on('userStatusUpdate', (data) => {
      console.log('User status update:', data);
      const { username: user, online } = data;
      
      if (user === recipient) {
        setRecipientStatus(prev => ({ ...prev, online }));
      }
      
      // Update online users list
      setOnlineUsers(prev => {
        if (online && !prev.includes(user)) {
          return [...prev, user];
        } else if (!online && prev.includes(user)) {
          return prev.filter(u => u !== user);
        }
        return prev;
      });
    });
    
    // Typing indicators
    socketRef.current.on('userTyping', (data) => {
      const { username: typingUser } = data;
      if (typingUser === recipient) {
        setTyping(true);
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setTyping(false), 3000);
      }
    });
    
    // Error handling
    socketRef.current.on('error', (error) => {
      console.error('Socket error:', error);
      setSecurityAlert({
        username: 'System',
        message: `Connection error: ${error.message || 'Unknown error'}`
      });
    });
  };

  const getOnlineUsers = () => {
    if (socketRef.current) {
      socketRef.current.emit('getOnlineUsers', {}, (users) => {
        console.log('Online users:', users);
        if (Array.isArray(users)) {
          setOnlineUsers(users);
        }
      });
    }
  };

  const startPingInterval = () => {
    pingIntervalRef.current = setInterval(() => {
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('ping', {}, (response) => {
          if (response) {
            console.log('Ping response:', response);
          }
        });
      }
    }, 30000);
  };

  // Check recipient status
  const checkRecipientStatus = () => {
    if (!recipient || !socketRef.current) {
      setRecipientStatus({ exists: false, online: false });
      return;
    }
    
    socketRef.current.emit('checkUser', { username: recipient }, (response) => {
      console.log('Recipient check response:', response);
      setRecipientStatus(response || { exists: false, online: false });
    });
  };

  // Effect to check recipient status whenever recipient changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (connected && recipient) {
        checkRecipientStatus();
      }
    }, 500); // Debounce
    
    return () => clearTimeout(timeoutId);
  }, [connected, recipient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleUsernameSubmit = (e) => {
    e.preventDefault();
    if (username.trim() && relayStatus === 'online') {
      setConnected(true);
    } else if (relayStatus !== 'online') {
      setSecurityAlert({
        username: 'System',
        message: 'Cannot connect: Base node is offline'
      });
    }
  };

  const handleRecipientChange = (e) => {
    setRecipient(e.target.value.trim());
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!recipient || !message.trim() || !socketRef.current) return;
    
    const messageData = {
      to: recipient,
      message: message.trim(),
      deviceId,
      timestamp: new Date().toISOString()
    };
    
    console.log('Sending message:', messageData);
    
    socketRef.current.emit('sendMessage', messageData, (response) => {
      console.log('Send message response:', response);
      
      if (response && response.success) {
        // Add message to local state
        setMessages(msgs => [...msgs, { 
          from: username, 
          message: message.trim(), 
          fromDeviceId: deviceId, 
          timestamp: new Date() 
        }]);
        setMessage('');
      } else {
        const errorMsg = response?.reason || 'Message delivery failed';
        setSecurityAlert({
          username: recipient,
          message: `Failed to send message: ${errorMsg}`
        });
      }
    });
  };

  const handleMessageChange = (e) => {
    setMessage(e.target.value);
    
    // Send typing indicator
    if (socketRef.current && recipient && e.target.value.length > 0) {
      socketRef.current.emit('typing', { to: recipient });
    }
  };

  const handleDisconnect = () => {
    setConnected(false);
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    setMessages([]);
    setOnlineUsers([]);
    setRecipientStatus({ exists: false, online: false });
    setStatus('Disconnected');
  };

  const dismissAlert = () => {
    setSecurityAlert(null);
  };

  const retryConnection = () => {
    checkRelayStatus();
  };

  // Utility functions
  const getTimestamp = () => {
    const now = new Date();
    return `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
  };

  const formatMessageTime = (timestamp) => {
    if (!timestamp) return getTimestamp();
    const date = new Date(timestamp);
    return `[${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}]`;
  };

  return (
    <div style={{ 
      background: '#0a0e14', 
      minHeight: '100vh', 
      color: '#a2aabc', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      fontFamily: '"Fira Code", monospace'
    }}>
      <div style={{ 
        background: '#171c28', 
        padding: 32, 
        borderRadius: 8, 
        minWidth: 400,
        maxWidth: 600,
        boxShadow: '0 4px 30px rgba(0, 255, 170, 0.15)',
        border: '1px solid rgba(0, 255, 170, 0.3)'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: 24 
        }}>
          <h2 style={{ 
            margin: 0, 
            color: '#5ccfe6', 
            fontFamily: '"Fira Code", monospace',
            letterSpacing: '1px'
          }}>WhisperNet_</h2>
          <div style={{ 
            fontSize: 12, 
            padding: '4px 8px', 
            borderRadius: 4, 
            background: relayStatus === 'online' ? '#1c4b3c' : '#4b1c1c',
            color: relayStatus === 'online' ? '#5ccfe6' : '#ff8f40',
            cursor: 'pointer'
          }} onClick={() => setShowConnectionInfo(!showConnectionInfo)}>
            {relayStatus === 'online' ? 'Base Node Online' : 
             relayStatus === 'checking' ? 'Checking...' : 'Base Node Offline'}
          </div>
        </div>
        
        {showConnectionInfo && (
          <div style={{ 
            background: '#0d1117', 
            padding: 12, 
            borderRadius: 4, 
            fontSize: 12, 
            fontFamily: 'monospace',
            marginBottom: 16,
            border: '1px solid #1e2d3d'
          }}>
            <div>Status: {status}</div>
            {connected && (
              <>
                <div>Socket ID: {connectionDetails.socketId || 'unknown'}</div>
                <div>Transport: {connectionDetails.transport || 'unknown'}</div>
                <div>Base Node: {connectionDetails.baseNodeUrl || BASE_NODE_URL}</div>
              </>
            )}
            <div>Base Node Status: <span style={{
              color: relayStatus === 'online' ? '#bae67e' : '#ff8f40'
            }}>{relayStatus}</span></div>
            {deviceId && <div>Device ID: {deviceId.substring(0, 8)}...</div>}
            {connected && onlineUsers.length > 0 && (
              <div style={{ marginTop: 8 }}>Online Users: {onlineUsers.join(', ')}</div>
            )}
          </div>
        )}
        
        {securityAlert && (
          <div style={{ 
            background: '#4b1c1c', 
            color: '#ff8f40', 
            padding: 12, 
            borderRadius: 4, 
            marginBottom: 16,
            position: 'relative',
            fontSize: 14
          }}>
            <div style={{ marginRight: 20 }}>{securityAlert.message}</div>
            <button 
              style={{ 
                position: 'absolute', 
                top: 8, 
                right: 8, 
                background: 'none', 
                border: 'none', 
                color: '#ff8f40', 
                cursor: 'pointer',
                fontSize: 16
              }}
              onClick={dismissAlert}
            >
              ×
            </button>
          </div>
        )}
        
        {!connected ? (
          <div>
            <div style={{ marginBottom: 16, fontSize: 14, color: '#5ccfe6' }}>
              {getTimestamp()} Initializing secure connection...
            </div>
            <form onSubmit={handleUsernameSubmit}>
              <input
                style={{ 
                  width: '100%', 
                  padding: 10, 
                  marginBottom: 12, 
                  borderRadius: 4, 
                  border: '1px solid #1e2d3d', 
                  background: '#0d1117',
                  color: '#a2aabc',
                  fontSize: 16,
                  fontFamily: '"Fira Code", monospace',
                  boxSizing: 'border-box'
                }}
                placeholder="Enter username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
              />
              <button 
                style={{ 
                  width: '100%', 
                  padding: 10, 
                  borderRadius: 4, 
                  background: relayStatus === 'online' ? 
                    'linear-gradient(90deg, #5ccfe6, #bae67e)' : 
                    '#636b78',
                  color: '#171c28', 
                  fontWeight: 'bold', 
                  fontSize: 16, 
                  border: 'none',
                  cursor: relayStatus === 'online' ? 'pointer' : 'not-allowed',
                  fontFamily: '"Fira Code", monospace'
                }} 
                type="submit"
                disabled={relayStatus !== 'online'}
              >
                {relayStatus === 'online' ? 'AUTHENTICATE' : 'BASE NODE OFFLINE'}
              </button>
            </form>
            {relayStatus !== 'online' && (
              <button 
                style={{ 
                  width: '100%', 
                  padding: 8, 
                  marginTop: 8,
                  borderRadius: 4, 
                  background: '#4b1c1c', 
                  color: '#ff8f40', 
                  fontSize: 14, 
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: '"Fira Code", monospace'
                }} 
                onClick={retryConnection}
              >
                RETRY CONNECTION
              </button>
            )}
            <div style={{ marginTop: 12, color: '#ff3333', textAlign: 'center', fontSize: 14 }}>
              {status}
            </div>
          </div>
        ) : (
          <>
            <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', marginBottom: 16 }}>
              <div style={{ display: 'flex', marginBottom: 8 }}>
                <input
                  style={{ 
                    flex: 1, 
                    padding: 10, 
                    borderRadius: 4, 
                    border: '1px solid #1e2d3d', 
                    background: '#0d1117',
                    color: '#a2aabc',
                    fontSize: 14,
                    marginRight: 8,
                    fontFamily: '"Fira Code", monospace'
                  }}
                  placeholder="Recipient username"
                  value={recipient}
                  onChange={handleRecipientChange}
                  required
                />
                {recipient && (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    marginLeft: 8,
                    fontSize: 12
                  }}>
                    <div style={{ 
                      width: 8, 
                      height: 8, 
                      borderRadius: '50%', 
                      background: recipientStatus.online ? '#bae67e' : 
                                 recipientStatus.exists ? '#ff8f40' : '#ff3333',
                      marginRight: 6 
                    }}></div>
                    {recipientStatus.exists 
                      ? (recipientStatus.online ? 'ONLINE' : 'OFFLINE') 
                      : 'NOT FOUND'}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex' }}>
                <input
                  style={{ 
                    flex: 1, 
                    padding: 10, 
                    borderRadius: 4, 
                    border: '1px solid #1e2d3d', 
                    background: '#0d1117',
                    color: '#a2aabc',
                    fontSize: 14,
                    marginRight: 8,
                    fontFamily: '"Fira Code", monospace'
                  }}
                  placeholder="Type a message"
                  value={message}
                  onChange={handleMessageChange}
                  required
                />
                <button 
                  style={{ 
                    padding: '0 18px', 
                    borderRadius: 4, 
                    background: recipientStatus.online ? 
                      'linear-gradient(90deg, #5ccfe6, #bae67e)' : 
                      '#636b78', 
                    color: '#171c28', 
                    fontWeight: 'bold', 
                    fontSize: 14, 
                    border: 'none',
                    cursor: recipientStatus.online ? 'pointer' : 'not-allowed',
                    fontFamily: '"Fira Code", monospace'
                  }} 
                  type="submit"
                  disabled={!recipientStatus.online}
                >
                  SEND
                </button>
              </div>
            </form>
            
            {typing && recipient && (
              <div style={{ fontSize: 12, color: '#5ccfe6', marginBottom: 8 }}>
                {recipient} is typing...
              </div>
            )}
            
            <div style={{ 
              background: '#0d1117', 
              borderRadius: 4, 
              padding: 12, 
              minHeight: 200, 
              maxHeight: 350, 
              overflowY: 'auto', 
              marginBottom: 12,
              border: '1px solid #1e2d3d',
              fontFamily: 'monospace'
            }}>
              {messages.length === 0 ? (
                <div style={{ color: '#5ccfe6', fontSize: 14 }}>
                  {getTimestamp()} Connection established. Awaiting transmission...
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} style={{ 
                    marginBottom: 12, 
                    padding: 8,
                    borderRadius: 4,
                    background: msg.from === username ? 'rgba(92, 207, 230, 0.1)' : 'rgba(186, 230, 126, 0.1)',
                    borderLeft: msg.from === username ? '2px solid #5ccfe6' : '2px solid #bae67e'
                  }}>
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      marginBottom: 4, 
                      fontSize: 12 
                    }}>
                      <span style={{ 
                        color: msg.from === username ? '#5ccfe6' : '#bae67e',
                        fontWeight: 'bold'
                      }}>
                        {msg.from === username ? 'YOU' : msg.from}
                      </span>
                      <span style={{ color: '#636b78' }}>{formatMessageTime(msg.timestamp)}</span>
                    </div>
                    <div style={{ wordBreak: 'break-word', fontSize: 14 }}>{msg.message}</div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button 
                style={{ 
                  padding: '8px 16px', 
                  borderRadius: 4, 
                  background: '#4b1c1c', 
                  color: '#ff8f40', 
                  fontSize: 14, 
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: '"Fira Code", monospace'
                }} 
                onClick={handleDisconnect}
              >
                DISCONNECT
              </button>
              
              <div style={{ 
                fontSize: 12, 
                color: '#636b78', 
                display: 'flex', 
                alignItems: 'center' 
              }}>
                <div style={{ 
                  width: 8, 
                  height: 8, 
                  borderRadius: '50%', 
                  background: status.includes('Connected') || status.includes('Registered') ? '#bae67e' : '#ff3333',
                  marginRight: 6 
                }}></div>
                {status.includes('Connected') || status.includes('Registered') ? 'SECURE CONNECTION' : 'CONNECTION LOST'}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;