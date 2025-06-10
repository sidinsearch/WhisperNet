import React, { useState, useRef, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import FingerprintJS from '@fingerprintjs/fingerprintjs';
import ChatBox from './components/ChatBox';
import UserList from './components/UserList';
import VerificationModal from './components/VerificationModal';
// Import the icon directly
import appIcon from './assets/icon.png';
import { 
  saveChatHistory, 
  loadChatHistory, 
  getActiveChats, 
  clearAllChatHistory,
  saveUnreadCounts,
  loadUnreadCounts,
  resetUnreadCount,
  incrementUnreadCount
} from './utils/chatStorage';
import {
  storeVerifiedKey,
  getVerifiedKey,
  hasVerifiedKey,
  verifyKey,
  generateKeyFingerprint,
  detectStorageReset,
  clearAllVerifiedKeys
} from './utils/keyVerification';

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
  const [showAboutPage, setShowAboutPage] = useState(false);
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
  
  // New state variables for chat management
  const [activeChats, setActiveChats] = useState({}); // username -> boolean (is chat open)
  const [chatMessages, setChatMessages] = useState({}); // username -> messages array
  const [currentChat, setCurrentChat] = useState(null); // currently selected chat username
  const [typingUsers, setTypingUsers] = useState({}); // username -> boolean (is typing)
  const [recipientStatuses, setRecipientStatuses] = useState({}); // username -> status object
  const [unreadCounts, setUnreadCounts] = useState({}); // username -> count
  
  // Key verification state
  const [verificationStatuses, setVerificationStatuses] = useState({}); // username -> verification status
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [currentVerification, setCurrentVerification] = useState(null);
  const [storageResetDetected, setStorageResetDetected] = useState(false);
  
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const recipientCheckTimeoutRef = useRef(null);

  // Get device fingerprint and initialize encryption on component mount
  useEffect(() => {
    const initializeDevice = async () => {
      try {
        // Check if localStorage has been reset
        const isReset = detectStorageReset();
        setStorageResetDetected(isReset);
        
        if (isReset) {
          setSecurityAlert({
            username: 'System',
            message: 'Your browser storage has been reset. You will need to verify contacts again.',
            type: 'warning'
          });
        }
        
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
    setStatus('Checking connection status...');
    setRelayStatus('checking');
    
    try {
      // First try HTTP health check
      const response = await axios.get(`${BASE_NODE_URL}/health`, { 
        timeout: 5000 
      });
      
      if (response.status === 200) {
        setRelayStatus('online');
        setStatus('Connection online. Please login.');
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
      setStatus('Connection timeout. Server may be offline.');
      tempSocket.disconnect();
    }, 8000);
    
    tempSocket.on('connect', () => {
      clearTimeout(connectionTimeout);
      setRelayStatus('online');
      setStatus('Connection online. Please login.');
      tempSocket.disconnect();
    });
    
    tempSocket.on('connect_error', (err) => {
      clearTimeout(connectionTimeout);
      console.error('Socket connection error:', err);
      setRelayStatus('offline');
      setStatus('Connection offline. Please try again later.');
      tempSocket.disconnect();
    });
  };
  
  // Chat management functions
  const openChat = async (chatUsername) => {
    // Check if we already have messages for this chat
    if (!chatMessages[chatUsername]) {
      // Load chat history from localStorage
      const history = loadChatHistory(username, chatUsername);
      
      // Update chat messages
      setChatMessages(prev => ({
        ...prev,
        [chatUsername]: history
      }));
    }
    
    // Mark chat as active
    setActiveChats(prev => ({
      ...prev,
      [chatUsername]: true
    }));
    
    // Set as current chat
    setCurrentChat(chatUsername);
    
    // Reset unread count
    setUnreadCounts(prev => ({
      ...prev,
      [chatUsername]: 0
    }));
    resetUnreadCount(username, chatUsername);
    
    // Check recipient status
    checkUserStatus(chatUsername);
  };
  
  const closeChat = (chatUsername) => {
    // Mark chat as inactive
    setActiveChats(prev => {
      const newActiveChats = { ...prev };
      delete newActiveChats[chatUsername];
      return newActiveChats;
    });
    
    // If this was the current chat, set current chat to null
    if (currentChat === chatUsername) {
      setCurrentChat(null);
    }
  };
  
  const checkUserStatus = (chatUsername) => {
    if (!socketRef.current || !chatUsername) return;
    
    // First check if the user is in the online users list
    const isOnline = onlineUsers.includes(chatUsername);
    
    if (isOnline) {
      setRecipientStatuses(prev => ({
        ...prev,
        [chatUsername]: { exists: true, online: true }
      }));
      return;
    }
    
    // Otherwise, check with the server
    socketRef.current.emit('checkRecipient', { username: chatUsername }, (response) => {
      if (response && response.exists) {
        setRecipientStatuses(prev => ({
          ...prev,
          [chatUsername]: { exists: true, online: response.online || false }
        }));
      } else {
        setRecipientStatuses(prev => ({
          ...prev,
          [chatUsername]: { exists: false, online: false }
        }));
      }
    });
  };
  
  const handleClearAllHistory = () => {
    if (window.confirm('Are you sure you want to clear all chat history? This cannot be undone.')) {
      // Ask if they also want to clear verification keys
      const clearKeys = window.confirm(
        'Do you also want to clear all identity verification keys?\n\n' +
        'If you choose YES, you will need to re-verify all contacts.\n' +
        'If you choose NO, your contacts will remain verified but chat history will be cleared.'
      );
      
      // Clear all chat history from localStorage
      clearAllChatHistory(username);
      
      // Clear verification keys if requested
      if (clearKeys) {
        clearAllVerifiedKeys(username);
        setVerificationStatuses({});
      }
      
      // Reset state
      setChatMessages({});
      setUnreadCounts({});
      setActiveChats({});
      setCurrentChat(null);
      
      // Show confirmation
      setSecurityAlert({
        username: 'System',
        message: clearKeys ? 
          'All chat history and verification keys have been cleared.' : 
          'All chat history has been cleared.',
        type: 'info'
      });
    }
  };
  
  const handleNewChat = (chatUsername) => {
    if (chatUsername === username) {
      setSecurityAlert({
        username: 'System',
        message: 'You cannot chat with yourself.',
        type: 'error'
      });
      return;
    }
    
    // Open the chat
    openChat(chatUsername);
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
  
  // Effect to save chat messages to localStorage when they change
  useEffect(() => {
    if (username && Object.keys(chatMessages).length > 0) {
      // Save each chat's messages to localStorage
      Object.keys(chatMessages).forEach(chatUser => {
        saveChatHistory(username, chatUser, chatMessages[chatUser]);
      });
    }
  }, [username, chatMessages]);

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
        
        // Check if this is the first message from this user
        const previousMessages = chatMessages[from] || [];
        const isFirstMessage = previousMessages.length === 0;
        
        // Verify the key if we have a stored key for this user
        if (hasVerifiedKey(username, from)) {
          // We have a verified key, check if it matches
          const verificationResult = await verifyKey(username, from, publicKey, fromDeviceId);
          
          // Generate fingerprint and then update verification status
          generateKeyFingerprint(publicKey).then(fingerprint => {
            setVerificationStatuses(prev => ({
              ...prev,
              [from]: {
                verified: verificationResult.verified,
                status: verificationResult.status,
                message: verificationResult.message,
                verifiedAt: verificationResult.verifiedAt,
                fingerprint: fingerprint
              }
            }));
          });
          
          // Show warning if key doesn't match
          if (!verificationResult.verified) {
            setSecurityAlert({
              username: from,
              message: `Warning: ${from}'s identity could not be verified. ${verificationResult.message}`,
              type: 'warning'
            });
          }
        } else if (isFirstMessage) {
          // This is the first message and we don't have a verified key
          // Set as unverified and prompt for verification
          generateKeyFingerprint(publicKey).then(fingerprint => {
            setVerificationStatuses(prev => ({
              ...prev,
              [from]: {
                verified: false,
                status: 'unverified',
                message: 'Identity not verified',
                fingerprint
              }
            }));
            
            // Show verification prompt
            setSecurityAlert({
              username: 'System',
              message: `New message from ${from}. Click on "UNVERIFIED" to verify their identity.`,
              type: 'info'
            });
          });
        }
      }
      
      // If this is a bounced message, show a notification
      if (bounced) {
        console.log(`Received bounced message from ${from}`);
        setSecurityAlert({
          username: 'System',
          message: `Received delayed message from ${from} that was sent while you were offline.`,
          type: 'info'
        });
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
      
      // Create the message object
      const messageObj = { 
        from, 
        message: decryptedMessage, 
        fromDeviceId, 
        timestamp: new Date(timestamp || new Date()),
        encrypted,
        decryptionStatus,
        bounced: bounced || false
      };
      
      // Add to global messages for backward compatibility
      setMessages(msgs => [...msgs, messageObj]);
      
      // Add message to the appropriate chat
      setChatMessages(prev => {
        const updatedMessages = { 
          ...prev,
          [from]: [...(prev[from] || []), messageObj]
        };
        
        // Save to localStorage
        saveChatHistory(username, from, updatedMessages[from]);
        
        return updatedMessages;
      });
      
      // If this chat is not the current chat, increment unread count
      if (currentChat !== from) {
        setUnreadCounts(prev => {
          const newCounts = {
            ...prev,
            [from]: (prev[from] || 0) + 1
          };
          
          // Save to localStorage
          saveUnreadCounts(username, newCounts);
          
          return newCounts;
        });
        
        // Also increment in localStorage
        incrementUnreadCount(username, from);
      }
      
      // Make sure this user is in our active chats
      setActiveChats(prev => {
        if (!prev[from]) {
          return {
            ...prev,
            [from]: true
          };
        }
        return prev;
      });
      
      // Check user status
      checkUserStatus(from);
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
      
      // Update recipient status for all active chats
      if (activeChats[user]) {
        setRecipientStatuses(prev => ({
          ...prev,
          [user]: { 
            ...prev[user],
            exists: true, 
            online 
          }
        }));
      }
      
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
        
        // Update status for all active chats
        Object.keys(activeChats).forEach(chatUser => {
          const isOnline = data.users.includes(chatUser);
          setRecipientStatuses(prev => ({
            ...prev,
            [chatUser]: { 
              ...prev[chatUser],
              exists: prev[chatUser]?.exists || isOnline, 
              online: isOnline 
            }
          }));
        });
      }
    });
    
    // Typing indicators
    socketRef.current.on('userTyping', (data) => {
      const { username: typingUser } = data;
      
      // Update typing status for this user
      setTypingUsers(prev => ({
        ...prev,
        [typingUser]: true
      }));
      
      // For backward compatibility
      if (typingUser === recipient) {
        setTyping(true);
      }
      
      // Clear any existing timeout
      clearTimeout(typingTimeoutRef.current);
      
      // Set a timeout to clear the typing indicator after 3 seconds
      typingTimeoutRef.current = setTimeout(() => {
        setTypingUsers(prev => ({
          ...prev,
          [typingUser]: false
        }));
        
        // For backward compatibility
        if (typingUser === recipient) {
          setTyping(false);
        }
      }, 3000);
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

  // Key verification functions
  const initializeVerificationStatuses = () => {
    // Load verification statuses for all active chats
    const activeChats = getActiveChats(username);
    const initialVerificationStatuses = {};
    
    activeChats.forEach(chatUser => {
      const verifiedKey = getVerifiedKey(username, chatUser);
      if (verifiedKey) {
        initialVerificationStatuses[chatUser] = {
          verified: true,
          status: 'verified',
          message: 'Identity verified',
          verifiedAt: verifiedKey.verifiedAt,
          fingerprint: verifiedKey.fingerprint
        };
      } else {
        initialVerificationStatuses[chatUser] = {
          verified: false,
          status: 'unverified',
          message: 'Identity not verified'
        };
      }
    });
    
    setVerificationStatuses(initialVerificationStatuses);
  };
  
  const handleVerifyIdentity = (contactUsername) => {
    // Get the public key for this contact
    const contactPublicKey = publicKeys[contactUsername];
    
    if (!contactPublicKey) {
      setSecurityAlert({
        username: 'System',
        message: `Cannot verify ${contactUsername}'s identity: No public key available.`,
        type: 'error'
      });
      return;
    }
    
    // Generate fingerprint for the key
    generateKeyFingerprint(contactPublicKey).then(fingerprint => {
      // Check if we already have a verified key for this contact
      const verifiedKey = getVerifiedKey(username, contactUsername);
      
      let verificationInfo = {
        contactUsername,
        fingerprint,
        status: 'new_contact',
        message: 'New contact verification'
      };
      
      if (verifiedKey) {
        // We have a verified key, check if it matches
        if (verifiedKey.fingerprint !== fingerprint) {
          // Key mismatch
          verificationInfo = {
            contactUsername,
            fingerprint,
            previousFingerprint: verifiedKey.fingerprint,
            status: 'key_mismatch',
            message: 'Public key has changed since last verification',
            verifiedAt: verifiedKey.verifiedAt
          };
        } else {
          // Key matches
          verificationInfo = {
            contactUsername,
            fingerprint,
            status: 'verified',
            message: 'Identity verified',
            verifiedAt: verifiedKey.verifiedAt
          };
        }
      }
      
      // Show verification modal
      setCurrentVerification(verificationInfo);
      setShowVerificationModal(true);
    }).catch(error => {
      console.error('Error generating key fingerprint:', error);
      setSecurityAlert({
        username: 'System',
        message: `Error verifying identity: ${error.message}`,
        type: 'error'
      });
    });
  };
  
  const handleConfirmVerification = () => {
    if (!currentVerification || !currentVerification.contactUsername) return;
    
    const { contactUsername } = currentVerification;
    const contactPublicKey = publicKeys[contactUsername];
    
    if (!contactPublicKey) {
      setSecurityAlert({
        username: 'System',
        message: `Cannot verify ${contactUsername}'s identity: No public key available.`,
        type: 'error'
      });
      setShowVerificationModal(false);
      return;
    }
    
    // Store the verified key
    storeVerifiedKey(username, contactUsername, contactPublicKey, deviceId);
    
    // Update verification status
    setVerificationStatuses(prev => ({
      ...prev,
      [contactUsername]: {
        verified: true,
        status: 'verified',
        message: 'Identity verified',
        verifiedAt: Date.now(),
        fingerprint: currentVerification.fingerprint
      }
    }));
    
    // Show confirmation
    setSecurityAlert({
      username: 'System',
      message: `${contactUsername}'s identity has been verified.`,
      type: 'success'
    });
    
    // Close modal
    setShowVerificationModal(false);
  };
  
  const handleCancelVerification = () => {
    setShowVerificationModal(false);
  };

  // Initialize chat data from localStorage
  const initializeChatData = () => {
    // Load active chats
    const activeChats = getActiveChats(username);
    
    // Initialize chat data
    const initialChatMessages = {};
    const initialUnreadCounts = loadUnreadCounts(username);
    const initialRecipientStatuses = {};
    
    // Load chat history for each active chat
    activeChats.forEach(chatUser => {
      initialChatMessages[chatUser] = loadChatHistory(username, chatUser);
      initialRecipientStatuses[chatUser] = { exists: true, online: onlineUsers.includes(chatUser) };
    });
    
    // Update state
    setChatMessages(initialChatMessages);
    setUnreadCounts(initialUnreadCounts);
    setRecipientStatuses(initialRecipientStatuses);
    
    // Set active chats
    const activeChatsObj = {};
    activeChats.forEach(chatUser => {
      activeChatsObj[chatUser] = true;
    });
    setActiveChats(activeChatsObj);
    
    // Initialize verification statuses
    initializeVerificationStatuses();
  };

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
            
            // Initialize chat data from localStorage
            initializeChatData();
            
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
        message: 'Cannot connect: Server is offline',
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
      
      // Check if this is the first message to this recipient
      const previousMessages = chatMessages[recipient] || [];
      const isFirstMessage = previousMessages.length === 0;
      
      // If this is the first message and we have the recipient's public key but haven't verified it
      if (isFirstMessage && publicKeys[recipient] && !hasVerifiedKey(username, recipient)) {
        // Show verification warning
        const shouldProceed = window.confirm(
          `⚠️ You haven't previously verified the identity of ${recipient}.\n\n` +
          `Proceed only if you trust them. You can verify their identity after sending the message.`
        );
        
        if (!shouldProceed) {
          setStatus('Registered successfully');
          return;
        }
        
        // Generate fingerprint for the key
        const fingerprint = await generateKeyFingerprint(publicKeys[recipient]);
        
        // Set as unverified
        setVerificationStatuses(prev => ({
          ...prev,
          [recipient]: {
            verified: false,
            status: 'unverified',
            message: 'Identity not verified',
            fingerprint
          }
        }));
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
          // Create message object
          const messageObj = { 
            from: username, 
            message: message.trim(), // Store original message for display
            fromDeviceId: deviceId, 
            timestamp: new Date(),
            status: response.delivered ? 'delivered' : 'bounced',
            expiresAt: response.expiresAt,
            encrypted: isEncrypted
          };
          
          // Add to global messages for backward compatibility
          setMessages(msgs => [...msgs, messageObj]);
          
          // Add message to the appropriate chat
          setChatMessages(prev => {
            const updatedMessages = { 
              ...prev,
              [recipient]: [...(prev[recipient] || []), messageObj]
            };
            
            // Save to localStorage
            saveChatHistory(username, recipient, updatedMessages[recipient]);
            
            return updatedMessages;
          });
          
          // Make sure this user is in our active chats
          setActiveChats(prev => {
            if (!prev[recipient]) {
              return {
                ...prev,
                [recipient]: true
              };
            }
            return prev;
          });
          
          // Clear message input
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
              
              // Create message object
              const messageObj = { 
                from: username, 
                message: message.trim(),
                fromDeviceId: deviceId, 
                timestamp: new Date(),
                status: 'bounced',
                expiresAt: Date.now() + 14400000, // 4 hours
                encrypted: isEncrypted
              };
              
              // Add to global messages for backward compatibility
              setMessages(msgs => [...msgs, messageObj]);
              
              // Add message to the appropriate chat
              setChatMessages(prev => {
                const updatedMessages = { 
                  ...prev,
                  [recipient]: [...(prev[recipient] || []), messageObj]
                };
                
                // Save to localStorage
                saveChatHistory(username, recipient, updatedMessages[recipient]);
                
                return updatedMessages;
              });
              
              // Make sure this user is in our active chats
              setActiveChats(prev => {
                if (!prev[recipient]) {
                  return {
                    ...prev,
                    [recipient]: true
                  };
                }
                return prev;
              });
              
              // Clear message input
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
    
    if (!recipient || !message.trim() || !socketRef.current) {
      console.log('Cannot send relay message: missing recipient, message, or socket');
      return;
    }
    
    // Show confirmation before bouncing
    const confirmBounce = window.confirm(
      `RELAY MESSAGE\n\n` +
      `Your message to "${recipient}" will be securely encrypted and will continuously bounce across the relay network\n` +
      `until ${recipient} comes online or registers with the network.\n\n` +
      `It will not be stored at any single point for long, ensuring privacy and delivery reliability.\n\n` +
      `Do you want to continue?`
    );
    
    if (confirmBounce) {
      // Create a synthetic event object with preventDefault method
      const syntheticEvent = { preventDefault: () => {} };
      
      // Call handleSend with our synthetic event and bounce=true
      handleSend(syntheticEvent, true);
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
    // Store the current socket reference
    const currentSocket = socketRef.current;
    
    // Reset all state immediately to ensure the UI updates right away
    setConnected(false);
    setUsername('');
    setOnlineUsers([]); 
    setActiveChats({});
    setChatMessages({});
    setCurrentChat(null);
    setStatus('Disconnected');
    setPublicKeys({});
    setEncryptionStatus('disconnected');
    setRecipientStatuses({}); 
    setMessages([]);
    setRecipientStatus({ exists: false, online: false });
    
    // Clear intervals
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    
    // Notify the server and disconnect only if socket exists
    if (currentSocket) {
      try {
        // Notify the server that we're intentionally disconnecting
        currentSocket.emit('userLogout', { username, deviceId });
        
        // Give a small delay to ensure the logout message is sent before disconnecting
        setTimeout(() => {
          try {
            if (currentSocket.connected) {
              currentSocket.disconnect();
            }
          } catch (error) {
            console.error('Error disconnecting socket:', error);
          }
          // Clear the socket reference
          socketRef.current = null;
        }, 100);
      } catch (error) {
        console.error('Error during disconnect:', error);
        // Ensure socket reference is cleared even if there's an error
        socketRef.current = null;
      }
    } else {
      console.log('No active socket connection to disconnect');
      socketRef.current = null;
    }
    
    // Set relay status to offline
    setRelayStatus('offline');
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
      width: '100vw',
      height: '100vh',
      color: '#a2aabc', 
      display: 'flex', 
      flexDirection: 'column',
      fontFamily: '"Fira Code", monospace',
      overflow: 'hidden'
    }}>
      <div style={{ 
        background: '#171c28', 
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          padding: '16px 24px',
          borderBottom: '1px solid #1e2d3d'
        }}>
          <h2 style={{ 
            margin: 0, 
            color: '#5ccfe6', 
            fontFamily: '"Fira Code", monospace',
            letterSpacing: '1px'
          }}>WhisperNet_</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ 
              fontSize: 12, 
              padding: '4px 8px', 
              borderRadius: 4, 
              background: relayStatus === 'online' ? '#1c4b3c' : '#4b1c1c',
              color: relayStatus === 'online' ? '#5ccfe6' : '#ff8f40',
              cursor: 'pointer'
            }} onClick={() => setShowConnectionInfo(!showConnectionInfo)}>
              {relayStatus === 'online' ? 'Online' : 
               relayStatus === 'checking' ? 'Checking...' : 'Offline'}
            </div>
            <div style={{ 
              fontSize: 12, 
              padding: '4px 8px', 
              borderRadius: 4, 
              background: '#1c3b4b',
              color: '#5ccfe6',
              cursor: 'pointer'
            }} onClick={() => setShowAboutPage(true)}>
              About
            </div>
          </div>
        </div>
        
        {showConnectionInfo && (
          <div style={{ 
            background: '#0d1117', 
            padding: '8px 24px', 
            fontSize: 12, 
            fontFamily: 'monospace',
            borderBottom: '1px solid #1e2d3d',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px 24px'
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
            <div>Connection Status: <span style={{
              color: relayStatus === 'online' ? '#bae67e' : '#ff8f40'
            }}>{relayStatus}</span></div>
            {deviceId && <div>Device ID: {deviceId.substring(0, 8)}...</div>}
          </div>
        )}
        
        {showAboutPage && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(13, 17, 23, 0.95)',
            zIndex: 1000,
            padding: '20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px'
            }}>
              <h2 style={{ 
                margin: 0, 
                color: '#5ccfe6', 
                fontFamily: '"Fira Code", monospace',
                letterSpacing: '1px'
              }}>About WhisperNet_</h2>
              <button 
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#636b78', 
                  cursor: 'pointer',
                  fontSize: 24
                }}
                onClick={() => setShowAboutPage(false)}
              >
                ×
              </button>
            </div>
            
            <div style={{
              color: '#a2aabc',
              fontFamily: '"Fira Code", monospace',
              fontSize: '14px',
              lineHeight: '1.6',
              maxWidth: '800px',
              margin: '0 auto',
              padding: '20px',
              background: '#171c28',
              borderRadius: '8px',
              border: '1px solid #1e2d3d'
            }}>
              <h3 style={{ color: '#bae67e', marginTop: 0 }}>What is WhisperNet?</h3>
              <p>
                WhisperNet is a secure, decentralized messaging platform designed for private communications. 
                It uses end-to-end encryption and a distributed relay network to ensure your messages remain private and secure.
              </p>
              
              <h3 style={{ color: '#bae67e' }}>How It Works</h3>
              <p>
                <span style={{ color: '#5ccfe6' }}>End-to-End Encryption:</span> All messages are encrypted on your device before being sent. 
                Only the intended recipient can decrypt and read them.
              </p>
              <p>
                <span style={{ color: '#5ccfe6' }}>Distributed Relay Network:</span> Instead of storing messages on a central server, 
                WhisperNet uses a network of relay nodes to pass messages between users. This prevents any single point of failure or surveillance.
              </p>
              <p>
                <span style={{ color: '#5ccfe6' }}>Message Bouncing:</span> When a recipient is offline, messages "bounce" through the relay network 
                until delivery. Messages are never stored permanently on any server.
              </p>
              
              <h3 style={{ color: '#bae67e' }}>Key Features</h3>
              <ul style={{ paddingLeft: '20px' }}>
                <li><span style={{ color: '#ff8f40' }}>Direct Messaging:</span> Send encrypted messages directly when both users are online.</li>
                <li><span style={{ color: '#ff8f40' }}>Relay Messaging:</span> Send messages that will be delivered when the recipient comes online.</li>
                <li><span style={{ color: '#ff8f40' }}>Identity Verification:</span> Verify the identity of your contacts to prevent man-in-the-middle attacks.</li>
                <li><span style={{ color: '#ff8f40' }}>Offline Message Delivery:</span> Messages sent while you're offline will be delivered when you reconnect.</li>
              </ul>
              
              <h3 style={{ color: '#bae67e' }}>Security Model</h3>
              <p>
                WhisperNet uses asymmetric cryptography (public/private key pairs) to secure communications:
              </p>
              <ul style={{ paddingLeft: '20px' }}>
                <li>Each user generates a unique cryptographic identity</li>
                <li>Messages are encrypted with the recipient's public key</li>
                <li>Only the recipient's private key can decrypt the messages</li>
                <li>Key verification ensures you're talking to the right person</li>
              </ul>
              
              <h3 style={{ color: '#bae67e' }}>The Relay Network</h3>
              <p>
                The relay network is what makes WhisperNet unique:
              </p>
              <ul style={{ paddingLeft: '20px' }}>
                <li>Messages bounce between relay nodes until delivered</li>
                <li>No message is stored permanently on any single server</li>
                <li>The network is resilient to outages and censorship</li>
                <li>Your IP address is obscured from the recipient</li>
              </ul>
              
              <h3 style={{ color: '#bae67e' }}>Privacy Considerations</h3>
              <p>
                WhisperNet is designed with privacy in mind:
              </p>
              <ul style={{ paddingLeft: '20px' }}>
                <li>No phone number or email required to register</li>
                <li>No metadata collection or user tracking</li>
                <li>No permanent storage of messages</li>
                <li>Open-source code for transparency</li>
              </ul>
              
              <h3 style={{ color: '#bae67e' }}>Application Workflow</h3>
              <div style={{ textAlign: 'center', margin: '20px 0' }}>
                <div style={{ 
                  background: '#0d1117', 
                  padding: '20px', 
                  borderRadius: '8px', 
                  border: '1px solid #1e2d3d',
                  display: 'inline-block',
                  maxWidth: '100%',
                  overflowX: 'auto'
                }}>
                  <pre style={{ 
                    color: '#a2aabc', 
                    margin: 0, 
                    textAlign: 'left',
                    fontFamily: '"Fira Code", monospace',
                    fontSize: '12px',
                    lineHeight: '1.5'
                  }}>
{`┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  User Interface │     │  Relay Network  │     │  Encryption     │
│                 │     │                 │     │  System         │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ - Login         │     │ - Message       │     │ - Key           │
│ - Chat UI       │     │   Routing       │     │   Generation    │
│ - User List     │     │ - Relay         │     │ - Encryption    │
│ - Message Input │     │   Bouncing      │     │ - Decryption    │
│ - Verification  │     │ - User Status   │     │ - Verification  │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│                    Secure Communication                       │
│                                                               │
└───────────────────────────────────────────────────────────────┘`}
                  </pre>
                </div>
              </div>
              
              <h3 style={{ color: '#bae67e' }}>Collaborators</h3>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'center', 
                gap: '30px', 
                flexWrap: 'wrap',
                margin: '20px 0'
              }}>
                <div style={{ textAlign: 'center' }}>
                  <a 
                    href="https://github.com/Prathamesh0901" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: '#5ccfe6', textDecoration: 'none' }}
                  >
                    <div style={{ fontSize: '16px', marginBottom: '5px' }}>Prathmesh Mane</div>
                    <div style={{ color: '#636b78', fontSize: '12px' }}>github.com/Prathamesh0901</div>
                  </a>
                </div>
                
                <div style={{ textAlign: 'center' }}>
                  <a 
                    href="https://github.com/JaidTamboli" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: '#5ccfe6', textDecoration: 'none' }}
                  >
                    <div style={{ fontSize: '16px', marginBottom: '5px' }}>Jaid Tamboli</div>
                    <div style={{ color: '#636b78', fontSize: '12px' }}>github.com/JaidTamboli</div>
                  </a>
                </div>
                
                <div style={{ textAlign: 'center' }}>
                  <a 
                    href="https://github.com/sidinsearch" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: '#5ccfe6', textDecoration: 'none' }}
                  >
                    <div style={{ fontSize: '16px', marginBottom: '5px' }}>Siddharth Shinde</div>
                    <div style={{ color: '#636b78', fontSize: '12px' }}>github.com/sidinsearch</div>
                  </a>
                </div>
              </div>
              
              <div style={{ marginTop: '30px', textAlign: 'center', color: '#636b78', fontSize: '12px' }}>
                WhisperNet © 2023 - Secure, Private, Decentralized Communications
              </div>
            </div>
          </div>
        )}
        
        {securityAlert && (
          <div style={{ 
            background: '#4b1c1c', 
            color: '#ff8f40', 
            padding: '12px 24px', 
            borderBottom: '1px solid #1e2d3d',
            position: 'relative',
            fontSize: 14
          }}>
            <div style={{ marginRight: 20 }}>{securityAlert.message}</div>
            <button 
              style={{ 
                position: 'absolute', 
                top: 12, 
                right: 24, 
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
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '0 24px'
          }}>
            <div style={{ 
              maxWidth: '400px',
              width: '100%'
            }}>
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                marginBottom: 24 
              }}>
                <img 
                  src={appIcon}
                  alt="WhisperNet Logo" 
                  style={{ 
                    width: '120px', 
                    height: '120px', 
                    marginBottom: 16,
                    borderRadius: '50%',
                    border: '2px solid #1e2d3d'
                  }} 
                />
                <div style={{ fontSize: 14, color: '#5ccfe6', marginTop: 8 }}>
                  {getTimestamp()} Initializing secure connection...
                </div>
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
                  {isCheckingUsername ? 'CHECKING...' : (relayStatus === 'online' ? 'AUTHENTICATE' : 'SERVER OFFLINE')}
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
          </div>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            overflow: 'hidden'
          }}>
            {/* User list sidebar */}
            <UserList 
              users={onlineUsers.map(user => ({ username: user, online: true }))}
              activeChats={activeChats}
              unreadCounts={unreadCounts}
              onSelectUser={openChat}
              currentUser={username}
              onClearHistory={handleClearAllHistory}
              onNewChat={handleNewChat}
            />
            
            {/* Main chat area */}
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}>
              {/* Welcome screen or active chat */}
              {!currentChat ? (
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  padding: '0 24px',
                  background: '#0d1117'
                }}>
                  <div style={{ 
                    fontSize: 24, 
                    color: '#5ccfe6', 
                    marginBottom: 16,
                    fontWeight: 'bold'
                  }}>
                    Welcome to WhisperNet
                  </div>
                  <div style={{ 
                    fontSize: 16, 
                    color: '#a2aabc', 
                    textAlign: 'center',
                    maxWidth: 500,
                    lineHeight: 1.5
                  }}>
                    Select a user from the sidebar to start a conversation or click on a username when you receive a message.
                  </div>
                  <div style={{ 
                    marginTop: 32,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center'
                  }}>
                    <div style={{ 
                      fontSize: 14, 
                      color: '#636b78', 
                      marginBottom: 8 
                    }}>
                      Connected as:
                    </div>
                    <div style={{ 
                      fontSize: 20, 
                      color: '#bae67e', 
                      fontWeight: 'bold' 
                    }}>
                      {username}
                    </div>
                  </div>
                  <button 
                    style={{ 
                      marginTop: 32,
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
                </div>
              ) : (
                <ChatBox 
                  recipient={currentChat}
                  messages={chatMessages[currentChat] || []}
                  username={username}
                  onSendMessage={(recipient, messageText) => {
                    console.log('Send message called with:', recipient, messageText);
                    
                    // Store the current values
                    const currentRecipient = recipient;
                    const currentMessage = messageText;
                    
                    // Set state
                    setRecipient(currentRecipient);
                    setMessage(currentMessage);
                    
                    // Check if recipient is online
                    const isRecipientOnline = recipientStatuses[currentRecipient] && 
                                             recipientStatuses[currentRecipient].online;
                    
                    if (!isRecipientOnline) {
                      // Recipient is offline, suggest using relay
                      const useRelay = window.confirm(
                        `${currentRecipient} appears to be offline.\n\n` +
                        `Would you like to send this as a relay message instead?\n` +
                        `(The message will be delivered when they come online)`
                      );
                      
                      if (useRelay) {
                        // Use the relay function instead
                        const relayEvent = { preventDefault: () => {} };
                        
                        // Show confirmation before relaying
                        const confirmRelay = window.confirm(
                          `RELAY MESSAGE\n\n` +
                          `Your message to "${currentRecipient}" will be securely encrypted and will continuously bounce across the relay network\n` +
                          `until ${currentRecipient} comes online or registers with the network.\n\n` +
                          `It will not be stored at any single point for long, ensuring privacy and delivery reliability.\n\n` +
                          `Do you want to continue?`
                        );
                        
                        if (confirmRelay) {
                          // Call relay function
                          sendRelayMessage(currentRecipient, currentMessage);
                        }
                        return;
                      } else {
                        // User wants to try direct message anyway
                        console.log('Attempting direct message to offline user:', currentRecipient);
                      }
                    }
                    
                    // Function to add message to chat history
                    function addMessageToChat(from, to, messageText, encrypted) {
                      const newMessage = {
                        from: from,
                        to: to,
                        message: messageText,
                        timestamp: Date.now(),
                        fromDeviceId: deviceId,
                        encrypted: encrypted
                      };
                      
                      // Update chat messages
                      setChatMessages(prev => {
                        const updatedMessages = { ...prev };
                        if (!updatedMessages[to]) {
                          updatedMessages[to] = [];
                        }
                        updatedMessages[to] = [...updatedMessages[to], newMessage];
                        
                        // Save to localStorage
                        saveChatHistory(username, to, updatedMessages[to]);
                        
                        return updatedMessages;
                      });
                    }
                    
                    // Function to send unencrypted message
                    function sendUnencryptedMessage() {
                      console.log('Sending unencrypted direct message to:', currentRecipient);
                      
                      if (!socketRef.current) {
                        console.error('Socket not available for direct message');
                        setSecurityAlert({
                          username: 'System',
                          message: 'Cannot send message: Connection not available',
                          type: 'error'
                        });
                        return;
                      }
                      
                      socketRef.current.emit('sendMessage', {
                        to: currentRecipient,
                        message: currentMessage,
                        from: username,
                        fromDeviceId: deviceId,
                        timestamp: Date.now(),
                        publicKey: keyPair ? keyPair.publicKey : null,
                        encrypted: false
                      });
                      
                      // Add message to chat
                      addMessageToChat(username, currentRecipient, currentMessage, false);
                    }
                    
                    // Function to send relay message
                    function sendRelayMessage(to, msg) {
                      if (!socketRef.current) {
                        console.error('Socket not available for relay message');
                        setSecurityAlert({
                          username: 'System',
                          message: 'Cannot send relay message: Connection not available',
                          type: 'error'
                        });
                        return;
                      }
                      
                      // Show sending indicator
                      setStatus('Sending relay message...');
                      
                      // Function to add relay message to chat
                      function addRelayMessageToChat(from, to, messageText, encrypted) {
                        const newMessage = {
                          from: from,
                          to: to,
                          message: messageText,
                          timestamp: Date.now(),
                          fromDeviceId: deviceId,
                          relayed: true,
                          encrypted: encrypted
                        };
                        
                        // Update chat messages
                        setChatMessages(prev => {
                          const updatedMessages = { ...prev };
                          if (!updatedMessages[to]) {
                            updatedMessages[to] = [];
                          }
                          updatedMessages[to] = [...updatedMessages[to], newMessage];
                          
                          // Save to localStorage
                          saveChatHistory(username, to, updatedMessages[to]);
                          
                          return updatedMessages;
                        });
                        
                        // Show success message
                        setSecurityAlert({
                          username: 'System',
                          message: `Message to ${to} will be delivered when they come online.`,
                          type: 'info'
                        });
                        
                        setStatus('Registered successfully');
                      }
                      
                      // Send unencrypted relay message
                      socketRef.current.emit('relayMessage', {
                        to: to,
                        message: msg,
                        from: username,
                        fromDeviceId: deviceId,
                        timestamp: Date.now(),
                        publicKey: keyPair ? keyPair.publicKey : null,
                        encrypted: false
                      }, (response) => {
                        if (response && response.success) {
                          // Add message to chat
                          addRelayMessageToChat(username, to, msg, false);
                        } else {
                          // Show error message
                          setSecurityAlert({
                            username: 'System',
                            message: `Failed to relay message: ${response && response.error ? response.error : 'Unknown error'}`,
                            type: 'error'
                          });
                          setStatus('Registered successfully');
                        }
                      });
                    }
                    
                    // Encrypt message if possible
                    if (encryptionEnabled && publicKeys[currentRecipient]) {
                      try {
                        console.log('Attempting to encrypt direct message for:', currentRecipient);
                        
                        // Try to encrypt the message
                        encryptMessage(currentMessage, publicKeys[currentRecipient])
                          .then(encryptedMessage => {
                            console.log('Successfully encrypted direct message');
                            
                            if (!socketRef.current) {
                              console.error('Socket not available for encrypted message');
                              setSecurityAlert({
                                username: 'System',
                                message: 'Cannot send message: Connection not available',
                                type: 'error'
                              });
                              return;
                            }
                            
                            // Send the encrypted message
                            socketRef.current.emit('sendMessage', {
                              to: currentRecipient,
                              message: encryptedMessage,
                              from: username,
                              fromDeviceId: deviceId,
                              timestamp: Date.now(),
                              publicKey: keyPair ? keyPair.publicKey : null,
                              encrypted: true
                            });
                            
                            // Update chat messages with the unencrypted version for display
                            addMessageToChat(username, currentRecipient, currentMessage, true);
                          })
                          .catch(error => {
                            console.error('Failed to encrypt message:', error);
                            // Send unencrypted as fallback
                            sendUnencryptedMessage();
                          });
                      } catch (error) {
                        console.error('Error in encryption:', error);
                        // Send unencrypted as fallback
                        sendUnencryptedMessage();
                      }
                    } else {
                      // Send unencrypted
                      sendUnencryptedMessage();
                    }
                  }}
                  onRelayMessage={(recipient, messageText) => {
                    console.log('Relay message called with:', recipient, messageText);
                    
                    // Store the current values
                    const currentRecipient = recipient;
                    const currentMessage = messageText;
                    
                    // Set state
                    setRecipient(currentRecipient);
                    setMessage(currentMessage);
                    
                    // Show confirmation before relaying
                    const confirmRelay = window.confirm(
                      `RELAY MESSAGE\n\n` +
                      `Your message to "${currentRecipient}" will be securely encrypted and will continuously bounce across the relay network\n` +
                      `until ${currentRecipient} comes online or registers with the network.\n\n` +
                      `It will not be stored at any single point for long, ensuring privacy and delivery reliability.\n\n` +
                      `Do you want to continue?`
                    );
                    
                    if (!confirmRelay) {
                      return; // User cancelled
                    }
                    
                    // Call relay function directly with the values
                    if (socketRef.current) {
                      // Show sending indicator
                      setStatus('Sending relay message...');
                      
                      // Function to add message to chat history
                      function addRelayMessageToChat(from, to, messageText, encrypted) {
                        const newMessage = {
                          from: from,
                          to: to,
                          message: messageText,
                          timestamp: Date.now(),
                          fromDeviceId: deviceId,
                          relayed: true,
                          encrypted: encrypted
                        };
                        
                        // Update chat messages
                        setChatMessages(prev => {
                          const updatedMessages = { ...prev };
                          if (!updatedMessages[to]) {
                            updatedMessages[to] = [];
                          }
                          updatedMessages[to] = [...updatedMessages[to], newMessage];
                          
                          // Save to localStorage
                          saveChatHistory(username, to, updatedMessages[to]);
                          
                          return updatedMessages;
                        });
                        
                        // Show success message
                        setSecurityAlert({
                          username: 'System',
                          message: `Message to ${to} will be delivered when they come online.`,
                          type: 'info'
                        });
                        
                        setStatus('Registered successfully');
                      }
                      
                      // Send unencrypted message first as a fallback
                      function sendUnencryptedRelayMessage() {
                        console.log('Sending unencrypted relay message to:', currentRecipient);
                        
                        socketRef.current.emit('relayMessage', {
                          to: currentRecipient,
                          message: currentMessage,
                          from: username,
                          fromDeviceId: deviceId,
                          timestamp: Date.now(),
                          publicKey: keyPair ? keyPair.publicKey : null,
                          encrypted: false
                        }, (response) => {
                          if (response && response.success) {
                            // Add message to chat
                            addRelayMessageToChat(username, currentRecipient, currentMessage, false);
                          } else {
                            // Show error message
                            setSecurityAlert({
                              username: 'System',
                              message: `Failed to relay message: ${response && response.error ? response.error : 'Unknown error'}`,
                              type: 'error'
                            });
                            setStatus('Registered successfully');
                          }
                        });
                      }
                      
                      // Try to encrypt if possible
                      if (encryptionEnabled && publicKeys[currentRecipient]) {
                        try {
                          console.log('Attempting to encrypt relay message for:', currentRecipient);
                          
                          // Try to encrypt the message
                          encryptMessage(currentMessage, publicKeys[currentRecipient])
                            .then(encryptedMessage => {
                              console.log('Successfully encrypted relay message');
                              
                              // Send the encrypted message
                              socketRef.current.emit('relayMessage', {
                                to: currentRecipient,
                                message: encryptedMessage,
                                from: username,
                                fromDeviceId: deviceId,
                                timestamp: Date.now(),
                                publicKey: keyPair ? keyPair.publicKey : null,
                                encrypted: true
                              }, (response) => {
                                if (response && response.success) {
                                  // Add message to chat with the unencrypted version for display
                                  addRelayMessageToChat(username, currentRecipient, currentMessage, true);
                                } else {
                                  console.error('Relay message failed:', response);
                                  // Show error message
                                  setSecurityAlert({
                                    username: 'System',
                                    message: `Failed to relay message: ${response && response.error ? response.error : 'Unknown error'}`,
                                    type: 'error'
                                  });
                                  setStatus('Registered successfully');
                                }
                              });
                            })
                            .catch(error => {
                              console.error('Failed to encrypt relay message:', error);
                              // Send unencrypted as fallback
                              sendUnencryptedRelayMessage();
                            });
                        } catch (error) {
                          console.error('Error in relay encryption:', error);
                          // Send unencrypted as fallback
                          sendUnencryptedRelayMessage();
                        }
                      } else {
                        // Send unencrypted
                        sendUnencryptedRelayMessage();
                      }
                    } else {
                      console.error('Socket not available for relay message');
                      setSecurityAlert({
                        username: 'System',
                        message: 'Cannot send relay message: Connection not available',
                        type: 'error'
                      });
                    }
                  }}
                  recipientStatus={recipientStatuses[currentChat] || { exists: false, online: false }}
                  typing={typingUsers[currentChat] || false}
                  onMessageChange={(message) => {
                    // Send typing indicator
                    if (socketRef.current && currentChat && message.length > 0) {
                      socketRef.current.emit('typing', { to: currentChat });
                    }
                  }}
                  onClose={() => closeChat(currentChat)}
                  verificationStatus={verificationStatuses[currentChat]}
                  onVerifyIdentity={handleVerifyIdentity}
                />
              )}
              
              {/* Connection status footer */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                padding: '8px 16px',
                borderTop: '1px solid #1e2d3d',
                background: '#171c28'
              }}>
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
                
                <button 
                  style={{ 
                    padding: '4px 12px', 
                    borderRadius: 4, 
                    background: '#4b1c1c', 
                    color: '#ff8f40', 
                    fontSize: 12, 
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: '"Fira Code", monospace'
                  }} 
                  onClick={handleDisconnect}
                >
                  DISCONNECT
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Verification Modal */}
      <VerificationModal
        isOpen={showVerificationModal}
        onClose={handleCancelVerification}
        verificationInfo={currentVerification || {}}
        onVerify={handleConfirmVerification}
        onCancel={handleCancelVerification}
        username={username}
      />
    </div>
  );
}

export default App;