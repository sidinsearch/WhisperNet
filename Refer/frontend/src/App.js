import React, { useState, useRef, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import FingerprintJS from '@fingerprintjs/fingerprintjs';

const BASE_NODE_URL = process.env.REACT_APP_BASE_NODE_URL || "http://localhost:5000";

// Encryption utilities
const generateKeyPair = async () => {
  try {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["encrypt", "decrypt"]
    );
    
    // Export the keys to JWK format
    const publicKey = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKey = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
    
    return { publicKey, privateKey };
  } catch (error) {
    console.error('Error generating key pair:', error);
    throw error;
  }
};

const encryptMessage = async (message, publicKeyJwk) => {
  try {
    // Import the public key
    const publicKey = await window.crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      {
        name: "RSA-OAEP",
        hash: "SHA-256",
      },
      false,
      ["encrypt"]
    );
    
    // Convert the message to ArrayBuffer
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    
    // Encrypt the data
    const encryptedData = await window.crypto.subtle.encrypt(
      {
        name: "RSA-OAEP"
      },
      publicKey,
      data
    );
    
    // Convert the encrypted data to base64
    return btoa(String.fromCharCode(...new Uint8Array(encryptedData)));
  } catch (error) {
    console.error('Error encrypting message:', error);
    throw error;
  }
};

