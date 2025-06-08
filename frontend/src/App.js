import React, { useState, useRef, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import FingerprintJS from '@fingerprintjs/fingerprintjs';

// Import components
import ConnectionInfo from './components/ConnectionInfo';
import SecurityAlert from './components/SecurityAlert';
import LoginScreen from './components/LoginScreen';
import ChatInterface from './components/ChatInterface';
import AboutPage from './components/AboutPage';

const BASE_NODE_URL = process.env.REACT_APP_BASE_NODE_URL || "http://localhost:5000";

// Storage keys
const IDENTITY_STORAGE_KEY = 'whispernetKnownIdentities';
const CHAT_HISTORY_KEY = 'whispernetChatHistory';
const TRUST_STATUS_KEY = 'whispernetTrustStatus';

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
    
    // Convert the message to an ArrayBuffer
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
    
    // Convert the encrypted data to a base64 string
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
    
    // Convert the base64 string to an ArrayBuffer
    const encryptedData = new Uint8Array(
      atob(encryptedMessage)
        .split('')
        .map(char => char.charCodeAt(0))
    );
    
    // Decrypt the data
    const decryptedData = await window.crypto.subtle.decrypt(
      {
        name: "RSA-OAEP"
      },
      privateKey,
      encryptedData
    );
    
    // Convert the decrypted data to a string
    const decoder = new TextDecoder();
    return decoder.decode(decryptedData);
  } catch (error) {
    console.error('Error decrypting message:', error);
    throw error;
  }
};

