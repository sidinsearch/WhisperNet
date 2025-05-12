import React, { useState, useRef, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import FingerprintJS from '@fingerprintjs/fingerprintjs';

const RELAY_SERVER_URL = "https://whispernet-basenode.onrender.com";

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
      const fp = await fpPromise;
      const result = await fp.get();
      setDeviceId(result.visitorId);
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
  const checkRelayStatus = () => {
    setStatus('Checking relay status...');
    
    // Create a temporary socket just to check status
    const tempSocket = io(RELAY_SERVER_URL.replace(/\/$/, ''), {
      transports: ['websocket'],
      reconnectionAttempts: 3,
      reconnectionDelay: 1000,
      timeout: 5000
    });
    
    tempSocket.on('connect', () => {
      setRelayStatus('online');
      setStatus('Relay server online. Please login.');
      tempSocket.disconnect();
    });
    
    tempSocket.on('connect_error', (err) => {
      console.error('Connection error:', err);
      setRelayStatus('offline');
      setStatus('Relay server offline. Please try again later.');
      tempSocket.disconnect();
    });
    
    // Set timeout for connection attempt
    setTimeout(() => {
      if (relayStatus === 'checking') {
        setRelayStatus('timeout');
        setStatus('Connection timeout. Please try again later.');
        tempSocket.disconnect();
      }
    }, 5000);
  };

  // Check if username is available
  const checkUsernameAvailability = () => {
    if (!username || !socketRef.current) return;
    
    setIsCheckingUsername(true);
    socketRef.current.emit('checkUser', { username }, (res) => {
      setIsCheckingUsername(false);
      if (res && res.exists) {
        setUsernameAvailable(false);
        setSecurityAlert({
          username: username,
          message: `Username "${username}" is already taken. Please choose another.`
        });
      } else {
        setUsernameAvailable(true);
        handleLogin();
      }
    });
  };

  useEffect(() => {
    if (connected) {
      // Clear any previous connection
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      
      // Connect to the base node with connection debugging
      console.log('Attempting to connect to:', RELAY_SERVER_URL);
      socketRef.current = io(RELAY_SERVER_URL.replace(/\/$/, ''), {
        transports: ['websocket'],
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        query: { deviceId }
      });
      
      setStatus('Connecting...');
      
      socketRef.current.on('connect', () => {
        setStatus('Connected');
        setConnectionDetails({
          socketId: socketRef.current.id,
          transport: socketRef.current.io.engine.transport.name,
          baseNodeUrl: BASE_NODE_URL
        });
        
        // Register with username and device fingerprint
        socketRef.current.emit('register', { username, deviceId }, (res) => {
          if (!res.success) {
            setStatus(`Error: ${res.reason}`);
            setSecurityAlert({
              username: username,
              message: `Error: ${res.reason}`
            });
            setConnected(false);
            socketRef.current.disconnect();
          } else {
            // Get relay server URL
            socketRef.current.emit('getRelayInfo', null, (relayInfo) => {
              if (relayInfo) {
                setRelayStatus(relayInfo.status || 'online');
                setRelayServerUrl(relayInfo.url || 'Unknown');
                setConnectionDetails(prev => ({
                  ...prev,
                  relayServerUrl: relayInfo.url,
                  relayStatus: relayInfo.status || 'online'
                }));
              }
            });
            
            // Get online users
            socketRef.current.emit('getOnlineUsers', null, (users) => {
              if (users && Array.isArray(users)) {
                setOnlineUsers(users);
              }
            });
            
            // Start ping interval to keep connection alive and update relay status
            pingIntervalRef.current = setInterval(() => {
              socketRef.current.emit('ping', null, (response) => {
                if (response && response.relayStatus) {
                  setRelayStatus(response.relayStatus);
                }
              });
            }, 30000); // Every 30 seconds
          }
        });
      });
      
      socketRef.current.on('connect_error', (err) => {
        console.error('Connection error:', err);
        setStatus(`Connection error: ${err.message}`);
        setRelayStatus('offline');
      });
      
      socketRef.current.on('disconnect', (reason) => {
        setStatus(`Disconnected: ${reason}`);
        setRelayStatus('offline');
        clearInterval(pingIntervalRef.current);
      });
      
      socketRef.current.on('receiveMessage', ({ from, message, fromDeviceId }) => {
        // Check if the sender's device ID is different from previous messages
        const previousMessages = messages.filter(msg => msg.from === from);
        if (previousMessages.length > 0 && previousMessages[0].fromDeviceId && 
            previousMessages[0].fromDeviceId !== fromDeviceId) {
          setSecurityAlert({
            username: from,
            message: `Warning: ${from} appears to be messaging from a different device!`
          });
        }
        
        setMessages((msgs) => [...msgs, { from, message, fromDeviceId, timestamp: new Date() }]);
      });
      
      socketRef.current.on('userTyping', ({ username: typingUser }) => {
        if (typingUser === recipient) {
          setTyping(true);
          clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setTyping(false), 3000);
        }
      });
      
      socketRef.current.on('userStatusChange', ({ username: user, online }) => {
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
      
      socketRef.current.on('relayStatusUpdate', ({ relayId, status }) => {
        if (connectionDetails.relayServerUrl === relayId) {
          setRelayStatus(status);
          setConnectionDetails(prev => ({
            ...prev,
            relayStatus: status
          }));
        }
      });
      
      return () => {
        clearInterval(pingIntervalRef.current);
        socketRef.current.disconnect();
      };
    }
  }, [connected, username, deviceId, messages, connectionDetails.relayServerUrl]);

  // Effect to check recipient status whenever recipient changes
  useEffect(() => {
    if (connected && socketRef.current && recipient) {
      socketRef.current.emit('checkRecipient', { username: recipient }, (res) => {
        setRecipientStatus(res || { exists: false, online: false });
      });
    } else {
      setRecipientStatus({ exists: false, online: false });
    }
  }, [connected, recipient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleUsernameSubmit = (e) => {
    e.preventDefault();
    if (username && relayStatus === 'online') {
      // First connect to socket
      setConnected(true);
      // Username check will happen after connection in the useEffect
    }
  };

  const handleLogin = () => {
    // This is called after username availability check
    console.log('Username available, proceeding with login');
  };

  // Handle recipient change
  const handleRecipientChange = (e) => {
    setRecipient(e.target.value);
    setRecipientStatus({ exists: false, online: false });
  };

  // Check recipient status before sending
  const checkRecipient = () => {
    if (!recipient || !socketRef.current) return;
    
    socketRef.current.emit('checkRecipient', { username: recipient }, (res) => {
      setRecipientStatus(res || { exists: false, online: false });
    });
  };

  // Update handleSend to check recipient status first
  const handleSend = (e) => {
    e.preventDefault();
    if (!recipient || !message || !socketRef.current) return;
    
    // First check if recipient exists and is online
    socketRef.current.emit('checkRecipient', { username: recipient }, (res) => {
      if (!res.exists) {
        setSecurityAlert({
          username: recipient,
          message: `User ${recipient} does not exist`
        });
        return;
      }
      
      if (!res.online) {
        setSecurityAlert({
          username: recipient,
          message: `User ${recipient} is currently offline`
        });
        return;
      }
      
      // Recipient exists and is online, send the message
      console.log('Sending message to:', recipient);
      socketRef.current.emit('sendMessage', { to: recipient, message, deviceId }, (res) => {
        console.log('Message send response:', res);
        if (res?.delivered) {
          setMessages((msgs) => [...msgs, { from: username, message, fromDeviceId: deviceId, timestamp: new Date() }]);
          setMessage('');
        } else {
          setStatus(res?.reason || 'Delivery failed');
          setSecurityAlert({
            username: recipient,
            message: `Failed to send message: ${res?.reason || 'Delivery failed'}`
          });
        }
      });
    });
  };

  const handleMessageChange = (e) => {
    setMessage(e.target.value);
    // Emit typing event
    if (socketRef.current && recipient) {
      socketRef.current.emit('typing', { to: recipient });
    }
  };

  const dismissAlert = () => {
    setSecurityAlert(null);
  };

  const retryConnection = () => {
    checkRelayStatus();
  };

  // Terminal-style timestamp
  const getTimestamp = () => {
    const now = new Date();
    return `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
  };

  // Format message timestamp
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
            {relayStatus === 'online' ? 'Relay Online' : 'Relay Offline'}
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
                <div>Base Node: {connectionDetails.baseNodeUrl || 'unknown'}</div>
                <div>Relay Server: {connectionDetails.relayServerUrl || relayServerUrl}</div>
              </>
            )}
            <div>Relay Status: <span style={{
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
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 16, fontSize: 14, color: '#5ccfe6' }}>
              {getTimestamp()} Initializing secure connection...
            </div>
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
                fontFamily: '"Fira Code", monospace'
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
                background: 'linear-gradient(90deg, #5ccfe6, #bae67e)', 
                color: '#171c28', 
                fontWeight: 'bold', 
                fontSize: 16, 
                border: 'none',
                cursor: 'pointer',
                fontFamily: '"Fira Code", monospace'
              }} 
              type="submit"
            >
              AUTHENTICATE
            </button>
            <div style={{ marginTop: 12, color: '#ff3333', textAlign: 'center', fontSize: 14 }}>
              {status !== 'Disconnected' && status}
            </div>
          </form>
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
                  onBlur={checkRecipient}
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
                      background: recipientStatus.online ? '#bae67e' : '#ff3333',
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
                    background: recipientStatus === 'Online' ? 
                      'linear-gradient(90deg, #5ccfe6, #bae67e)' : 
                      'linear-gradient(90deg, #636b78, #636b78)', 
                    color: '#171c28', 
                    fontWeight: 'bold', 
                    fontSize: 14, 
                    border: 'none',
                    cursor: recipientStatus === 'Online' ? 'pointer' : 'not-allowed',
                    fontFamily: '"Fira Code", monospace'
                  }} 
                  type="submit"
                  disabled={recipientStatus !== 'Online'}
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
                onClick={() => setConnected(false)}
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
                  background: status.includes('Connected') ? '#bae67e' : '#ff3333',
                  marginRight: 6 
                }}></div>
                {status.includes('Connected') ? 'SECURE CONNECTION' : 'CONNECTION LOST'}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;

// Add this function before the handleSend function
const handleRecipientChange = (e) => {
  setRecipient(e.target.value);
  setRecipientStatus({ exists: false, online: false });
};