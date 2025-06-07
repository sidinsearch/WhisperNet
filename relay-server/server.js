import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { io as connectToBase } from 'socket.io-client';

const app = express();

// Get external IP for relay identification
const getExternalIP = async () => {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip;
  } catch (error) {
    console.warn('Could not get external IP, using localhost');
    return 'localhost';
  }
};

app.get('/', (req, res) => {
  const baseNodeUrl = process.env.BASE_NODE_URL || 'http://localhost:5000';
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relay Server Live</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#181c20;color:#fff;font-family:sans-serif;flex-direction:column;}h1{font-size:4rem;letter-spacing:2px;}p{font-size:1.5rem;margin-top:2rem;}@media(max-width:600px){h1{font-size:2rem;}p{font-size:1rem;}}</style></head><body><h1>Relay Server is Live</h1><p>Base Node URL: <span style='color:#4ecdc4;'>${baseNodeUrl}</span></p><p>Relay Status: <span id="status" style='color:#4ecdc4;'>Connecting...</span></p><script>setTimeout(()=>{document.getElementById('status').textContent='Online';},2000);</script></body></html>`);
});

const server = http.createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: false
  } 
});

// Configuration
const BASE_NODE_URL = process.env.BASE_NODE_URL || 'http://localhost:5000';
const RELAY_PORT = process.env.PORT || 3001;

let RELAY_IP = 'localhost';
let relayId = null;

// Initialize relay IP
(async () => {
  RELAY_IP = await getExternalIP();
  console.log(`Relay IP determined as: ${RELAY_IP}`);
})();

// Storage for connected users
const userSockets = {}; // username -> socket
const socketUsers = {}; // socket.id -> { username, deviceId, status }

// Storage for offline messages
const pendingMessages = {}; // username -> [messages]

// Relay capabilities
const RELAY_CAPABILITIES = {
  offlineRelay: true,  // Support for offline message relay
  encryption: true     // Support for end-to-end encryption
};

// Base node connection
let baseSocket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;

const connectToBaseNode = () => {
  console.log(`Connecting to base node at ${BASE_NODE_URL}...`);
  
  baseSocket = connectToBase(BASE_NODE_URL, {
    transports: ['websocket', 'polling'],
    timeout: 10000
  });
  
  baseSocket.on('connect', () => {
    console.log('Connected to base node');
    
    // Register this relay server with the base node
    baseSocket.emit('registerRelay', { 
      ip: RELAY_IP, 
      port: RELAY_PORT,
      capabilities: RELAY_CAPABILITIES 
    }, (response) => {
      if (response && response.success) {
        relayId = response.relayId || `${RELAY_IP}:${RELAY_PORT}`;
        console.log(`Relay registered with ID: ${relayId}`);
        
        // Get the list of available relays
        baseSocket.emit('getRelays', {}, (relays) => {
          if (Array.isArray(relays)) {
            console.log(`Received relay list from base node: ${relays.length} relays`);
            // Broadcast relay list to all connected clients
            io.emit('relayList', relays);
          }
        });
      } else {
        console.error('Failed to register relay:', response);
      }
    });
  });
  
  baseSocket.on('disconnect', () => {
    console.log('Disconnected from base node');
    
    // Try to reconnect after a delay
    setTimeout(() => {
      console.log('Attempting to reconnect to base node...');
      connectToBaseNode();
    }, 5000);
  });
  
  // Handle message delivery requests from base node with encryption support
  baseSocket.on('deliverMessage', ({ id, from, to, message, deviceId, encrypted, encryptedContent, iv, isNewDevice, timestamp }) => {
    console.log(`Delivery request from base node: ${from} -> ${to}`);
    
    // Check if recipient is connected to this relay
    if (userSockets[to]) {
      userSockets[to].emit('receiveMessage', {
        id,
        from,
        message,
        fromDeviceId: deviceId,
        encrypted,
        encryptedContent,
        iv,
        isNewDevice,
        timestamp: timestamp || new Date().toISOString()
      });
      console.log(`Message delivered to ${to}`);
      
      // Confirm delivery to base node
      if (id) {
        baseSocket.emit('confirmMessageDelivery', { messageId: id, to });
      }
    } else {
      console.log(`User ${to} not found on this relay`);
    }
  });
  
  // Handle relay status updates
  baseSocket.on('relayStatusUpdate', (data) => {
    console.log(`Relay status update: ${data.relayId} is ${data.status}`);
    // Forward to connected clients
    io.emit('relayStatusUpdate', data);
  });
  
  // Handle relay list updates
  baseSocket.on('relayList', (relays) => {
    console.log(`Received relay list update: ${relays.length} relays`);
    // Forward to connected clients
    io.emit('relayList', relays);
  });

  return baseSocket;
};