function App() {
  // Connection state
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [status, setStatus] = useState('Initializing...');
  const [relayStatus, setRelayStatus] = useState('checking');
  const [relayServerUrl, setRelayServerUrl] = useState('');
  const [connectionDetails, setConnectionDetails] = useState({});
  const [showConnectionInfo, setShowConnectionInfo] = useState(false);
  const [securityAlert, setSecurityAlert] = useState(null);
  
  // Message state
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [recipientStatus, setRecipientStatus] = useState({ exists: false, online: false });
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState(true);
  
  // Encryption state
  const [keyPair, setKeyPair] = useState(null);
  const [publicKeys, setPublicKeys] = useState({});
  const [encryptionEnabled, setEncryptionEnabled] = useState(true);
  const [encryptionStatus, setEncryptionStatus] = useState('initializing');
  const [knownIdentities, setKnownIdentities] = useState({}); // username -> {deviceId, publicKey, firstSeen}
  const [identityMismatch, setIdentityMismatch] = useState(null); // {username, originalDeviceId, newDeviceId, action}
  const [showIdentityWarning, setShowIdentityWarning] = useState(false);
  
  // New state variables for enhanced chat functionality
  const [chatHistory, setChatHistory] = useState({}); // username -> array of messages
  const [contacts, setContacts] = useState([]); // list of usernames the current user has chatted with
  const [activeChat, setActiveChat] = useState(null); // currently selected chat
  const [trustStatus, setTrustStatus] = useState({}); // username -> {trusted: boolean, keyExchanged: boolean, mutualMessaging: boolean}
  const [showTrustWarning, setShowTrustWarning] = useState(false); // whether to show the trust warning for the current chat
  
  // UI state variables
  const [showAboutPage, setShowAboutPage] = useState(false); // whether to show the About page
  
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const recipientCheckTimeoutRef = useRef(null);

  // Load known identities from localStorage
  const loadKnownIdentities = () => {
    try {
      const storedIdentities = localStorage.getItem(IDENTITY_STORAGE_KEY);
      if (storedIdentities) {
        setKnownIdentities(JSON.parse(storedIdentities));
      }
    } catch (error) {
      console.error('Error loading known identities:', error);
    }
  };
  
  // Save known identities to localStorage
  const saveKnownIdentities = (identities) => {
    try {
      localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identities));
    } catch (error) {
      console.error('Error saving known identities:', error);
    }
  };
  
  // Load chat history from localStorage
  const loadChatHistory = () => {
    try {
      const storedChatHistory = localStorage.getItem(CHAT_HISTORY_KEY);
      if (storedChatHistory) {
        const parsedChatHistory = JSON.parse(storedChatHistory);
        setChatHistory(parsedChatHistory);
        
        // Extract contacts from chat history
        const contactsList = Object.keys(parsedChatHistory);
        setContacts(contactsList);
        console.log('Loaded chat history for contacts:', contactsList.length);
        
        // If we have contacts but no active chat, set the first contact as active
        if (contactsList.length > 0 && !activeChat) {
          setActiveChat(contactsList[0]);
          setRecipient(contactsList[0]);
        }
      }
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  };
  
  // Save chat history to localStorage
  const saveChatHistory = (history) => {
    try {
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
      console.error('Error saving chat history:', error);
    }
  };
  
  // Load trust status from localStorage
  const loadTrustStatus = () => {
    try {
      const storedTrustStatus = localStorage.getItem(TRUST_STATUS_KEY);
      if (storedTrustStatus) {
        setTrustStatus(JSON.parse(storedTrustStatus));
      }
    } catch (error) {
      console.error('Error loading trust status:', error);
    }
  };
  
  // Save trust status to localStorage
  const saveTrustStatus = (status) => {
    try {
      localStorage.setItem(TRUST_STATUS_KEY, JSON.stringify(status));
    } catch (error) {
      console.error('Error saving trust status:', error);
    }
  };
  
  // Update chat history for a specific contact
  const updateChatHistory = (contact, message) => {
    setChatHistory(prevHistory => {
      const updatedHistory = { ...prevHistory };
      
      // Initialize chat history for this contact if it doesn't exist
      if (!updatedHistory[contact]) {
        updatedHistory[contact] = [];
      }
      
      // Add the message to the chat history
      updatedHistory[contact] = [...updatedHistory[contact], message];
      
      // Save the updated chat history
      saveChatHistory(updatedHistory);
      
      // Update contacts list if this is a new contact
      if (!contacts.includes(contact)) {
        const updatedContacts = [...contacts, contact];
        setContacts(updatedContacts);
      }
      
      return updatedHistory;
    });
  };
  
  // Check and update trust status for a contact
  const updateTrustStatus = (contact, updates) => {
    setTrustStatus(prevStatus => {
      const updatedStatus = { ...prevStatus };
      
      // Initialize trust status for this contact if it doesn't exist
      if (!updatedStatus[contact]) {
        updatedStatus[contact] = {
          trusted: false,
          keyExchanged: false,
          mutualMessaging: false,
          sentMessage: false,
          receivedMessage: false,
          firstInteraction: new Date().toISOString()
        };
      }
      
      // Apply updates
      updatedStatus[contact] = {
        ...updatedStatus[contact],
        ...updates
      };
      
      // Check if mutual messaging has occurred
      if (updatedStatus[contact].sentMessage && updatedStatus[contact].receivedMessage) {
        updatedStatus[contact].mutualMessaging = true;
        
        // If mutual messaging has occurred and we have their public key, mark as trusted and exchange keys
        if (publicKeys[contact]) {
          updatedStatus[contact].keyExchanged = true;
          updatedStatus[contact].trusted = true;
          
          // Update the UI to show trust status change
          if (contact === recipient) {
            setShowTrustWarning(false);
          }
        }
      } else {
        // If we don't have mutual messaging yet, make sure to show the warning
        if (contact === recipient) {
          setShowTrustWarning(true);
        }
      }
      
      // Save the updated trust status
      saveTrustStatus(updatedStatus);
      
      return updatedStatus;
    });
  };

  // Initialize device fingerprint
  useEffect(() => {
    const initializeFingerprint = async () => {
      try {
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const deviceId = result.visitorId;
        setDeviceId(deviceId);
        console.log('Device fingerprint:', deviceId);
      } catch (error) {
        console.error('Error initializing fingerprint:', error);
        setStatus('Error initializing device fingerprint');
      }
    };
    
    initializeFingerprint();
    loadKnownIdentities();
    loadChatHistory();
    loadTrustStatus();
    checkRelayStatus();
    
    // Scroll to bottom when messages change
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
    
    // Add window unload handler to ensure username is released when browser is closed
    const handleBeforeUnload = () => {
      if (socketRef.current && socketRef.current.connected && username) {
        // Synchronous logout call to ensure it happens before page unload
        socketRef.current.emit('userLogout', { username, deviceId });
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      // Clean up event listener
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      // Logout and disconnect
      if (socketRef.current && socketRef.current.connected && username) {
        socketRef.current.emit('userLogout', { username, deviceId });
        socketRef.current.disconnect();
      }
      
      clearInterval(pingIntervalRef.current);
      clearTimeout(recipientCheckTimeoutRef.current);
      clearTimeout(typingTimeoutRef.current);
    };
  }, [username, deviceId]);
  
  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);
  
  // Update connection info when connection details change
  useEffect(() => {
    if (connected && showConnectionInfo) {
      // Update connection info
    }
  }, [connected, showConnectionInfo, username]);

  const checkRelayStatus = async () => {
    setRelayStatus('checking');
    setStatus('Checking base node status...');
    
    // Try HTTP health check first
    try {
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
    
    tempSocket.on('connect', () => {
      console.log('Connected to base node for status check');
      setRelayStatus('online');
      setStatus('Base node online. Please login.');
      tempSocket.disconnect();
    });
    
    tempSocket.on('connect_error', (err) => {
      console.error('Base node connection error:', err);
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

  const handleUsernameSubmit = async (e) => {
    e.preventDefault();
    
    if (!username.trim() || !deviceId) {
      setStatus('Please enter a valid username');
      return;
    }
    
    if (relayStatus !== 'online') {
      setStatus('Cannot connect: Base node is offline');
      return;
    }
    
    try {
      setStatus('Checking username availability...');
      setIsCheckingUsername(true);
      
      // Skip username check if we're in development mode and the server is not responding
      let usernameIsAvailable = true;
      
      try {
        // Check if username is available
        const response = await axios.get(`${BASE_NODE_URL}/check-username/${username}`, {
          timeout: 5000
        });
        
        usernameIsAvailable = response.data.available;
      } catch (checkError) {
        console.warn('Username check failed, proceeding anyway:', checkError);
        // In case of error, we'll assume the username is available
        // This allows development without the backend running
      }
      
      setIsCheckingUsername(false);
      
      if (usernameIsAvailable) {
        console.log('Username is available');
        setUsernameAvailable(true);
        
        // Generate encryption keys if needed
        if (!keyPair) {
          setStatus('Generating encryption keys...');
          try {
            const newKeyPair = await generateKeyPair();
            setKeyPair(newKeyPair);
            setEncryptionStatus('ready');
            console.log('Encryption keys generated successfully');
          } catch (error) {
            console.error('Failed to generate encryption keys:', error);
            setEncryptionStatus('failed');
            setSecurityAlert({
              username: 'System',
              message: 'Failed to generate encryption keys. Messages will not be encrypted.',
              type: 'error'
            });
          }
        }
        
        setConnected(true);
        setStatus('Connecting to network...');
      } else {
        console.log('Username is already taken');
        setUsernameAvailable(false);
        setStatus('Username is already taken. Please choose another.');
      }
    } catch (error) {
      console.error('Error in username submission process:', error);
      setIsCheckingUsername(false);
      
      // Allow login anyway in case of errors
      setUsernameAvailable(true);
      setConnected(true);
      setStatus('Connecting to network (username check bypassed)...');
    }
  };

  const handleUsernameChange = (e) => {
    const newUsername = e.target.value.trim();
    setUsername(newUsername);
    
    // Reset availability check when username changes
    setUsernameAvailable(true);
    
    // Check username availability after a short delay
    if (newUsername.length > 2) {
      setIsCheckingUsername(true);
      clearTimeout(window.usernameCheckTimeout);
      
      window.usernameCheckTimeout = setTimeout(async () => {
        try {
          const response = await axios.get(`${BASE_NODE_URL}/check-username/${newUsername}`, {
            timeout: 5000
          });
          
          setIsCheckingUsername(false);
          setUsernameAvailable(response.data.available);
        } catch (error) {
          console.warn('Error checking username availability:', error);
          // In case of error, assume username is available to allow development without backend
          setIsCheckingUsername(false);
          setUsernameAvailable(true);
        }
      }, 500);
    } else {
      setIsCheckingUsername(false);
    }
  };

  const handleDisconnect = () => {
    if (socketRef.current) {
      // Explicitly notify the server that we're logging out
      socketRef.current.emit('userLogout', { username, deviceId }, (response) => {
        console.log('Logout response:', response);
        // Disconnect after logging out
        socketRef.current.disconnect();
      });
      
      // Set a timeout to force disconnect in case the server doesn't respond
      setTimeout(() => {
        if (socketRef.current && socketRef.current.connected) {
          socketRef.current.disconnect();
        }
      }, 1000);
    }
    
    setConnected(false);
    setUsername('');
    setMessages([]);
    setStatus('Disconnected');
    clearInterval(pingIntervalRef.current);
    clearTimeout(recipientCheckTimeoutRef.current);
    clearTimeout(typingTimeoutRef.current);
  };

  const connectToBaseNode = () => {
    // Clear any previous connection
    if (socketRef.current) {
      // First try to logout to release the username
      if (socketRef.current.connected) {
        console.log(`Logging out user ${username} to release username before reconnection`);
        socketRef.current.emit('userLogout', { username, deviceId }, () => {
          console.log('Logout acknowledged by server, disconnecting socket');
          socketRef.current.disconnect();
          proceedWithBaseNodeConnection();
        });
        
        // Set a timeout in case the server doesn't respond
        setTimeout(() => {
          if (socketRef.current && socketRef.current.connected) {
            console.log('Logout response timeout, forcing disconnect');
            socketRef.current.disconnect();
            proceedWithBaseNodeConnection();
          }
        }, 1000);
      } else {
        socketRef.current.disconnect();
        proceedWithBaseNodeConnection();
      }
    } else {
      proceedWithBaseNodeConnection();
    }
    
    function proceedWithBaseNodeConnection() {
      // Always connect to base node first for handshake and relay discovery
      console.log('Connecting to base node for initial handshake:', BASE_NODE_URL);
      setStatus('Connecting to base node for handshake...');
      
      socketRef.current = io(BASE_NODE_URL, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        query: { 
          username,
          deviceId,
          publicKey: keyPair?.publicKey ? JSON.stringify(keyPair.publicKey) : null,
          timestamp: Date.now() // Add timestamp to prevent caching issues
        },
        auth: {
          username,
          deviceId,
          timestamp: Date.now() // Add timestamp to prevent caching issues
        },
        forceNew: true
      });
      
      // Connection event handlers
      socketRef.current.on('connect', () => {
        console.log('Connected to base node with socket ID:', socketRef.current.id);
        setStatus('Connected to base node for handshake');
        setRelayStatus('online');
        
        // When connecting to the base node, set the relay information accordingly
        setConnectionDetails({
          socketId: socketRef.current.id,
          transport: socketRef.current.io.engine.transport.name,
          baseNodeUrl: BASE_NODE_URL,
          relayId: 'base_handshake',
          relayStatus: 'handshake'
        });
        
        setRelayServerUrl('Base Node (Handshake)');
        
        // Register with the base node
        socketRef.current.emit('registerUser', { 
          username, 
          deviceId,
          publicKey: keyPair?.publicKey,
          timestamp: Date.now() // Add timestamp to ensure fresh registration
        }, (response) => {
          console.log('Registration response:', response);
          
          if (response && response.success) {
            console.log(`User ${username} registered successfully with base node`);
            setStatus('Registered successfully with base node');
            
            // Connect socket events
            connectSocketEvents();
            
            // Start ping interval
            startPingInterval();
            
            // Get available relays first
            socketRef.current.emit('getAvailableRelays', {}, (response) => {
              console.log('Available relays:', response);
              
              if (response && response.relays && response.relays.length > 0) {
                // Cache relay information
                localStorage.setItem('whispernetRelayCache', JSON.stringify({
                  timestamp: Date.now(),
                  relays: response.relays
                }));
                
                // Connect to the first available relay
                connectToRelay(response.relays);
              } else {
                console.log('No relays available, using base node');
                setStatus('No relay servers available, using base node');
                
                // Update connection details for direct base node connection
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
          } else {
            console.error('Registration failed:', response?.reason || 'Unknown error');
            setStatus(`Registration failed: ${response?.reason || 'Unknown error'}`);
          }
        });
      });
    }
    
    socketRef.current.on('connect_error', (err) => {
      console.error('Base node connection error:', err);
      setStatus(`Connection failed: ${err.message}`);
      setRelayStatus('offline');
      
      // Try to use cached relays if available
      try {
        const cachedRelayInfo = localStorage.getItem('whispernetRelayCache');
        if (cachedRelayInfo) {
          const relayInfo = JSON.parse(cachedRelayInfo);
          const cacheAge = Date.now() - relayInfo.timestamp;
          
          // Use cache if it's less than 1 hour old
          if (cacheAge < 3600000 && relayInfo.relays && relayInfo.relays.length > 0) {
            console.log('Using cached relay information');
            
            // Try to connect to the first cached relay
            connectToRelay(relayInfo.relays[0]);
            return;
          }
        }
      } catch (error) {
        console.error('Error parsing cached relay info:', error);
      }
    });
    
    socketRef.current.on('disconnect', (reason) => {
      console.log('Disconnected from base node:', reason);
      setStatus(`Disconnected: ${reason}`);
      
      // Don't auto-reconnect if user manually disconnected
      if (reason !== 'io client disconnect' && connected) {
        setStatus('Reconnecting...');
        
        // Try to reconnect after a delay
        setTimeout(() => {
          if (connected) {
            connectToBaseNode();
          }
        }, 3000);
      }
    });
  };

  const connectToRelay = (relays) => {
    if (!relays || !relays.length) {
      console.log('No relays available to connect to');
      return;
    }
    
    // Use the first available relay
    const relay = relays[0];
    const relayUrl = relay.url || (relay.id && (relay.id.startsWith('http') ? relay.id : `http://${relay.id}`));
    
    if (!relayUrl) {
      console.error('Invalid relay information');
      return;
    }
    
    console.log(`Switching to relay server: ${relayUrl}`);
    setStatus(`Connecting to relay server: ${relay.id || relayUrl}...`);
    
    // Disconnect from base node first
    if (socketRef.current) {
      // Keep a reference to the old socket for cleanup
      const oldSocket = socketRef.current;
      
      // Create new socket for relay
      socketRef.current = io(relayUrl, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 3,
        reconnectionDelay: 2000,
        query: { 
          username,
          deviceId,
          publicKey: keyPair?.publicKey ? JSON.stringify(keyPair.publicKey) : null
        },
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
          deviceId,
          publicKey: keyPair?.publicKey
        }, (response) => {
          if (response && response.success) {
            console.log('Successfully registered with relay');
            
            // Now we can safely disconnect from the base node
            oldSocket.emit('userLogout', { username, deviceId }, () => {
              console.log('Logged out from base node after connecting to relay');
              oldSocket.disconnect();
            });
            
            setStatus(`Connected to relay server: ${relay.id || relayUrl}`);
            setRelayServerUrl(relay.id || relayUrl);
            setConnectionDetails(prev => ({
              ...prev,
              relayId: relay.id || relayUrl,
              socketId: socketRef.current.id,
              transport: socketRef.current.io.engine.transport.name,
              relayStatus: 'connected_to_relay',
              ip: relay.ip,
              port: relay.port,
              connectedUsers: relay.connectedUsers
            }));
            
            // Set up socket event handlers for the relay connection
            setupRelaySocketEvents();
            
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
        
        setStatus('Using Base Node (relay connection failed)');
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
          connectToBaseNode();
        }
      });
    }
  };
  
  // Set up socket event handlers specifically for relay connections
  const setupRelaySocketEvents = () => {
    if (!socketRef.current) return;
    
    // Remove any existing listeners to prevent duplicates
    socketRef.current.off('receiveMessage');
    socketRef.current.off('userTyping');
    socketRef.current.off('userStatusUpdate');
    socketRef.current.off('publicKeyRequest');
    
    // Handle incoming messages
    socketRef.current.on('receiveMessage', async (data) => {
      console.log(`Received message from ${data.from}`);
      
      // Process the message
      let messageContent = data.message;
      let isEncrypted = data.encrypted;
      
      // Decrypt message if it's encrypted and we have the keys
      if (isEncrypted && keyPair && keyPair.privateKey) {
        try {
          messageContent = await decryptMessage(data.message, keyPair.privateKey);
          console.log('Message decrypted successfully');
        } catch (error) {
          console.error('Failed to decrypt message:', error);
          messageContent = '[Encrypted message - decryption failed]';
        }
      }
      
      // Create message object
      const newMessage = {
        id: Date.now().toString(),
        from: data.from,
        content: messageContent,
        timestamp: data.timestamp || new Date().toISOString(),
        encrypted: isEncrypted,
        fromDeviceId: data.fromDeviceId,
        bounced: data.bounced || false
      };
      
      // Add message to state
      setMessages(prevMessages => [...prevMessages, newMessage]);
      
      // Update chat history
      updateChatHistory(data.from, newMessage);
      
      // Update trust status - we've received a message from this user
      updateTrustStatus(data.from, { receivedMessage: true });
      
      // Store the sender's public key if provided
      if (data.publicKey && !publicKeys[data.from]) {
        setPublicKeys(prev => ({
          ...prev,
          [data.from]: data.publicKey
        }));
        console.log(`Stored public key for ${data.from}`);
      }
      
      // Check identity
      if (data.fromDeviceId) {
        checkIdentity(data.from, data.fromDeviceId);
      }
    });
    
    // Handle typing indicators
    socketRef.current.on('userTyping', (data) => {
      if (data.username === recipient) {
        setTyping(true);
        
        // Clear previous timeout
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }
        
        // Set timeout to clear typing indicator
        typingTimeoutRef.current = setTimeout(() => {
          setTyping(false);
        }, 3000);
      }
    });
    
    // Handle user status updates
    socketRef.current.on('userStatusUpdate', (data) => {
      console.log(`User status update: ${data.username} is ${data.online ? 'online' : 'offline'}`);
      
      // Update online users list
      setOnlineUsers(prev => {
        if (data.online && !prev.includes(data.username)) {
          return [...prev, data.username];
        } else if (!data.online) {
          return prev.filter(user => user !== data.username);
        }
        return prev;
      });
      
      // Update recipient status if this is the current recipient
      if (data.username === recipient) {
        setRecipientStatus(prev => ({
          ...prev,
          online: data.online
        }));
      }
    });
    
    // Handle public key requests
    socketRef.current.on('publicKeyRequest', (data, ack) => {
      console.log(`Public key requested by ${data.from}`);
      
      if (keyPair && keyPair.publicKey) {
        console.log('Sending public key');
        if (ack) ack({ publicKey: keyPair.publicKey });
      } else {
        console.log('No public key available');
        if (ack) ack({ success: false, reason: 'No public key available' });
      }
    });
    
    // Handle relay-specific events
    socketRef.current.on('relayInfo', (data) => {
      console.log('Received relay info:', data);
      setConnectionDetails(prev => ({
        ...prev,
        ...data,
        relayStatus: 'connected_to_relay'
      }));
    });
  };

  const startRelayPolling = () => {
    // Clear any existing polling interval
    if (window.relayPollingInterval) {
      clearInterval(window.relayPollingInterval);
    }
    
    // Set up polling interval
    window.relayPollingInterval = setInterval(() => {
      if (socketRef.current && socketRef.current.connected && 
          (connectionDetails.relayStatus === 'direct_to_base' || connectionDetails.relayId === 'direct')) {
        console.log('Polling for available relays...');
        
        socketRef.current.emit('getAvailableRelays', {}, (response) => {
          if (response && response.relays && response.relays.length > 0) {
            console.log('Found available relays:', response.relays);
            
            // Cache relay information
            localStorage.setItem('whispernetRelayCache', JSON.stringify({
              timestamp: Date.now(),
              relays: response.relays
            }));
            
            // Connect to the first available relay
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
      
      // Create message object
      const messageObj = { 
        from, 
        message: decryptedMessage, 
        fromDeviceId, 
        timestamp: new Date(timestamp || new Date()),
        encrypted,
        decryptionStatus,
        bounced
      };
      
      // Add to messages array for current view
      setMessages(msgs => [...msgs, messageObj]);
      
      // Update chat history for this contact
      updateChatHistory(from, messageObj);
      
      // Update trust status - mark that we received a message from this user
      updateTrustStatus(from, { receivedMessage: true });
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
      
      // If we have a recipient, check if they're in the online users list
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
        if (recipient) {
          const isOnline = data.users.includes(recipient);
          console.log(`Recipient ${recipient} is ${isOnline ? 'online' : 'offline'}`);
          
          setRecipientStatus(prev => ({ 
            ...prev, 
            exists: prev.exists, // Keep existing value
            online: isOnline,
            notRegisteredYet: false // Clear this flag since we got an update
          }));
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
    
    // Request online users list
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('getOnlineUsers', {}, (response) => {
        if (response && Array.isArray(response.users)) {
          console.log('Online users:', response.users);
          setOnlineUsers(response.users);
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
        
        // Request online users list
        socketRef.current.emit('getOnlineUsers', {}, (response) => {
          if (response && Array.isArray(response.users)) {
            console.log('Online users:', response.users);
            setOnlineUsers(response.users);
          }
        });
      }
    }, 30000); // Ping every 30 seconds
  };

  const checkRecipientStatus = () => {
    if (!recipient || !socketRef.current || !socketRef.current.connected) {
      return;
    }
    
    console.log(`Checking status for recipient: ${recipient}`);
    
    // Check if the recipient is in the online users list
    const isOnline = onlineUsers.includes(recipient);
    
    // Check if the user exists
    socketRef.current.emit('checkUser', { username: recipient }, (response) => {
      console.log('Check user response:', response);
      
      if (response && response.exists) {
        setRecipientStatus({ 
          exists: true, 
          online: isOnline,
          notRegisteredYet: false
        });
      } else {
        setRecipientStatus({ 
          exists: false, 
          online: false,
          notRegisteredYet: true
        });
      }
    });
  };

  const handleRecipientChange = (e) => {
    const newRecipient = e.target.value.trim();
    setRecipient(newRecipient);
    
    if (newRecipient) {
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
      
      // Use the correct event name based on whether we're connected to a relay or base node
      const eventName = connectionDetails.relayStatus === 'connected_to_relay' ? 'sendMessage' : 'routeMessage';
      socketRef.current.emit(eventName, messageData, (response) => {
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
          
          // Add message to local state (store original message for display)
          setMessages(msgs => [...msgs, messageObj]);
          
          // Update chat history for this contact
          updateChatHistory(recipient, messageObj);
          
          // Update trust status - mark that we sent a message to this user
          updateTrustStatus(recipient, { sentMessage: true });
          
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
              
              // Add message to local state as bounced
              setMessages(msgs => [...msgs, messageObj]);
              
              // Update chat history for this contact
              updateChatHistory(recipient, messageObj);
              
              // Update trust status - mark that we sent a message to this user
              updateTrustStatus(recipient, { sentMessage: true });
              
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
  
  const handleBounce = (e) => {
    if (!recipient || !message.trim()) {
      return;
    }
    
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
  
  // Function to switch to a specific chat
  const switchToChat = (contactUsername) => {
    setActiveChat(contactUsername);
    setRecipient(contactUsername || '');
    
    // Load messages for this contact
    if (contactUsername && chatHistory[contactUsername]) {
      setMessages(chatHistory[contactUsername]);
    } else {
      setMessages([]);
    }
    
    // Check if we need to show trust warning
    if (contactUsername && trustStatus[contactUsername]) {
      setShowTrustWarning(!trustStatus[contactUsername].mutualMessaging);
    } else if (contactUsername) {
      setShowTrustWarning(true);
    } else {
      setShowTrustWarning(false);
    }
  };
  
  // Function to toggle About page
  const toggleAboutPage = () => {
    setShowAboutPage(!showAboutPage);
  };

  return (
    <div style={{ 
      background: '#0a0e14', 
      minHeight: '100vh', 
      color: '#a2aabc', 
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '"Fira Code", monospace'
    }}>
      {/* Header */}
      <header style={{
        background: '#171c28',
        padding: '16px 24px',
        borderBottom: '1px solid rgba(0, 255, 170, 0.3)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h1 style={{ 
            margin: 0, 
            color: '#5ccfe6', 
            fontFamily: '"Fira Code", monospace',
            letterSpacing: '1px',
            fontSize: '24px'
          }}>WhisperNet_</h1>
          
          {username && (
            <span style={{ 
              marginLeft: '16px', 
              color: '#bae67e', 
              fontSize: '14px',
              padding: '4px 8px',
              background: 'rgba(186, 230, 126, 0.1)',
              borderRadius: '4px'
            }}>
              @{username}
            </span>
          )}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ 
            fontSize: 12, 
            padding: '4px 8px', 
            borderRadius: 4, 
            background: relayStatus === 'online' ? '#1c4b3c' : '#4b1c1c',
            color: relayStatus === 'online' ? '#5ccfe6' : '#ff8f40',
            cursor: 'pointer',
            marginRight: '12px'
          }} onClick={() => setShowConnectionInfo(!showConnectionInfo)}>
            {relayStatus === 'online' ? 'Base Node Online' : 
             relayStatus === 'checking' ? 'Checking...' : 'Base Node Offline'}
          </div>
          
          {connected && (
            <button 
              style={{ 
                padding: '8px 16px', 
                borderRadius: 4, 
                background: '#4b1c1c', 
                color: '#ff8f40', 
                fontSize: 14, 
                border: 'none',
                cursor: 'pointer',
                fontFamily: '"Fira Code", monospace',
                marginRight: '12px'
              }} 
              onClick={handleDisconnect}
            >
              DISCONNECT
            </button>
          )}
          
          <button 
            style={{ 
              padding: '8px 16px', 
              borderRadius: 4, 
              background: '#1c3b4b', 
              color: '#5ccfe6', 
              fontSize: 14, 
              border: 'none',
              cursor: 'pointer',
              fontFamily: '"Fira Code", monospace'
            }} 
            onClick={toggleAboutPage}
          >
            {showAboutPage ? 'BACK TO CHAT' : 'ABOUT'}
          </button>
        </div>
      </header>
      
      {/* Connection info */}
      {showConnectionInfo && (
        <div style={{ padding: '0 24px' }}>
          <ConnectionInfo
            status={status}
            connected={connected}
            connectionDetails={connectionDetails}
            relayServerUrl={relayServerUrl}
            relayStatus={relayStatus}
            deviceId={deviceId}
            BASE_NODE_URL={BASE_NODE_URL}
          />
        </div>
      )}
      
      {/* Security alert */}
      {securityAlert && (
        <div style={{ padding: '0 24px' }}>
          <SecurityAlert alert={securityAlert} onDismiss={dismissAlert} />
        </div>
      )}
      
      {/* Main content */}
      <div style={{ 
        flex: 1,
        display: 'flex',
        height: 'calc(100vh - 69px - (showConnectionInfo ? 80 : 0) - (securityAlert ? 60 : 0))' // Subtract header height and optional elements
      }}>
        {showAboutPage ? (
          <AboutPage />
        ) : !connected ? (
          <LoginScreen
            username={username}
            handleUsernameChange={handleUsernameChange}
            handleUsernameSubmit={handleUsernameSubmit}
            isCheckingUsername={isCheckingUsername}
            usernameAvailable={usernameAvailable}
            relayStatus={relayStatus}
            status={status}
            securityAlert={securityAlert}
            dismissAlert={dismissAlert}
            retryConnection={retryConnection}
            getTimestamp={getTimestamp}
          />
        ) : (
          <ChatInterface
            contacts={contacts}
            activeChat={activeChat}
            switchToChat={switchToChat}
            onlineUsers={onlineUsers}
            trustStatus={trustStatus}
            recipient={recipient}
            handleRecipientChange={handleRecipientChange}
            message={message}
            handleMessageChange={handleMessageChange}
            handleSend={handleSend}
            handleBounce={handleBounce}
            recipientStatus={recipientStatus}
            messages={messages}
            username={username}
            typing={typing}
            messagesEndRef={messagesEndRef}
            formatMessageTime={formatMessageTime}
            getTimestamp={getTimestamp}
            showTrustWarning={showTrustWarning}
          />
        )}
      </div>
    </div>
  );
}

export default App;