const decryptMessage = async (encryptedMessage, privateKeyJwk) => {
  try {
    // Import the private key
    const privateKey = await window.crypto.subtle.importKey(
      "jwk",
      privateKeyJwk,
      {
        name: "RSA-OAEP",
        hash: "SHA-256",
      },
      false,
      ["decrypt"]
    );
    
    // Convert the base64 encrypted message to ArrayBuffer
    const encryptedData = Uint8Array.from(atob(encryptedMessage), c => c.charCodeAt(0));
    
    // Decrypt the data
    const decryptedData = await window.crypto.subtle.decrypt(
      {
        name: "RSA-OAEP"
      },
      privateKey,
      encryptedData
    );
    
    // Convert the decrypted data to string
    const decoder = new TextDecoder();
    return decoder.decode(decryptedData);
  } catch (error) {
    console.error('Error decrypting message:', error);
    return '[Encrypted message - cannot decrypt]';
  }
};

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
  const [keyPair, setKeyPair] = useState(null);
  const [publicKeys, setPublicKeys] = useState({}); // username -> publicKey
  const [encryptionEnabled, setEncryptionEnabled] = useState(true);
  const [encryptionStatus, setEncryptionStatus] = useState('initializing');
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const recipientCheckTimeoutRef = useRef(null);

  // Get device fingerprint and initialize encryption on component mount
  useEffect(() => {
    const initializeDevice = async () => {
      try {
        // Get device fingerprint
        const fp = await fpPromise;
        const result = await fp.get();
        const visitorId = result.visitorId;
        setDeviceId(visitorId);
        
        // Initialize encryption
        await initializeEncryption(visitorId);
      } catch (error) {
        console.error('Failed to initialize device:', error);
        // Generate a fallback device ID
        const fallbackId = 'fallback-' + Math.random().toString(36).substr(2, 9);
        setDeviceId(fallbackId);
        
        // Initialize encryption with fallback ID
        await initializeEncryption(fallbackId);
      }
    };
    
    initializeDevice();
  }, []);
  
  // Initialize encryption
  const initializeEncryption = async (deviceIdentifier) => {
    try {
      setEncryptionStatus('initializing');
      
      // Check if we have keys in localStorage
      const storedKeys = localStorage.getItem(`whispernetKeys_${deviceIdentifier}`);
      
      if (storedKeys) {
        // We have stored keys, check if they're valid
        try {
          const parsedKeys = JSON.parse(storedKeys);
          
          // Validate the keys by testing encryption/decryption
          if (parsedKeys.publicKey && parsedKeys.privateKey) {
            try {
              // Test encryption with the stored keys
              const testMessage = "test-encryption-" + Date.now();
              const encrypted = await encryptMessage(testMessage, parsedKeys.publicKey);
              const decrypted = await decryptMessage(encrypted, parsedKeys.privateKey);
              
              if (decrypted === testMessage) {
                // Keys are valid
                setKeyPair(parsedKeys);
                console.log('Loaded and validated existing encryption keys');
                setEncryptionStatus('ready');
              } else {
                console.warn('Stored keys failed validation test');
                await generateAndStoreNewKeys(deviceIdentifier);
              }
            } catch (testError) {
              console.error('Error testing stored keys:', testError);
              await generateAndStoreNewKeys(deviceIdentifier);
            }
          } else {
            console.warn('Stored keys are incomplete');
            await generateAndStoreNewKeys(deviceIdentifier);
          }
        } catch (parseError) {
          console.error('Error parsing stored keys:', parseError);
          await generateAndStoreNewKeys(deviceIdentifier);
        }
      } else {
        // No stored keys, generate new ones
        await generateAndStoreNewKeys(deviceIdentifier);
      }
    } catch (error) {
      console.error('Error initializing encryption:', error);
      setEncryptionStatus('error');
      setSecurityAlert({
        username: 'System',
        message: 'Failed to initialize encryption. Messages will not be secure.',
        type: 'error'
      });
      setEncryptionEnabled(false);
    }
  };
  
  // Generate and store new keys
  const generateAndStoreNewKeys = async (deviceIdentifier) => {
    try {
      console.log('Generating new encryption keys...');
      const newKeyPair = await generateKeyPair();
      setKeyPair(newKeyPair);
      
      // Store keys in localStorage
      localStorage.setItem(`whispernetKeys_${deviceIdentifier}`, JSON.stringify(newKeyPair));
      
      console.log('Generated and stored new encryption keys');
      setEncryptionStatus('ready');
    } catch (error) {
      console.error('Error generating new keys:', error);
      throw error;
    }
  };

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
        clearTimeout(recipientCheckTimeoutRef.current);
        clearTimeout(typingTimeoutRef.current);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [connected, username, deviceId]);

  useEffect(() => {
    if (connected && socketRef.current) {
      const fetchRelayInfo = () => {
        console.log('Fetching relay info...');
        
        // First try to get relay info directly from the socket
        socketRef.current.emit('getRelayInfo', {}, (info) => {
          if (info && info.relayId) {
            console.log('Received relay info from socket:', info);
            // Update relay server information
            setRelayServerUrl(info.relayId);
            setConnectionDetails(prev => ({ 
              ...prev, 
              relayId: info.relayId,
              relayStatus: info.status || 'connected',
              connectedUsers: info.connectedUsers,
              ip: info.ip,
              port: info.port
            }));
            
            // Show connection info automatically on first connect
            if (!showConnectionInfo) {
              setShowConnectionInfo(true);
              
              // Auto-hide after 5 seconds
              setTimeout(() => {
                setShowConnectionInfo(false);
              }, 5000);
            }
          } else {
            console.warn('No relay info received from socket, checking with base node');
            
            // If we're connected to the base node, try to get our relay assignment
            socketRef.current.emit('getMyRelayInfo', { username }, (relayInfo) => {
              if (relayInfo && relayInfo.success && relayInfo.relayId) {
                console.log('Received relay assignment from base node:', relayInfo);
                
                if (relayInfo.isDirect) {
                  // We're directly connected to the base node
                  setRelayServerUrl('Direct to Base Node');
                  setConnectionDetails(prev => ({ 
                    ...prev, 
                    relayId: 'direct',
                    relayStatus: 'direct_to_base',
                  }));
                } else {
                  // We're assigned to a relay
                  setRelayServerUrl(relayInfo.relayId);
                  setConnectionDetails(prev => ({ 
                    ...prev, 
                    relayId: relayInfo.relayId,
                    relayStatus: 'assigned_by_base',
                  }));
                }
              } else {
                console.warn('No relay assignment from base node, assuming direct connection');
                
                // If we can't get relay info, we're probably directly connected to the base node
                const socketId = socketRef.current.id;
                setRelayServerUrl(`Direct (${socketId.substring(0, 8)}...)`);
                setConnectionDetails(prev => ({ 
                  ...prev, 
                  relayId: 'direct',
                  relayStatus: 'direct_to_base',
                }));
              }
            });
          }
        });
      };
      
      // Get relay info immediately and then every 10 seconds
      fetchRelayInfo();
      const relayInfoInterval = setInterval(fetchRelayInfo, 10000);
      
      return () => clearInterval(relayInfoInterval);
    }
  }, [connected, showConnectionInfo, username]);

  const connectToBaseNode = () => {
    // Clear any previous connection
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    
    // Always connect to base node first for handshake and relay discovery
    console.log('Connecting to base node for initial handshake:', BASE_NODE_URL);
    setStatus('Connecting to base node for handshake...');
    
    // Connect to base node
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
      setStatus('Connected to base node for handshake');
      setRelayStatus('online');
      
      // When connecting to the base node, set the relay information accordingly
      setRelayServerUrl(`Base Node (Handshake)`);
      setConnectionDetails({
        socketId: socketRef.current.id,
        transport: socketRef.current.io.engine.transport.name,
        baseNodeUrl: BASE_NODE_URL,
        relayId: 'base_handshake',
        relayStatus: 'handshake'
      });
      
      // Get available relays first
      socketRef.current.emit('getAvailableRelays', {}, (response) => {
        console.log('Available relays:', response);
        
        if (response && response.relays && response.relays.length > 0) {
          // Cache relay information
          localStorage.setItem('whispernetRelayCache', JSON.stringify({
            timestamp: Date.now(),
            relays: response.relays
          }));
          
          // Register with base node temporarily
          registerWithBaseNode(() => {
            // After successful registration, connect to a relay
            connectToRelay(response.relays);
          });
        } else {
          // No relays available, register directly with base node
          registerWithBaseNode(() => {
            // Set UI to indicate we're using base node as fallback
            setRelayServerUrl('Base Node (Fallback)');
            setConnectionDetails(prev => ({
              ...prev,
              relayId: 'direct',
              relayStatus: 'direct_to_base'
            }));
            setStatus('Using Base Node as fallback (no relays available)');
            
            // Start polling for available relays
            startRelayPolling();
          });
        }
      });
    });
    
    const registerWithBaseNode = (callback) => {
      // Register with base node
      socketRef.current.emit('registerUser', { 
        username, 
        deviceId 
      }, (response) => {
        console.log('Registration response:', response);
        if (response && response.success) {
          setStatus('Registered successfully with base node');
          
          // Set up socket event handlers
          connectSocketEvents();
          
          // Get initial data
          getOnlineUsers();
          startPingInterval();
          
          // Execute callback if provided
          if (callback && typeof callback === 'function') {
            callback();
          }
        } else {
          const errorMsg = response?.reason || 'Registration failed';
          setStatus(`Registration failed: ${errorMsg}`);
          setSecurityAlert({
            username: 'System',
            message: `Registration failed: ${errorMsg}`,
            type: 'error'
          });
        }
      });
    };
    
    socketRef.current.on('connect_error', (err) => {
      console.error('Base node connection error:', err);
      setStatus(`Connection failed: ${err.message}`);
      setRelayStatus('offline');
      
      // Try to use cached relays if available
      const cachedRelayInfo = localStorage.getItem('whispernetRelayCache');
      let cachedRelays = [];
      
      if (cachedRelayInfo) {
        try {
          const parsedCache = JSON.parse(cachedRelayInfo);
          if (parsedCache.timestamp && (Date.now() - parsedCache.timestamp < 3600000)) { // Cache valid for 1 hour
            cachedRelays = parsedCache.relays || [];
            console.log('Using cached relay information:', cachedRelays);
            
            if (cachedRelays.length > 0) {
              setTimeout(() => {
                connectToRelay(cachedRelays);
              }, 1000);
            }
          }
        } catch (error) {
          console.error('Error parsing cached relay info:', error);
        }
      }
    });
    
    socketRef.current.on('disconnect', (reason) => {
      console.log('Disconnected from base node:', reason);
      setStatus(`Disconnected: ${reason}`);
      
      // Don't auto-reconnect if user manually disconnected
      if (reason !== 'io client disconnect' && connected) {
        setTimeout(() => {
          if (connected) {
            // Try to reconnect to base node first
            connectToBaseNode();
          }
        }, 3000);
      }
    });
  };
  
  // Function to connect to a relay server
  const connectToRelay = (relays) => {
    if (!relays || !relays.length) {
      console.log('No relays available to connect to');
      return;
    }
    
    // Use the first available relay
    const relay = relays[0];
    const relayUrl = relay.id.startsWith('http') ? relay.id : `http://${relay.id}`;
    
    console.log(`Switching to relay server: ${relayUrl}`);
    setStatus(`Connecting to relay server: ${relay.id}...`);
    
    // Disconnect from base node first
    if (socketRef.current) {
      // Keep a reference to the old socket for cleanup
      const oldSocket = socketRef.current;
      
      // Create new socket for relay
      socketRef.current = io(relayUrl, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 3,
        reconnectionDelay: 2000,
        forceNew: true
      });
      
      // Set a timeout to disconnect from base node after relay connection is established
      const relayConnectionTimeout = setTimeout(() => {
        if (!socketRef.current || !socketRef.current.connected) {
          console.log('Relay connection timed out, staying with base node');
          socketRef.current = oldSocket; // Restore old socket
          setStatus('Using Base Node (relay connection failed)');
          setRelayServerUrl('Base Node (Fallback)');
          setConnectionDetails(prev => ({
            ...prev,
            relayId: 'direct',
            relayStatus: 'direct_to_base'
          }));
          
          // Start polling for available relays
          startRelayPolling();
        }
      }, 5000);
      
      socketRef.current.on('connect', () => {
        clearTimeout(relayConnectionTimeout);
        console.log(`Connected to relay server: ${relayUrl}`);
        
        // Register with the relay
        socketRef.current.emit('register', { 
          username, 
          deviceId 
        }, (response) => {
          if (response && response.success) {
            console.log('Successfully registered with relay');
            
            // Now we can safely disconnect from the base node
            oldSocket.disconnect();
            
            setStatus(`Connected to relay server: ${relay.id}`);
            setRelayServerUrl(relay.id);
            setConnectionDetails(prev => ({
              ...prev,
              relayId: relay.id,
              socketId: socketRef.current.id,
              transport: socketRef.current.io.engine.transport.name,
              relayStatus: 'connected_to_relay'
            }));
            
            // Set up socket event handlers
            connectSocketEvents();
            
            // Start ping interval
            startPingInterval();
            
            // Show connection info automatically
            setShowConnectionInfo(true);
            setTimeout(() => {
              setShowConnectionInfo(false);
            }, 5000);
          } else {
            console.error('Failed to register with relay:', response);
            setStatus('Failed to register with relay server');
            
            // Disconnect from relay and stay with base node
            socketRef.current.disconnect();
            socketRef.current = oldSocket;
            
            setStatus('Using Base Node (relay registration failed)');
            setRelayServerUrl('Base Node (Fallback)');
            setConnectionDetails(prev => ({
              ...prev,
              relayId: 'direct',
              relayStatus: 'direct_to_base'
            }));
            
            // Start polling for available relays
            startRelayPolling();
          }
        });
      });
      
      socketRef.current.on('connect_error', (err) => {
        clearTimeout(relayConnectionTimeout);
        console.error(`Relay connection error: ${err.message}`);
        
        // Stay with base node
        socketRef.current = oldSocket;
        
        setStatus('Using Base Node (relay connection error)');
        setRelayServerUrl('Base Node (Fallback)');
        setConnectionDetails(prev => ({
          ...prev,
          relayId: 'direct',
          relayStatus: 'direct_to_base'
        }));
        
        // Start polling for available relays
        startRelayPolling();
      });
      
      socketRef.current.on('disconnect', (reason) => {
        console.log(`Disconnected from relay: ${reason}`);
        
        // If we were previously connected to a relay and lost connection
        if (connectionDetails.relayStatus === 'connected_to_relay') {
          setStatus(`Disconnected from relay: ${reason}`);
          
          // Try to reconnect to base node
          setTimeout(() => {
            if (connected) {
              connectToBaseNode();
            }
          }, 1000);
        }
      });
    }
  };
  
  // Function to periodically poll for available relays when using base node as fallback
  const startRelayPolling = () => {
    // Clear any existing polling interval
    if (window.relayPollingInterval) {
      clearInterval(window.relayPollingInterval);
    }
    
    // Set up polling interval
    window.relayPollingInterval = setInterval(() => {
      if (socketRef.current && socketRef.current.connected && 
          connectionDetails.relayStatus === 'direct_to_base') {
        console.log('Polling for available relays...');
        
        socketRef.current.emit('getAvailableRelays', {}, (response) => {
          if (response && response.relays && response.relays.length > 0) {
            console.log('Found available relays:', response.relays);
            
            // Cache relay information
            localStorage.setItem('whispernetRelayCache', JSON.stringify({
              timestamp: Date.now(),
              relays: response.relays
            }));
            
            // Connect to a relay
            connectToRelay(response.relays);
            
            // Clear polling interval
            clearInterval(window.relayPollingInterval);
          } else {
            console.log('No relays available, continuing to use base node');
          }
        });
      }
    }, 30000); // Poll every 30 seconds
    
    // Clean up on component unmount
    return () => {
      if (window.relayPollingInterval) {
        clearInterval(window.relayPollingInterval);
      }
    };
  };

  const connectSocketEvents = () => {
    // Message handling
    socketRef.current.on('receiveMessage', async (data) => {
      console.log('Received message:', data);
      const { from, message, fromDeviceId, timestamp, encrypted, publicKey, bounced } = data;
      
      // Store sender's public key if provided
      if (publicKey && from) {
        console.log(`Storing public key for ${from}`);
        setPublicKeys(prev => ({ ...prev, [from]: publicKey }));
      }
      
      // Security check for device ID changes
      const previousMessages = messages.filter(msg => msg.from === from);
      if (previousMessages.length > 0 && previousMessages[0].fromDeviceId && 
          previousMessages[0].fromDeviceId !== fromDeviceId) {
        setSecurityAlert({
          username: from,
          message: `Warning: ${from} appears to be messaging from a different device!`,
          type: 'warning'
        });
      }
      
      let decryptedMessage = message;
      let decryptionStatus = 'plaintext';
      
      // Decrypt the message if it's encrypted and we have our private key
      if (encrypted && keyPair?.privateKey) {
        try {
          console.log('Decrypting message...');
          decryptedMessage = await decryptMessage(message, keyPair.privateKey);
          decryptionStatus = 'decrypted';
          console.log('Message decrypted successfully');
        } catch (error) {
          console.error('Failed to decrypt message:', error);
          decryptedMessage = '[Encrypted message - cannot decrypt]';
          decryptionStatus = 'failed';
          
          setSecurityAlert({
            username: 'System',
            message: `Failed to decrypt message from ${from}. Your keys may have changed.`,
            type: 'warning'
          });
        }
      }
      
      setMessages(msgs => [...msgs, { 
        from, 
        message: decryptedMessage, 
        fromDeviceId, 
        timestamp: new Date(timestamp || new Date()),
        encrypted,
        decryptionStatus,
        bounced
      }]);
    });
    
    // Handle public key requests
    socketRef.current.on('publicKeyRequest', ({ from }, ack) => {
      console.log(`Public key requested by ${from}`);
      
      if (keyPair && keyPair.publicKey) {
        console.log(`Sending public key to ${from}`);
        if (ack) ack({ success: true, publicKey: keyPair.publicKey });
      } else {
        console.warn('No public key available to share');
        if (ack) ack({ success: false, reason: 'Public key not available' });
      }
    });
    
    // User status updates
    socketRef.current.on('userStatusUpdate', (data) => {
      console.log('User status update:', data);
      const { username: user, online } = data;
      
      // If this is our current recipient, update their status
      if (user === recipient) {
        console.log(`Updating status for current recipient ${user} to ${online ? 'online' : 'offline'}`);
        setRecipientStatus(prev => ({ 
          ...prev, 
          exists: true, // If we got a status update, the user definitely exists
          online,
          notRegisteredYet: false // Clear this flag since we know the user exists
        }));
      }
      
      // Update online users list
      setOnlineUsers(prev => {
        if (online && !prev.includes(user)) {
          console.log(`Adding ${user} to online users list`);
          return [...prev, user];
        } else if (!online && prev.includes(user)) {
          console.log(`Removing ${user} from online users list`);
          return prev.filter(u => u !== user);
        }
        return prev;
      });
      
      // If we're currently checking a recipient, refresh their status
      if (recipient) {
        checkRecipientStatus();
      }
    });
    
    // Handle bulk online users updates
    socketRef.current.on('onlineUsersUpdate', (data) => {
      console.log('Online users update:', data);
      if (data && Array.isArray(data.users)) {
        setOnlineUsers(data.users);
        
        // If we have a recipient, check if they're in the online users list
        if (recipient && data.users.includes(recipient)) {
          setRecipientStatus(prev => ({ 
            ...prev, 
            exists: true,
            online: true,
            notRegisteredYet: false
          }));
        } else if (recipient) {
          // If recipient is not in the online users list, refresh their status
          checkRecipientStatus();
        }
      }
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
        message: `Connection error: ${error.message || 'Unknown error'}`,
        type: 'error'
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
        // Send ping to keep connection alive
        socketRef.current.emit('ping', {}, (response) => {
          if (response) {
            console.log('Ping response:', response);
          }
        });
        
        // Also refresh online users list
        getOnlineUsers();
        
        // If we have a recipient, check their status
        if (recipient) {
          checkRecipientStatus();
        }
      }
    }, 30000); // Every 30 seconds
  };

  // Check recipient status
  const checkRecipientStatus = () => {
    if (!recipient || !socketRef.current) {
      setRecipientStatus({ exists: false, online: false, checking: false });
      return;
    }
    
    console.log(`Checking status for recipient: ${recipient}`);
    
    // Set status to checking while we wait for the response
    setRecipientStatus(prev => ({ ...prev, checking: true }));
    
    // Set a timeout to clear the checking status if we don't get a response
    const checkingTimeout = setTimeout(() => {
      setRecipientStatus(prev => {
        if (prev.checking) {
          return { ...prev, checking: false };
        }
        return prev;
      });
    }, 3000); // 3 seconds timeout
    
    // First check if the recipient is in the online users list
    if (onlineUsers.includes(recipient)) {
      clearTimeout(checkingTimeout);
      console.log(`${recipient} found in online users list`);
      setRecipientStatus({ exists: true, online: true, checking: false });
      return;
    }
    
    // If we're connected to a relay, use the checkRecipient event
    if (connectionDetails.relayStatus === 'connected_to_relay') {
      socketRef.current.emit('checkRecipient', { username: recipient }, (relayResponse) => {
        clearTimeout(checkingTimeout);
        console.log('Relay recipient check response:', relayResponse);
        if (relayResponse && typeof relayResponse.exists === 'boolean') {
          // Only update if we got a valid response
          setRecipientStatus({
            ...relayResponse,
            checking: false
          });
        } else {
          // If no valid response, mark as not found
          setRecipientStatus({ 
            exists: false, 
            online: false, 
            checking: false 
          });
        }
      });
    } else {
      // If connected directly to base node, use checkUser
      socketRef.current.emit('checkUser', { username: recipient }, (response) => {
        clearTimeout(checkingTimeout);
        console.log('Base node recipient check response:', response);
        
        // If we got a valid response, use it
        if (response && typeof response.exists === 'boolean') {
          setRecipientStatus({
            ...response,
            checking: false
          });
        } else {
          // If no valid response, mark as not found
          setRecipientStatus({ 
            exists: false, 
            online: false, 
            checking: false 
          });
        }
      });
    }
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

  const handleUsernameSubmit = async (e) => {
    e.preventDefault();
    if (username.trim() && relayStatus === 'online') {
      setIsCheckingUsername(true);
      const tempSocket = io(BASE_NODE_URL, { forceNew: true, timeout: 5000 });
      tempSocket.on('connect', () => {
        tempSocket.emit('checkUser', { username: username.trim() }, (response) => {
          setIsCheckingUsername(false);
          if (response && response.exists) {
            setUsernameAvailable(false);
            setSecurityAlert({
              username: 'System',
              message: `Username "${username}" is already taken.`,
              type: 'error'
            });
            // Explicitly disconnect and do NOT set connected to true
            tempSocket.disconnect();
          } else {
            setUsernameAvailable(true);
            setConnected(true);
            tempSocket.disconnect();
          }
        });
      });
      tempSocket.on('connect_error', (error) => {
        console.error('Connection error during username check:', error);
        setIsCheckingUsername(false);
        setSecurityAlert({
          username: 'System',
          message: 'Could not verify username. Base node may be offline.',
          type: 'error'
        });
        tempSocket.disconnect();
      });
    } else if (relayStatus !== 'online') {
      setSecurityAlert({
        username: 'System',
        message: 'Cannot connect: Base node is offline',
        type: 'error'
      });
    }
  };

  const handleRecipientChange = (e) => {
    const newRecipient = e.target.value.trim();
    setRecipient(newRecipient);
    
    // Reset recipient status when the recipient changes
    setRecipientStatus({ exists: false, online: false, checking: false });
    
    // If the recipient is not empty, check their status
    if (newRecipient && socketRef.current) {
      // Use a small delay to avoid too many checks while typing
      if (recipientCheckTimeoutRef.current) {
        clearTimeout(recipientCheckTimeoutRef.current);
      }
      
      recipientCheckTimeoutRef.current = setTimeout(() => {
        checkRecipientStatus();
      }, 500); // 500ms delay
    }
  };

  const handleSend = async (e, bounce = false) => {
    e.preventDefault();
    if (!recipient || !message.trim() || !socketRef.current) return;
    
    try {
      // Show sending indicator
      setStatus('Sending message...');
      
      // If this is a relay/bounce message, we'll proceed regardless of recipient status
      if (!bounce) {
        // For direct messages, we need to check if the recipient exists and is online
        const recipientOnline = recipientStatus.online;
        
        // If recipient is not online, suggest using relay
        if (!recipientOnline) {
          setSecurityAlert({
            username: 'System',
            message: `${recipient} is offline or not found. Use the RELAY button to send a delayed message.`,
            type: 'warning'
          });
          setStatus('Registered successfully');
          return;
        }
      }
      
      // Get recipient's public key if we don't have it and encryption is enabled
      if (encryptionEnabled && !publicKeys[recipient]) {
        try {
          await requestPublicKey(recipient);
        } catch (error) {
          console.error('Failed to get public key:', error);
          // Continue without encryption if we can't get the key
        }
      }
      
      let finalMessage = message.trim();
      let isEncrypted = false;
      
      // Encrypt the message if encryption is enabled and we have the recipient's public key
      if (encryptionEnabled && publicKeys[recipient]) {
        try {
          finalMessage = await encryptMessage(message.trim(), publicKeys[recipient]);
          isEncrypted = true;
          console.log('Message encrypted successfully');
        } catch (error) {
          console.error('Failed to encrypt message:', error);
          setSecurityAlert({
            username: 'System',
            message: 'Failed to encrypt message. Sending as plaintext.',
            type: 'warning'
          });
        }
      }
      
      const messageData = {
        to: recipient,
        message: finalMessage,
        deviceId,
        timestamp: new Date().toISOString(),
        bounce: bounce, // Always use the bounce parameter directly
        encrypted: isEncrypted,
        publicKey: keyPair?.publicKey // Send our public key with the message
      };
      
      console.log('Sending message:', { 
        ...messageData, 
        message: isEncrypted ? '[ENCRYPTED]' : finalMessage,
        bounce: bounce
      });
      
      // Add a timeout to handle cases where the server doesn't respond
      const messageTimeout = setTimeout(() => {
        setSecurityAlert({
          username: 'System',
          message: 'Message sending timed out. Server may be offline.',
          type: 'error'
        });
        setStatus('Registered successfully');
      }, 10000);
      
      socketRef.current.emit('sendMessage', messageData, (response) => {
        clearTimeout(messageTimeout);
        console.log('Send message response:', response);
        setStatus('Registered successfully');
        
        if (response && (response.delivered || response.bounced)) {
          // Add message to local state (store original message for display)
          setMessages(msgs => [...msgs, { 
            from: username, 
            message: message.trim(), // Store original message for display
            fromDeviceId: deviceId, 
            timestamp: new Date(),
            status: response.delivered ? 'delivered' : 'bounced',
            expiresAt: response.expiresAt,
            encrypted: isEncrypted
          }]);
          setMessage('');
          
          // Show notification if message was bounced
          if (response.bounced) {
            setSecurityAlert({
              username: 'System',
              message: `Message to ${recipient} will be delivered when they come online (expires in 4 hours)`,
              type: 'info'
            });
          }
        } else {
          const errorMsg = response?.reason || 'Message delivery failed';
          
          if (errorMsg.includes('not found') || errorMsg.includes('User not found')) {
            if (bounce) {
              // For bounced messages to non-existent users, show a special message
              setSecurityAlert({
                username: 'System',
                message: `Message will be delivered if ${recipient} registers within 4 hours.`,
                type: 'info'
              });
              
              // Add message to local state as bounced
              setMessages(msgs => [...msgs, { 
                from: username, 
                message: message.trim(),
                fromDeviceId: deviceId, 
                timestamp: new Date(),
                status: 'bounced',
                expiresAt: Date.now() + 14400000, // 4 hours
                encrypted: isEncrypted
              }]);
              setMessage('');
            } else {
              setSecurityAlert({
                username: 'System',
                message: `${recipient} not found. Use the RELAY button to send a message that will be delivered if they register.`,
                type: 'warning'
              });
            }
          } else if (errorMsg.includes('offline')) {
            setSecurityAlert({
              username: 'System',
              message: `${recipient} is offline. Use the RELAY button to send a delayed message.`,
              type: 'warning'
            });
          } else {
            setSecurityAlert({
              username: 'System',
              message: `Failed to send message: ${errorMsg}`,
              type: 'error'
            });
          }
        }
      });
    } catch (error) {
      console.error('Error sending message:', error);
      setSecurityAlert({
        username: 'System',
        message: `Error sending message: ${error.message}`,
        type: 'error'
      });
      setStatus('Registered successfully');
    }
  };
  
  // Request public key from a user
  const requestPublicKey = async (username) => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current) {
        reject(new Error('Not connected'));
        return;
      }
      
      console.log(`Requesting public key for ${username}...`);
      
      // Set a timeout in case the server doesn't respond
      const requestTimeout = setTimeout(() => {
        console.error(`Public key request for ${username} timed out`);
        reject(new Error('Request timed out'));
      }, 10000);
      
      socketRef.current.emit('requestPublicKey', { username }, (response) => {
        clearTimeout(requestTimeout);
        
        if (response && response.success && response.publicKey) {
          console.log(`Received public key for ${username}`);
          setPublicKeys(prev => ({ ...prev, [username]: response.publicKey }));
          resolve(response.publicKey);
        } else {
          const reason = response?.reason || 'Public key not available';
          console.log(`No public key available for ${username}: ${reason}`);
          reject(new Error(reason));
        }
      });
    });
  };
  
  // Handle relay bounce for any user
  const handleRelayBounce = (e) => {
    e.preventDefault();
    if (!recipient || !message.trim() || !socketRef.current) return;
    
    // Show confirmation before bouncing
    const confirmBounce = window.confirm(
      `RELAY MESSAGE\n\n` +
      `Your message to "${recipient}" will be stored on ${connectionDetails.relayStatus === 'connected_to_relay' ? 'relay' : 'base node'} servers for up to 4 hours.\n\n` +
      `It will be delivered when ${recipient} comes online or registers with the network.\n\n` +
      `Continue?`
    );
    
    if (confirmBounce) {
      handleSend(e, true);
    }
  };

  const handleMessageChange = (e) => {
    setMessage(e.target.value);
    
    // Send typing indicator
    if (socketRef.current && recipient && e.target.value.length > 0) {
      socketRef.current.emit('typing', { to: recipient });
    }
  };

  const handleDisconnect = () => {
    if (socketRef.current) {
      // Notify the server that we're intentionally disconnecting
      socketRef.current.emit('userLogout', { username, deviceId }, () => {
        console.log('Sent logout notification to server');
        
        // Now disconnect
        socketRef.current.disconnect();
        socketRef.current = null;
      });
    }
    
    // Clear local state
    setConnected(false);
    setMessages([]);
    setOnlineUsers([]);
    setRecipientStatus({ exists: false, online: false });
    setStatus('Disconnected');
    setRelayStatus('offline');
    clearInterval(pingIntervalRef.current);
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
                <div>Relay ID: <span style={{ color: '#5ccfe6' }}>{relayServerUrl || 'Unknown'}</span></div>
                <div>Relay Status: <span style={{ 
                  color: connectionDetails.relayStatus === 'connected_to_base' ? '#bae67e' : 
                         connectionDetails.relayStatus === 'direct_to_base' ? '#5ccfe6' : '#ff8f40' 
                }}>
                  {connectionDetails.relayStatus === 'connected_to_base' ? 'Connected to Base' : 
                   connectionDetails.relayStatus === 'direct_to_base' ? 'Direct to Base Node' : 
                   connectionDetails.relayStatus === 'assigned_by_base' ? 'Assigned by Base' : 'Standalone'}
                </span></div>
                {connectionDetails.connectedUsers !== undefined && (
                  <div>Users on Relay: {connectionDetails.connectedUsers}</div>
                )}
                {connectionDetails.ip && connectionDetails.port && (
                  <div>Relay Address: {connectionDetails.ip}:{connectionDetails.port}</div>
                )}
              </>
            )}
            <div>Base Node Status: <span style={{
              color: relayStatus === 'online' ? '#bae67e' : '#ff8f40'
            }}>{relayStatus}</span></div>
            {deviceId && <div>Device ID: {deviceId.substring(0, 8)}...</div>}
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
                onChange={e => {
                  setUsername(e.target.value);
                  setUsernameAvailable(true);
                }}
                required
              />
              {!usernameAvailable && <div style={{color: '#ff8f40', fontSize: 12, marginTop: -8, marginBottom: 8}}>Username not available.</div>}
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
                  cursor: relayStatus === 'online' && !isCheckingUsername ? 'pointer' : 'not-allowed',
                  fontFamily: '"Fira Code", monospace'
                }}
                type="submit"
                disabled={relayStatus !== 'online' || isCheckingUsername}
              >
                {isCheckingUsername ? 'CHECKING...' : (relayStatus === 'online' ? 'AUTHENTICATE' : 'BASE NODE OFFLINE')}
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
                    <span style={{
                      fontSize: 12,
                      color: recipientStatus.online ? '#bae67e' : 
                            recipientStatus.exists ? '#ff8f40' : '#ff3333'
                    }}>
                      {recipientStatus.online ? 'ONLINE' : 'OFFLINE'}
                    </span>
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
                {recipient ? (
                  <div style={{ display: 'flex' }}>
                    {/* SEND button */}
                    <button 
                      style={{ 
                        padding: '0 18px', 
                        borderRadius: '4px 0 0 4px', 
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
                      title={recipientStatus.online ? "Send message directly" : "User is offline or not found"}
                    >
                      SEND
                    </button>
                    
                    {/* Always show the RELAY button */}
                    <button 
                      style={{ 
                        padding: '0 12px', 
                        borderRadius: '0 4px 4px 0', 
                        background: '#4b1c1c', 
                        color: '#ff8f40', 
                        fontWeight: 'bold', 
                        fontSize: 14, 
                        border: 'none',
                        cursor: 'pointer',
                        fontFamily: '"Fira Code", monospace',
                        display: 'flex',
                        alignItems: 'center'
                      }} 
                      onClick={handleRelayBounce}
                      title="Message will be stored on relay servers for up to 4 hours"
                    >
                      RELAY
                      <span style={{
                        fontSize: 10,
                        marginLeft: 4,
                        background: 'rgba(255, 143, 64, 0.2)',
                        padding: '1px 3px',
                        borderRadius: 2
                      }}>
                        4h
                      </span>
                    </button>
                  </div>
                ) : (
                  <button 
                    style={{ 
                      padding: '0 18px', 
                      borderRadius: 4, 
                      background: '#636b78', 
                      color: '#171c28', 
                      fontWeight: 'bold', 
                      fontSize: 14, 
                      border: 'none',
                      cursor: 'not-allowed',
                      fontFamily: '"Fira Code", monospace'
                    }} 
                    disabled={true}
                  >
                    SEND
                  </button>
                )}
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
                        {msg.bounced && <span style={{ color: '#ff8f40', marginLeft: 6 }}>(bounced)</span>}
                      </span>
                      <span style={{ color: '#636b78' }}>{formatMessageTime(msg.timestamp)}</span>
                    </div>
                    <div style={{ wordBreak: 'break-word', fontSize: 14 }}>{msg.message}</div>
                    {msg.status === 'bounced' && (
                      <div style={{ 
                        fontSize: 10, 
                        color: '#ff8f40', 
                        marginTop: 4,
                        fontStyle: 'italic'
                      }}>
                        Message will be delivered when recipient comes online (expires in 4 hours)
                      </div>
                    )}
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