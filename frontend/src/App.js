import React, { useState, useRef, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import FingerprintJS from '@fingerprintjs/fingerprintjs';
import * as EncryptionUtils from './encryptionUtils';
import * as MessageUtils from './messageUtils';
import { createRelayMessage, sendMessage } from './messageUtils';

const BASE_NODE_URL = process.env.REACT_APP_BASE_NODE_URL || "http://localhost:5000";

// Initialize the fingerprint agent
const fpPromise = FingerprintJS.load();

// Random username generator
const generateRandomUsername = () => {
  const adjectives = ['Swift', 'Brave', 'Clever', 'Mighty', 'Noble', 'Wise', 'Calm', 'Bold', 'Bright', 'Agile'];
  const animals = ['Fox', 'Eagle', 'Wolf', 'Deer', 'Hawk', 'Owl', 'Bear', 'Lion', 'Tiger', 'Dolphin'];
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
  const randomNumber = Math.floor(Math.random() * 1000);
  return `${randomAdjective}${randomAnimal}${randomNumber}`;
};

function App() {
  // State for user information
  const [username, setUsername] = useState(generateRandomUsername());
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('Disconnected');
  const [connected, setConnected] = useState(false);
  const [typing, setTyping] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [connectionDetails, setConnectionDetails] = useState({});
  const [relayStatus, setRelayStatus] = useState('unknown');
  const [availableRelays, setAvailableRelays] = useState([]);
  const [activeRelay, setActiveRelay] = useState(null);
  const [relayConnection, setRelayConnection] = useState(null);
  const [recipientStatus, setRecipientStatus] = useState({ exists: false, online: false });
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [showConnectionInfo, setShowConnectionInfo] = useState(false);
  const [relayServerUrl, setRelayServerUrl] = useState('');
  
  // Security and messaging state
  const [securityAlert, setSecurityAlert] = useState(null);
  const [pendingMessages, setPendingMessages] = useState([]);
  const [showNewDeviceWarning, setShowNewDeviceWarning] = useState(false);
  const [newDeviceUsername, setNewDeviceUsername] = useState('');
  
  // Encryption state
  const [encryptionEnabled, setEncryptionEnabled] = useState(true);
  const [offlineMessageEnabled, setOfflineMessageEnabled] = useState(true);
  const [keyPair, setKeyPair] = useState(null);
  const [publicKeyBase64, setPublicKeyBase64] = useState(null);
  const [contactKeys, setContactKeys] = useState({});
  
  // State for relay message dialog
  const [showRelayDialog, setShowRelayDialog] = useState(false);
  const [pendingRelayMessage, setPendingRelayMessage] = useState(null);
  
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const encryptionKeyRef = useRef({});
  const pendingKeyExchangeRef = useRef([]);

  // Get device fingerprint and initialize encryption on component mount
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Generate device fingerprint
        const fp = await fpPromise;
        const result = await fp.get();
        const visitorId = result.visitorId;
        setDeviceId(visitorId);
        localStorage.setItem('deviceId', visitorId);
        
        // Initialize encryption keys
        const storedKeyPair = localStorage.getItem('keyPair');
        if (storedKeyPair) {
          // Use existing keys if available
          const parsedKeyPair = JSON.parse(storedKeyPair);
          setKeyPair(parsedKeyPair);
          const importedPublicKey = await EncryptionUtils.importPublicKey(parsedKeyPair.publicKey);
          const exportedPublicKeyBase64 = await EncryptionUtils.exportPublicKeyBase64(importedPublicKey);
          setPublicKeyBase64(exportedPublicKeyBase64);
        } else {
          // Generate new keys if none exist
          const newKeyPair = await EncryptionUtils.generateKeyPair();
          const publicKeyJwk = await EncryptionUtils.exportKeyToJwk(newKeyPair.publicKey);
          const privateKeyJwk = await EncryptionUtils.exportKeyToJwk(newKeyPair.privateKey);
          
          const keyPairToStore = {
            publicKey: publicKeyJwk,
            privateKey: privateKeyJwk
          };
          
          localStorage.setItem('keyPair', JSON.stringify(keyPairToStore));
          setKeyPair(keyPairToStore);
          
          const exportedPublicKeyBase64 = await EncryptionUtils.exportPublicKeyBase64(newKeyPair.publicKey);
          setPublicKeyBase64(exportedPublicKeyBase64);
        }
        
        // Load stored contact keys
        const storedContactKeys = localStorage.getItem('contactKeys');
        if (storedContactKeys) {
          setContactKeys(JSON.parse(storedContactKeys));
        }
        
        // Load pending messages
        const storedPendingMessages = localStorage.getItem('pendingMessages');
        if (storedPendingMessages) {
          setPendingMessages(JSON.parse(storedPendingMessages));
        }
      } catch (error) {
        console.error('Error initializing app:', error);
        setStatus('Error initializing encryption. Please refresh.');
      }
    };
    
    initializeApp();
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
      
      // Check if keys are present in localStorage
      const storedContactKeys = localStorage.getItem('contactKeys');
      if (!storedContactKeys) {
        setSecurityAlert({
          type: 'warning',
          username: 'System',
          message: 'No encryption keys found. We cannot verify who you\'re talking to.'
        });
      }
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
      
      // Register with base node including public key for encryption
      socketRef.current.emit('registerUser', { 
        username, 
        deviceId,
        publicKey: publicKeyBase64
      }, (response) => {
        console.log('Registration response:', response);
        if (response && response.success) {
          setStatus('Registered successfully');
          
          // Get initial data
          getOnlineUsers();
          
          // Get available relay servers
          getAvailableRelays();
          
          startPingInterval();
          
          // Handle any offline messages that were delivered on registration
          if (response.offlineMessages && response.offlineMessages.length > 0) {
            handleOfflineMessages(response.offlineMessages);
          }
          
          // Handle any known devices warning
          if (response.knownDevices && response.knownDevices.length > 0) {
            const isNewDevice = !response.knownDevices.includes(deviceId);
            if (isNewDevice) {
              setSecurityAlert({
                type: 'warning',
                username: 'System',
                message: `This account is being accessed from a new device. If this wasn't you, your account may be compromised.`
              });
            }
          }
          
        } else {
          const errorMsg = response?.reason || 'Registration failed';
          setStatus(`Registration failed: ${errorMsg}`);
          setSecurityAlert({
            type: 'error',
            username: 'System',
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
    socketRef.current.on('message', async (data) => {
      console.log('Received message:', data);
      const { from, message, fromDeviceId, timestamp, encrypted, encryptedContent, iv, messageId, publicKey } = data;
      
      // Acknowledge receipt if message has an ID (for offline message tracking)
      if (messageId) {
        socketRef.current.emit('confirmMessageDelivery', { messageId });
      }
      
      // Check for device ID changes and show security alert if needed
      checkDeviceIdChange(from, fromDeviceId);
      
      // Store sender's public key if provided
      if (publicKey && (!contactKeys[from] || contactKeys[from] !== publicKey)) {
        console.log(`Received public key from ${from} in direct message`);
        const updatedKeys = { ...contactKeys, [from]: publicKey };
        setContactKeys(updatedKeys);
        localStorage.setItem('contactKeys', JSON.stringify(updatedKeys));
        
        // Resolve any pending key exchange promises
        const pendingRequests = pendingKeyExchangeRef.current
          .filter(p => p.username === from);
          
        if (pendingRequests.length > 0) {
          console.log(`Resolving ${pendingRequests.length} pending key requests for ${from}`);
          pendingRequests.forEach(pending => {
            if (pending.callback) pending.callback(publicKey);
          });
          
          // Remove from pending
          pendingKeyExchangeRef.current = pendingKeyExchangeRef.current
            .filter(p => p.username !== from);
        }
      }
      
      // Handle encrypted messages
      let finalMessage = message;
      let isEncrypted = false;
      
      if (encrypted && encryptedContent && iv) {
        isEncrypted = true;
        try {
          // Get sender's public key if we don't have it
          if (!contactKeys[from]) {
            const key = await requestPublicKey(from);
            if (!key) {
              finalMessage = '[Encrypted message - no decryption key available]';
              throw new Error('No decryption key available');
            }
          }
          
          // Decrypt the message if we have the key
          finalMessage = await decryptMessage(encryptedContent, iv, from);
        } catch (error) {
          console.error('Failed to decrypt message:', error);
          if (finalMessage === message) { // Only override if not already set to error message
            finalMessage = '[Encrypted message - unable to decrypt]';
          }
        }
      }
      
      // Add message to state
      setMessages(msgs => [...msgs, { 
        from, 
        message: finalMessage, 
        fromDeviceId, 
        timestamp: new Date(timestamp || Date.now()),
        encrypted: isEncrypted,
        delivered: true
      }]);
    });
    
    // Handle relay server list updates
    socketRef.current.on('relayList', (relays) => {
      console.log('Received relay list:', relays);
      setAvailableRelays(relays);
      
      // If we're not connected to a relay yet, connect to the best one
      if (!activeRelay && relays.length > 0) {
        const onlineRelays = relays.filter(relay => relay.status === 'online');
        if (onlineRelays.length > 0) {
          connectToRelay(onlineRelays[0]);
        }
      }
    });
    
    // Handle public key exchange events
    socketRef.current.on('publicKey', (data) => {
      console.log('Received public key:', data);
      const { username, publicKey } = data;
      
      if (username && publicKey) {
        // Store the public key
        const updatedKeys = { ...contactKeys, [username]: publicKey };
        setContactKeys(updatedKeys);
        localStorage.setItem('contactKeys', JSON.stringify(updatedKeys));
        
        // If we have pending key exchanges, process them
        const pendingExchanges = pendingKeyExchangeRef.current;
        const pendingForUser = pendingExchanges.filter(p => p.username === username);
        
        if (pendingForUser.length > 0) {
          pendingForUser.forEach(pending => {
            if (pending.callback) pending.callback(publicKey);
          });
          
          // Remove processed exchanges
          pendingKeyExchangeRef.current = pendingExchanges.filter(p => p.username !== username);
        }
      }
    });
    
    // Handle relay status updates
    socketRef.current.on('relayStatusUpdate', (data) => {
      console.log('Relay status update:', data);
      const { relayId, status } = data;
      
      setAvailableRelays(prev => {
        const updated = prev.map(relay => {
          if (relay.relayId === relayId) {
            return { ...relay, status };
          }
          return relay;
        });
        
        // If the relay we're connected to went offline, connect to another one
        if (activeRelay && activeRelay.relayId === relayId && status === 'offline') {
          const onlineRelays = updated.filter(r => r.status === 'online');
          if (onlineRelays.length > 0) {
            // Schedule a reconnect to avoid doing it during this state update
            setTimeout(() => connectToRelay(onlineRelays[0]), 100);
          }
        }
        
        return updated;
      });
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
  
  // Get available relay servers from base node
  const getAvailableRelays = () => {
    if (socketRef.current) {
      socketRef.current.emit('getRelays', {}, (relays) => {
        console.log('Available relays:', relays);
        if (Array.isArray(relays)) {
          setAvailableRelays(relays);
          
          // Connect to the first available relay if we're not connected to any
          const onlineRelays = relays.filter(relay => relay.status === 'online');
          if (onlineRelays.length > 0 && !activeRelay) {
            connectToRelay(onlineRelays[0]);
          }
        }
      });
    }
  };
  
  // Connect to a relay server
  const connectToRelay = (relay, callback) => {
    // Handle both relay object and direct URL string
    let relayUrl;
    if (typeof relay === 'string') {
      relayUrl = relay;
    } else if (relay && relay.ip && relay.port) {
      relayUrl = `http://${relay.ip}:${relay.port}`;
    } else {
      console.error('Invalid relay information:', relay);
      return;
    }
    
    // Disconnect from current relay if connected
    if (relayConnection) {
      relayConnection.disconnect();
      setRelayConnection(null);
    }
    
    console.log(`Connecting to relay server: ${relayUrl}`);
    setStatus(`Connecting to relay...`);
    setRelayServerUrl(relayUrl);
    
    const socket = io(relayUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      query: { 
        deviceId,
        username 
      },
      forceNew: true
    });
    
    socket.on('connect', () => {
      console.log(`Connected to relay with socket ID: ${socket.id}`);
      setStatus(`Connected to relay. Registering...`);
      
      // Register with the relay including public key
      socket.emit('registerUser', { 
        username, 
        deviceId,
        publicKey: publicKeyBase64
      }, (response) => {
        console.log('Relay registration response:', response);
        if (response && response.success) {
          setActiveRelay(relay);
          setRelayConnection(socket);
          setStatus(`Connected to relay`);
          
          // Store relay info for future use
          localStorage.setItem('lastRelay', JSON.stringify(relay));
          
          // Handle any offline messages that were delivered on connect
          if (response.offlineMessages && response.offlineMessages.length > 0) {
            handleOfflineMessages(response.offlineMessages);
          }
          
          // Handle any new device warnings
          if (response.knownDevices && response.knownDevices.length > 0) {
            const isNewDevice = !response.knownDevices.includes(deviceId);
            if (isNewDevice) {
              setSecurityAlert({
                type: 'warning',
                username: 'System',
                message: `This account is being accessed from a new device. If this wasn't you, your account may be compromised.`
              });
            }
          }
          
          // Execute callback if provided
          if (typeof callback === 'function') {
            callback();
          }
        } else {
          const errorMsg = response?.reason || 'Registration with relay failed';
          setStatus(`Relay registration failed: ${errorMsg}`);
          socket.disconnect();
        }
      });
    });
    
    socket.on('connect_error', (err) => {
      console.error(`Relay connection error: ${err.message}`);
      setStatus(`Relay connection failed: ${err.message}`);
      
      // Try another relay if available
      const otherRelays = availableRelays.filter(r => 
        r.relayId !== relay.relayId && r.status === 'online'
      );
      
      if (otherRelays.length > 0) {
        setTimeout(() => connectToRelay(otherRelays[0]), 1000);
      } else {
        setStatus('No available relays. Using base node directly.');
      }
    });
    
    socket.on('disconnect', (reason) => {
      console.log(`Disconnected from relay: ${reason}`);
      setStatus(`Disconnected from relay: ${reason}`);
      setActiveRelay(null);
      
      // Try to reconnect to another relay if available
      const onlineRelays = availableRelays.filter(r => r.status === 'online');
      if (onlineRelays.length > 0) {
        setTimeout(() => connectToRelay(onlineRelays[0]), 2000);
      }
    });
    
    // Message handling
    socket.on('receiveMessage', async (data) => {
      console.log('Received message from relay:', data);
      const { from, message, fromDeviceId, timestamp, encrypted, encryptedContent, iv, publicKey } = data;
      
      // Security check for device ID changes
      const previousMessages = messages.filter(msg => msg.from === from);
      if (previousMessages.length > 0 && previousMessages[0].fromDeviceId && 
          previousMessages[0].fromDeviceId !== fromDeviceId) {
        setSecurityAlert({
          type: 'warning',
          username: from,
          message: `Warning: ${from} appears to be messaging from a different device!`
        });
      }
      
      // Store sender's public key if provided
      if (publicKey && !contactKeys[from]) {
        console.log(`Received public key from ${from} in message`);
        const updatedKeys = { ...contactKeys, [from]: publicKey };
        setContactKeys(updatedKeys);
        localStorage.setItem('contactKeys', JSON.stringify(updatedKeys));
        
        // Resolve any pending key exchange promises
        const pendingRequests = pendingKeyExchangeRef.current
          .filter(p => p.username === from);
          
        if (pendingRequests.length > 0) {
          console.log(`Resolving ${pendingRequests.length} pending key requests for ${from}`);
          pendingRequests.forEach(p => p.callback(publicKey));
          
          // Remove from pending
          pendingKeyExchangeRef.current = pendingKeyExchangeRef.current
            .filter(p => p.username !== from);
        }
      }
      
      // Handle encrypted messages
      let displayMessage = message;
      let isEncrypted = false;
      
      if (encrypted && encryptedContent && iv) {
        isEncrypted = true;
        try {
          // Try to decrypt if we have the key
          if (contactKeys[from]) {
            displayMessage = await decryptMessage(encryptedContent, iv, from);
          } else {
            // Request the key if we don't have it
            const key = await requestPublicKey(from);
            if (key) {
              displayMessage = await decryptMessage(encryptedContent, iv, from);
            } else {
              displayMessage = '[Encrypted message - no decryption key available]';
            }
          }
        } catch (error) {
          console.error('Failed to decrypt message:', error);
          displayMessage = '[Encrypted message - unable to decrypt]';
        }
      }
      
      // Add to messages
      setMessages(msgs => [...msgs, { 
        from, 
        message: displayMessage, 
        fromDeviceId, 
        timestamp: new Date(timestamp || new Date()),
        encrypted: isEncrypted,
        isRelay: true
      }]);
    });
    
    // Typing indicators
    socket.on('userTyping', (data) => {
      const { username: typingUser } = data;
      if (typingUser === recipient) {
        setTyping(true);
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setTyping(false), 3000);
      }
    });
    
    return socket;
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
    if (!recipient) {
      setRecipientStatus({ exists: false, online: false });
      return;
    }
    
    // Check through relay if connected, otherwise through base node
    const socket = relayConnection || socketRef.current;
    
    if (!socket) {
      setRecipientStatus({ exists: false, online: false });
      return;
    }
    
    const checkMethod = relayConnection ? 'checkRecipient' : 'checkUser';
    
    socket.emit(checkMethod, { username: recipient }, (response) => {
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
      // Check if username exists before connecting
      const tempSocket = io(BASE_NODE_URL, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 2,
        reconnectionDelay: 1000,
        timeout: 5000,
        forceNew: true
      });
      
      setStatus('Verifying username...');
      setIsCheckingUsername(true);
      
      tempSocket.on('connect', () => {
        // First check if username is available (not registered)
        tempSocket.emit('checkUsernameAvailable', { username: username.trim() }, (availableResponse) => {
          console.log('Username availability response:', availableResponse);
          
          if (availableResponse && availableResponse.available) {
            // Username is available for registration (new user)
            console.log('Username is available for registration');
            setUsernameAvailable(true);
            setConnected(true);
            tempSocket.disconnect();
          } else {
            // Username exists, check if it's online
            tempSocket.emit('checkUser', { username: username.trim() }, (response) => {
              console.log('Username check response:', response);
              setIsCheckingUsername(false);
              
              if (response && response.exists) {
                // Username exists, proceed with connection
                setConnected(true);
                tempSocket.disconnect();
              } else {
                // Username doesn't exist but isn't available (being cleaned up)
                setStatus('Username not available');
                // Generate a new random username
                const newUsername = generateRandomUsername();
                setUsername(newUsername);
                setSecurityAlert({
                  type: 'info',
                  username: 'System',
                  message: `That username is not available. We've generated a new username for you: ${newUsername}`
                });
                tempSocket.disconnect();
              }
            });
          }
        });
      });
      
      tempSocket.on('connect_error', (err) => {
        console.error('Socket connection error:', err);
        setStatus('Connection error. Please try again.');
        setIsCheckingUsername(false);
        tempSocket.disconnect();
      });
    } else if (relayStatus !== 'online') {
      setSecurityAlert({
        type: 'error',
        username: 'System',
        message: 'Cannot connect: Base node is offline'
      });
    }
  };

  const handleRecipientChange = (e) => {
    setRecipient(e.target.value.trim());
  };

  // Handle offline messages received on connect
  const handleOfflineMessages = (offlineMessages) => {
    if (!Array.isArray(offlineMessages) || offlineMessages.length === 0) return;
    
    console.log('Processing offline messages:', offlineMessages);
    
    // Process each offline message
    offlineMessages.forEach(async (msgData) => {
      try {
        const { from, message, encrypted, encryptedContent, iv, fromDeviceId, timestamp, messageId } = msgData;
        
        // Acknowledge receipt to remove from storage
        if (socketRef.current && messageId) {
          socketRef.current.emit('confirmMessageDelivery', { messageId });
        }
        
        // If message is encrypted, decrypt it
        let decryptedMessage = message;
        if (encrypted && encryptedContent && iv) {
          // Get the sender's public key if we don't have it
          if (!contactKeys[from]) {
            await requestPublicKey(from);
          }
          
          // Try to decrypt if we have the key
          if (contactKeys[from]) {
            try {
              decryptedMessage = await decryptMessage(encryptedContent, iv, from);
            } catch (error) {
              console.error('Failed to decrypt offline message:', error);
              decryptedMessage = '[Encrypted message - unable to decrypt]';
            }
          } else {
            decryptedMessage = '[Encrypted message - no decryption key available]';
          }
        }
        
        // Add to messages
        setMessages(msgs => [...msgs, {
          from,
          message: decryptedMessage,
          fromDeviceId,
          timestamp: new Date(timestamp || Date.now()),
          encrypted
        }]);
        
        // Check for device ID changes
        checkDeviceIdChange(from, fromDeviceId);
      } catch (error) {
        console.error('Error processing offline message:', error);
      }
    });
  };
  
  // Request public key from a user
  const requestPublicKey = async (username) => {
    if (!socketRef.current) return null;
    
    return new Promise((resolve) => {
      // Check if we already have the key
      if (contactKeys[username]) {
        console.log(`Using cached public key for ${username}`);
        resolve(contactKeys[username]);
        return;
      }
      
      console.log(`Requesting public key for ${username}`);
      
      // Add to pending key exchanges
      pendingKeyExchangeRef.current = [
        ...pendingKeyExchangeRef.current,
        { username, callback: resolve, timestamp: Date.now() }
      ];
      
      socketRef.current.emit('requestPublicKey', { username }, (response) => {
        console.log('Public key request response:', response);
        
        if (response && response.publicKey) {
          // Store the public key
          const updatedKeys = { ...contactKeys, [username]: response.publicKey };
          setContactKeys(updatedKeys);
          localStorage.setItem('contactKeys', JSON.stringify(updatedKeys));
          resolve(response.publicKey);
          
          // Remove from pending
          pendingKeyExchangeRef.current = pendingKeyExchangeRef.current
            .filter(p => p.username !== username);
        } else {
          console.error('Failed to get public key for:', username);
          resolve(null);
        }
      });
      
      // Set timeout to prevent hanging
      setTimeout(() => {
        const stillPending = pendingKeyExchangeRef.current
          .find(p => p.username === username && p.callback === resolve);
          
        if (stillPending) {
          console.warn(`Public key request for ${username} timed out`);
          resolve(null);
          
          // Remove from pending
          pendingKeyExchangeRef.current = pendingKeyExchangeRef.current
            .filter(p => !(p.username === username && p.callback === resolve));
        }
      }, 5000); // 5 second timeout
    });
  };
  
  // Decrypt a message using the sender's public key
  const decryptMessage = async (encryptedContent, iv, sender) => {
    try {
      if (!keyPair || !contactKeys[sender]) {
        throw new Error('Missing keys for decryption');
      }
      
      // Import keys
      const privateKey = await EncryptionUtils.importPrivateKey(keyPair.privateKey);
      const senderPublicKey = await EncryptionUtils.importPublicKey(contactKeys[sender]);
      
      // Derive shared secret
      const sharedSecret = await EncryptionUtils.deriveSharedSecret(privateKey, senderPublicKey);
      
      // Decrypt the message
      return await EncryptionUtils.decryptMessage(encryptedContent, iv, sharedSecret);
    } catch (error) {
      console.error('Decryption error:', error);
      throw error;
    }
  };
  
  // Encrypt a message using the recipient's public key
  const encryptMessage = async (message, recipient) => {
    try {
      if (!keyPair || !contactKeys[recipient]) {
        throw new Error('Missing keys for encryption');
      }
      
      // Import keys
      const privateKey = await EncryptionUtils.importPrivateKey(keyPair.privateKey);
      const recipientPublicKey = await EncryptionUtils.importPublicKey(contactKeys[recipient]);
      
      // Derive shared secret
      const sharedSecret = await EncryptionUtils.deriveSharedSecret(privateKey, recipientPublicKey);
      
      // Encrypt the message
      return await EncryptionUtils.encryptMessage(message, sharedSecret);
    } catch (error) {
      console.error('Encryption error:', error);
      throw error;
    }
  };
  
  // Check if a user is messaging from a new device
  const checkDeviceIdChange = (username, newDeviceId) => {
    // Get previous messages from this user
    const previousMessages = messages.filter(msg => msg.from === username);
    
    if (previousMessages.length > 0 && 
        previousMessages[0].fromDeviceId && 
        previousMessages[0].fromDeviceId !== newDeviceId) {
      // Show warning about new device
      setNewDeviceUsername(username);
      setShowNewDeviceWarning(true);
      setSecurityAlert({
        type: 'warning',
        username,
        message: `Warning: ${username} appears to be messaging from a new device!`
      });
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!recipient || !message.trim()) return;
    
    try {
      const messageId = MessageUtils.generateMessageId();
      const timestamp = new Date().toISOString();
      const originalMessage = message.trim();
      
      // Prepare base message data
      const messageData = {
        to: recipient,
        message: originalMessage,
        deviceId,
        timestamp,
        messageId,
        ttl: offlineMessageEnabled ? MessageUtils.calculateTTL() : 0 // 4 hours TTL if offline messaging enabled
      };
      
      // Add message to local state immediately for better UX
      const newMessageId = `msg-${Date.now()}`;
      setMessages(msgs => [...msgs, { 
        id: newMessageId,
        from: username, 
        message: originalMessage, 
        fromDeviceId: deviceId, 
        timestamp: new Date(timestamp),
        pending: true
      }]);
      setMessage('');
      
      // Check if recipient exists - if not, automatically send via relay
      if (!recipientStatus.exists) {
        console.log('Recipient not found, sending via relay automatically');
        // If relay is already connected, send through it
        if (relayConnection) {
          console.log('Using existing relay connection');
          messageData.useRelay = true;
          relayConnection.emit('sendMessage', messageData, (response) => {
            console.log('Relay message response:', response);
            updateMessageStatus(messageId, response, originalMessage);
          });
          return;
        } else if (availableRelays.length > 0) {
          // Connect to the first available relay
          const relay = availableRelays[0];
          console.log('Connecting to relay:', relay);
          
          // Connect to relay and send message
          const relayUrl = `http://${relay.ip}:${relay.port}`;
          const socket = io(relayUrl, {
            transports: ['websocket', 'polling'],
            reconnectionAttempts: 5,
            reconnectionDelay: 2000,
            query: { deviceId, username },
            forceNew: true
          });
          
          socket.on('connect', () => {
            console.log('Connected to relay, sending message');
            socket.emit('sendMessage', messageData, (response) => {
              console.log('Relay message response:', response);
              updateMessageStatus(messageId, response, originalMessage);
              socket.disconnect();
            });
          });
          
          socket.on('connect_error', (err) => {
            console.error('Relay connection error:', err);
            updateMessageStatus(messageId, { success: false, reason: 'Relay connection failed' }, originalMessage);
          });
          
          return;
        } else {
          // No relays available, show error
          updateMessageStatus(messageId, { success: false, reason: 'No relay servers available' }, originalMessage);
          return;
        }
      }
      
      // Include the public key with the message for key exchange
      if (keyPair && keyPair.publicKey) {
        messageData.publicKey = keyPair.publicKey;
      }
      
      // Try to encrypt the message if we have the recipient's public key
      if (encryptionEnabled && contactKeys[recipient]) {
        try {
          console.log('Attempting to encrypt message...');
          const recipientPublicKey = await EncryptionUtils.importPublicKey(contactKeys[recipient]);
          const privateKey = await EncryptionUtils.importPrivateKey(keyPair.privateKey);
          
          // Derive shared secret
          const sharedSecret = await EncryptionUtils.deriveSharedSecret(privateKey, recipientPublicKey);
          
          // Encrypt the message
          const { encryptedContent, iv } = await EncryptionUtils.encryptMessage(originalMessage, sharedSecret);
          
          // Update message data
          messageData.encrypted = true;
          messageData.encryptedContent = encryptedContent;
          messageData.iv = iv;
          messageData.message = ''; // Clear plaintext message
          
          console.log('Message encrypted successfully');
        } catch (error) {
          console.error('Encryption failed:', error);
          // Fall back to unencrypted message
          messageData.encrypted = false;
          setSecurityAlert({
            type: 'warning',
            username: 'System',
            message: `Message sent unencrypted: ${error.message}`
          });
        }
      } else {
        // No encryption key available
        messageData.encrypted = false;
        
        // Request the public key for future messages
        if (encryptionEnabled && !contactKeys[recipient]) {
          console.log(`No encryption key for ${recipient}, requesting...`);
          requestPublicKey(recipient).then(key => {
            if (key) {
              console.log(`Received public key for ${recipient} for future encryption`);
            }
          });
        }
      }
      
      console.log('Sending message:', messageData);
      
      // Send through base node
      const socket = socketRef.current;
      
      if (!socket) {
        setSecurityAlert({
          type: 'error',
          username: 'System',
          message: 'No active connection to send message'
        });
        updateMessageStatus(messageId, { success: false, reason: 'No active connection' }, originalMessage);
        return;
      }
      
      // Log connection details before sending
      console.log(`Sending through base node...`);
      
      // Store message locally if offline messaging is enabled
      if (offlineMessageEnabled) {
        const pendingMsg = { ...messageData, sentAt: Date.now() };
        const updatedPending = [...pendingMessages, pendingMsg];
        setPendingMessages(updatedPending);
        localStorage.setItem('pendingMessages', JSON.stringify(updatedPending));
      }
      
      // Create message object
      const relayMessage = createRelayMessage(
        username,
        recipient,
        message,
        deviceId,
        messageData.encryptedContent,
        messageData.iv
      );
      
      // Try to send message
      const sendSuccess = await sendMessage(relayMessage, activeRelay.url);
      
      if (sendSuccess) {
        // Message sent successfully
        setMessages(prev => [...prev, { ...relayMessage, from: username }]);
      } else {
        // Handle send failure
        setStatus('Message failed to send. Storing offline...');
        storePendingMessage(relayMessage);
        setPendingMessages(prev => [...prev, relayMessage]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setSecurityAlert({
        type: 'error',
        username: 'System',
        message: `Error sending message: ${error.message}`
      });
    }
  };

  const handleRelayConfirm = async () => {
    if (pendingRelayMessage) {
      // Set TTL to maximum for relay messages
      const messageData = {
        ...pendingRelayMessage.messageData,
        ttl: MessageUtils.calculateTTL(24) // 24 hours TTL for relay messages
      };
      
      // Send the message
      const socket = relayConnection || socketRef.current;
      
      if (socket) {
        socket.emit('sendMessage', messageData, (response) => {
          console.log('Relay message response:', response);
          
          if (response && (response.success || response.delivered)) {
            // Add message to local state
            setMessages(msgs => [...msgs, { 
              from: username, 
              message: pendingRelayMessage.message, 
              fromDeviceId: deviceId, 
              timestamp: new Date(),
              encrypted: messageData.encrypted,
              isRelay: true
            }]);
            setMessage('');
            
            // Show confirmation
            setSecurityAlert({
              type: 'info',
              username: 'System',
              message: `Message queued for relay delivery to ${recipient}`
            });
          } else {
            const errorMsg = response?.reason || 'Relay message delivery failed';
            setSecurityAlert({
              type: 'error',
              username: 'System',
              message: `Failed to send relay message: ${errorMsg}`
            });
          }
        });
      }
    }
    
    // Reset relay dialog
    setShowRelayDialog(false);
    setPendingRelayMessage(null);
  };

  const handleRelayCancel = () => {
    setShowRelayDialog(false);
    setPendingRelayMessage(null);
  };

  const handleMessageChange = (e) => {
    setMessage(e.target.value);
    
    // Send typing indicator through relay if connected, otherwise through base node
    const socket = relayConnection || socketRef.current;
    
    if (socket && recipient && e.target.value.length > 0) {
      socket.emit('typing', { to: recipient });
    }
  };

  const handleDisconnect = () => {
    setConnected(false);
    
    // Disconnect from relay if connected
    if (relayConnection) {
      relayConnection.disconnect();
      setRelayConnection(null);
      setActiveRelay(null);
    }
    
    // Disconnect from base node
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    
    setMessages([]);
    setOnlineUsers([]);
    setRecipientStatus({ exists: false, online: false });
    setStatus('Disconnected');
    
    // Clear stored relay info
    localStorage.removeItem('lastRelay');
  };

  const dismissAlert = () => {
    setSecurityAlert(null);
  };

  // Helper function to update message status after sending
  const updateMessageStatus = (messageId, response, originalMessage) => {
    console.log('Updating message status:', messageId, response);
    
    setMessages(msgs => msgs.map(msg => {
      // Find the pending message and update its status
      if (msg.pending && msg.message === originalMessage) {
        return {
            ...msg,
            pending: false,
            delivered: !!(response && (response.success || response.delivered)),
            failed: !(response && (response.success || response.delivered)),
            failureReason: response?.reason || ''
        };
      }
      return msg;
    }));
    
    // Show alert if message failed
    if (!(response && (response.success || response.delivered))) {
      setSecurityAlert({
        type: 'error',
        username: 'System',
        message: `Failed to send message: ${response?.reason || 'Unknown error'}`
      });
    } else {
      console.log('Message sent successfully');
    }
    
    // Remove from pending messages if delivered
    if (offlineMessageEnabled && (response && (response.success || response.delivered))) {
      const updatedPending = pendingMessages.filter(msg => msg.messageId !== messageId);
      setPendingMessages(updatedPending);
      localStorage.setItem('pendingMessages', JSON.stringify(updatedPending));
    }
  };
  
  // Helper function to handle message responses consistently
  const handleMessageResponse = (response, messageData, originalMessage, messageId) => {
    // This function is kept for backward compatibility
    updateMessageStatus(messageId, response, originalMessage);
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
          <div style={{display: 'flex', flexDirection: 'column'}}>
            <h2 style={{ 
              margin: 0, 
              color: '#5ccfe6', 
              fontFamily: '"Fira Code", monospace',
              letterSpacing: '1px'
            }}>WhisperNet_</h2>
            {connected && (
              <div style={{
                fontSize: '12px',
                color: '#bae67e',
                marginTop: '4px'
              }}>
                Logged in as: <span style={{fontWeight: 'bold'}}>{username}</span>
              </div>
            )}
          </div>
          <div style={{ 
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            {encryptionEnabled && (
              <div style={{ 
                fontSize: 12, 
                padding: '4px 8px', 
                borderRadius: 4, 
                background: '#1c4b3c',
                color: '#5ccfe6',
              }} title="End-to-end encryption enabled">
                🔒
              </div>
            )}
            {offlineMessageEnabled && (
              <div style={{ 
                fontSize: 12, 
                padding: '4px 8px', 
                borderRadius: 4, 
                background: '#3c1c4b',
                color: '#c792ea',
              }} title="Offline message delivery enabled">
                📨
              </div>
            )}
            <div style={{ 
              fontSize: 12, 
              padding: '4px 8px', 
              borderRadius: 4, 
              background: relayStatus === 'online' ? '#1c4b3c' : '#4b1c1c',
              color: relayStatus === 'online' ? '#5ccfe6' : '#ff8f40',
              cursor: 'pointer'
            }} onClick={() => setShowConnectionInfo(!showConnectionInfo)}>
              {relayStatus === 'online' ? '🟢' : '🔴'}
            </div>
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
            {activeRelay && (
              <div>Relay Node: <span style={{
                color: '#bae67e'
              }}>{activeRelay.ip}:{activeRelay.port}</span></div>
            )}
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
                      background: recipientStatus.online ? '#bae67e' : '#ff8f40',
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
                    background: recipientStatus.exists ? 
                      'linear-gradient(90deg, #5ccfe6, #bae67e)' : 
                      '#636b78', 
                    color: '#171c28', 
                    fontWeight: 'bold', 
                    fontSize: 14, 
                    border: 'none',
                    cursor: recipientStatus.exists ? 'pointer' : 'not-allowed',
                    fontFamily: '"Fira Code", monospace'
                  }} 
                  type="submit"
                  disabled={!recipientStatus.exists}
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
            
            {/* Relay Message Dialog */}
            {showRelayDialog && (
              <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.8)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 1000
              }}>
                <div style={{
                  background: '#0d1117',
                  borderRadius: 8,
                  padding: 24,
                  maxWidth: 500,
                  width: '90%',
                  border: '1px solid #1e2d3d',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
                }}>
                  <h3 style={{ color: '#bae67e', marginTop: 0 }}>Relay Message</h3>
                  <p style={{ color: '#a2aabc', lineHeight: 1.5 }}>
                    The recipient <strong style={{ color: '#5ccfe6' }}>{recipient}</strong> was not found on the network.
                  </p>
                  <p style={{ color: '#a2aabc', lineHeight: 1.5 }}>
                    You can send this message as a <strong>relay message</strong>. It will be stored on the network and delivered when the recipient comes online.
                  </p>
                  <div style={{ background: '#171c28', padding: 12, borderRadius: 4, marginBottom: 16 }}>
                    <p style={{ color: '#ff8f40', marginTop: 0 }}><strong>How it works:</strong></p>
                    <ul style={{ color: '#a2aabc', paddingLeft: 20 }}>
                      <li>Your message will be stored encrypted on relay servers</li>
                      <li>It will be delivered when the recipient connects</li>
                      <li>Messages expire after 24 hours if not delivered</li>
                      <li>No guarantee of delivery if the user never connects</li>
                    </ul>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                    <button 
                      onClick={handleRelayCancel}
                      style={{ 
                        padding: '8px 16px', 
                        background: '#4b1c1c', 
                        color: '#ff8f40', 
                        border: 'none', 
                        borderRadius: 4, 
                        cursor: 'pointer',
                        fontFamily: '"Fira Code", monospace'
                      }}
                    >
                      CANCEL
                    </button>
                    <button 
                      onClick={handleRelayConfirm}
                      style={{ 
                        padding: '8px 16px', 
                        background: 'linear-gradient(90deg, #5ccfe6, #bae67e)', 
                        color: '#171c28', 
                        fontWeight: 'bold',
                        border: 'none', 
                        borderRadius: 4, 
                        cursor: 'pointer',
                        fontFamily: '"Fira Code", monospace'
                      }}
                    >
                      SEND RELAY MESSAGE
                    </button>
                  </div>
                </div>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {msg.encrypted && (
                          <span title="End-to-end encrypted" style={{ fontSize: 10 }}>🔒</span>
                        )}
                        <span style={{ color: '#636b78' }}>{formatMessageTime(msg.timestamp)}</span>
                      </div>
                    </div>
                    <div style={{ wordBreak: 'break-word', fontSize: 14 }}>
                      {msg.message}
                      {msg.isRelay && (
                        <span style={{ 
                          fontSize: 10, 
                          color: '#ff8f40', 
                          marginLeft: 6, 
                          padding: '2px 4px', 
                          background: 'rgba(255, 143, 64, 0.1)', 
                          borderRadius: 2 
                        }}>RELAY</span>
                      )}
                      {msg.pending && (
                        <span style={{ 
                          fontSize: 10, 
                          color: '#ffcc66', 
                          marginLeft: 6, 
                          padding: '2px 4px', 
                          background: 'rgba(255, 204, 102, 0.1)', 
                          borderRadius: 2 
                        }}>SENDING...</span>
                      )}
                      {msg.failed && (
                        <span style={{ 
                          fontSize: 10, 
                          color: '#ff3333', 
                          marginLeft: 6, 
                          padding: '2px 4px', 
                          background: 'rgba(255, 51, 51, 0.1)', 
                          borderRadius: 2,
                          cursor: 'pointer',
                          title: msg.failureReason || 'Failed to send'
                        }}>FAILED</span>
                      )}
                      {msg.delivered && (
                        <span style={{ 
                          fontSize: 10, 
                          color: '#bae67e', 
                          marginLeft: 6, 
                          padding: '2px 4px', 
                          background: 'rgba(186, 230, 126, 0.1)', 
                          borderRadius: 2 
                        }}>DELIVERED</span>
                      )}
                    </div>
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