// Initialize base node connection
connectToBaseNode();

// Send heartbeat to base node
setInterval(() => {
  if (baseSocket && baseSocket.connected) {
    baseSocket.emit('heartbeat', { relayId });
    console.log('Sent heartbeat to base node');
  }
}, 30000); // Every 30 seconds

// Clean up expired messages
setInterval(() => {
  const now = Date.now();
  for (const username in pendingMessages) {
    if (pendingMessages[username] && pendingMessages[username].length > 0) {
      const validMessages = pendingMessages[username].filter(msg => now < msg.ttl);
      if (validMessages.length !== pendingMessages[username].length) {
        console.log(`Cleaned up ${pendingMessages[username].length - validMessages.length} expired messages for ${username}`);
        pendingMessages[username] = validMessages;
      }
    }
  }
}, 60000); // Every minute

// Handle client connections
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Handle user registration with device fingerprinting and encryption support
  socket.on('register', ({ username, deviceId, publicKey }, ack) => {
    console.log(`Registration request: ${username} with device ${deviceId}`);
    
    // Check with base node if username is available
    baseSocket.emit('checkUser', { username }, (response) => {
      if (response.exists && response.online) {
        // If it's the same device, allow reconnection
        if (response.knownDevices && response.knownDevices.includes(deviceId)) {
          console.log(`User ${username} reconnecting with same device`);
        } else {
          console.log(`Username ${username} is already in use by a different device`);
          if (ack) ack({ success: false, message: 'Username is already in use by a different device' });
          return;
        }
      }
      
      // Register user locally
      userSockets[username] = socket;
      socketUsers[socket.id] = { 
        username, 
        deviceId, 
        status: 'online',
        publicKey
      };
      
      // Register with base node
      baseSocket.emit('registerUser', { 
        username, 
        deviceId, 
        relayId,
        publicKey
      }, (baseResponse) => {
        console.log(`Base node registration response:`, baseResponse);
        
        if (baseResponse && baseResponse.success) {
          console.log(`User ${username} registered successfully`);
          
          // Check if there are any pending messages for this user
          const userPendingMessages = pendingMessages[username] || [];
          
          if (userPendingMessages.length > 0) {
            console.log(`Delivering ${userPendingMessages.length} pending messages to ${username}`);
            
            // Deliver each message
            userPendingMessages.forEach(msg => {
              socket.emit('receiveMessage', {
                id: msg.id,
                from: msg.from,
                message: msg.content,
                encrypted: msg.encrypted,
                encryptedContent: msg.encryptedContent,
                iv: msg.iv,
                fromDeviceId: msg.fromDeviceId,
                timestamp: msg.timestamp,
                isOfflineMessage: true
              });
            });
            
            // Clear the pending messages for this user
            delete pendingMessages[username];
          }
          
          // If base node sent pending messages, deliver those too
          if (baseResponse.pendingMessages && baseResponse.pendingMessages.length > 0) {
            console.log(`Delivering ${baseResponse.pendingMessages.length} offline messages from base node to ${username}`);
            
            baseResponse.pendingMessages.forEach(msg => {
              socket.emit('receiveMessage', {
                id: msg.id,
                from: msg.from,
                message: msg.content,
                encrypted: msg.encrypted,
                encryptedContent: msg.encryptedContent,
                iv: msg.iv,
                fromDeviceId: msg.fromDeviceId,
                timestamp: msg.timestamp,
                isOfflineMessage: true
              });
            });
          }
          
          if (ack) ack({ 
            success: true, 
            message: 'Registration successful',
            relayId,
            isNewDevice: baseResponse.isNewDevice
          });
        } else {
          console.log(`Failed to register user ${username} with base node`);
          delete userSockets[username];
          delete socketUsers[socket.id];
          
          if (ack) ack({ 
            success: false, 
            message: baseResponse?.message || 'Registration failed'
          });
        }
      });
    });
  });

  // Handle message sending with encryption and offline support
  socket.on('sendMessage', ({ to, message, encrypted, encryptedContent, iv, ttl }, ack) => {
    // Get sender information
    const fromUser = socketUsers[socket.id];
    if (!fromUser) {
      console.log('Unknown sender');
      if (ack) ack({ success: false, message: 'You are not registered' });
      return;
    }
    
    // Generate message ID
    const messageId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const timestamp = new Date().toISOString();
    
    console.log(`Message from ${fromUser.username} to ${to}`);
    if (encrypted) {
      console.log('Message is encrypted');
    }
    
    // Create message object
    const messageObj = {
      id: messageId,
      from: fromUser.username,
      to,
      content: message,
      fromDeviceId: fromUser.deviceId,
      timestamp,
      encrypted,
      encryptedContent,
      iv,
      ttl: ttl || (Date.now() + (4 * 60 * 60 * 1000)), // Default 4 hour TTL
      bounceCount: 0,
      maxBounces: 10
    };
    
    // Check if recipient is connected to this relay
    if (userSockets[to]) {
      // Check if this is a new device and should trigger a warning
      baseSocket.emit('checkUser', { username: to }, (response) => {
        const isNewDevice = response.knownDevices && 
                           !response.knownDevices.includes(fromUser.deviceId);
        
        // Deliver locally
        userSockets[to].emit('receiveMessage', {
          id: messageId,
          from: fromUser.username,
          message,
          encrypted,
          encryptedContent,
          iv,
          fromDeviceId: fromUser.deviceId,
          timestamp,
          isNewDevice
        });
        
        console.log(`Message delivered locally to ${to}`);
        if (ack) ack({ success: true, message: 'Message delivered', id: messageId });
      });
    } else {
      // Check with base node if user exists
      baseSocket.emit('checkUser', { username: to }, (response) => {
        if (!response.exists) {
          // User doesn't exist
          console.log(`User ${to} does not exist`);
          
          // If offline relay is enabled and TTL is provided, store the message
          if (ttl) {
            if (!pendingMessages[to]) {
              pendingMessages[to] = [];
            }
            pendingMessages[to].push(messageObj);
            console.log(`Message stored for future delivery to ${to}`);
            if (ack) ack({ success: true, message: 'Message stored for future delivery', id: messageId });
          } else {
            if (ack) ack({ success: false, message: 'User does not exist' });
          }
          return;
        }
        
        if (!response.online) {
          // User exists but is offline
          console.log(`User ${to} is offline`);
          
          // If offline relay is enabled and TTL is provided, store the message
          if (ttl) {
            // Route through base node for offline storage
            baseSocket.emit('sendMessage', {
              to,
              message,
              deviceId: fromUser.deviceId,
              id: messageId,
              encrypted,
              encryptedContent,
              iv,
              ttl
            }, (response) => {
              console.log(`Offline message routing result:`, response);
              if (ack) ack({ 
                success: response?.success || false, 
                message: response?.message || 'Routing failed',
                id: messageId
              });
            });
          } else {
            if (ack) ack({ success: false, message: 'User is offline' });
          }
          return;
        }
        
        // User exists and is online, but not on this relay
        // Route through base node
        baseSocket.emit('sendMessage', {
          to,
          message,
          deviceId: fromUser.deviceId,
          id: messageId,
          encrypted,
          encryptedContent,
          iv
        }, (response) => {
          console.log(`Message routing result:`, response);
          if (ack) ack({ 
            success: response?.success || false, 
            message: response?.message || 'Routing failed',
            id: messageId
          });
        });
      });
    }
  });

  // Handle incoming messages
  socket.on('message', (message) => {
    if (!message.to) {
      return console.error('Received message without recipient');
    }
    
    // Forward message to base node
    baseSocket.emit('routeMessage', {
      from: message.from,
      to: message.to,
      message
    });
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    // Clean up user registry
    const user = socketUsers[socket.id];
    if (user) {
      const { username } = user;
      console.log(`User ${username} disconnected`);
      
      // Remove from local registry
      delete userSockets[username];
      delete socketUsers[socket.id];
      
      // Notify base node
      baseSocket.emit('userDisconnected', { username, relayId });
    }
  });
  
  // Handle message bounce requests (for offline message relay)
  socket.on('bounceMessage', (message, ack) => {
    // Increment bounce count
    message.bounceCount = (message.bounceCount || 0) + 1;
    
    // Check if message has expired or reached max bounces
    if (Date.now() > message.ttl || message.bounceCount > message.maxBounces) {
      console.log(`Message ${message.id} expired or reached max bounces`);
      if (ack) ack({ success: false, message: 'Message expired or reached max bounces' });
      return;
    }
    
    // Check if recipient is connected to this relay
    if (userSockets[message.to]) {
      // Deliver the message
      userSockets[message.to].emit('receiveMessage', {
        id: message.id,
        from: message.from,
        message: message.content,
        encrypted: message.encrypted,
        encryptedContent: message.encryptedContent,
        iv: message.iv,
        fromDeviceId: message.fromDeviceId,
        timestamp: message.timestamp,
        isOfflineMessage: true
      });
      
      console.log(`Bounced message delivered to ${message.to}`);
      if (ack) ack({ success: true, message: 'Message delivered' });
      
      // Confirm delivery to base node
      baseSocket.emit('confirmMessageDelivery', { messageId: message.id, to: message.to });
    } else {
      // Store for offline delivery or bounce to base node
      if (Math.random() < 0.5) { // 50% chance to store locally vs bounce to base node
        // Store locally
        if (!pendingMessages[message.to]) {
          pendingMessages[message.to] = [];
        }
        pendingMessages[message.to].push(message);
        console.log(`Bounced message stored locally for ${message.to}`);
        if (ack) ack({ success: true, message: 'Message stored locally' });
      } else {
        // Bounce to base node
        baseSocket.emit('bounceMessage', message, (response) => {
          console.log(`Message bounce result:`, response);
          if (ack) ack(response);
        });
      }
    }
  });
  
  // Handle public key exchange
  socket.on('sharePublicKey', ({ username, publicKey }, ack) => {
    const fromUser = socketUsers[socket.id];
    if (!fromUser) {
      console.log('Unknown sender trying to share public key');
      if (ack) ack({ success: false, message: 'You are not registered' });
      return;
    }
    
    console.log(`${fromUser.username} is sharing public key with ${username}`);
    
    // Check if recipient is connected to this relay
    if (userSockets[username]) {
      userSockets[username].emit('publicKeyShared', {
        from: fromUser.username,
        publicKey,
        deviceId: fromUser.deviceId
      });
      
      console.log(`Public key shared with ${username}`);
      if (ack) ack({ success: true, message: 'Public key shared' });
    } else {
      // Route through base node
      baseSocket.emit('sharePublicKey', {
        from: fromUser.username,
        to: username,
        publicKey,
        deviceId: fromUser.deviceId
      }, (response) => {
        console.log(`Public key sharing result:`, response);
        if (ack) ack({ 
          success: response?.success || false, 
          message: response?.message || 'Public key sharing failed'
        });
      });
    }
  });
  
  // Get available relays
  socket.on('getRelays', (_, ack) => {
    baseSocket.emit('getRelays', {}, (relays) => {
      if (ack) ack(relays);
    });
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  clearInterval(heartbeatInterval);
  
  if (baseSocket) {
    baseSocket.disconnect();
  }
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

server.listen(RELAY_PORT, () => {
  console.log(`Relay server running on port ${RELAY_PORT}`);
  console.log(`Relay server URL: http://localhost:${RELAY_PORT}`);
});