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
  console.log(`Relay server started on port ${RELAY_PORT}`);
})();

// Storage for connected users
const userSockets = {}; // username -> socket
const socketUsers = {}; // socket.id -> { username, deviceId, status }

// Storage for pending messages (relay bounce system)
const pendingMessages = {}; // username -> [{ from, message, fromDeviceId, timestamp, expiresAt }]

// Function to clean up expired messages
const cleanupExpiredMessages = () => {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const username in pendingMessages) {
    const userMessages = pendingMessages[username];
    const validMessages = userMessages.filter(msg => msg.expiresAt > now);
    
    cleanedCount += (userMessages.length - validMessages.length);
    
    if (validMessages.length === 0) {
      delete pendingMessages[username];
    } else {
      pendingMessages[username] = validMessages;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} expired messages`);
  }
};

// Base node connection
let baseSocket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;

const connectToBaseNode = () => {
  console.log(`Connecting to base node at ${BASE_NODE_URL}...`);
  
  baseSocket = connectToBase(BASE_NODE_URL, {
    transports: ['websocket', 'polling'],
    timeout: 10000,
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    maxReconnectionAttempts: maxReconnectAttempts
  });

  baseSocket.on('connect', () => {
    console.log('Connected to base node successfully');
    reconnectAttempts = 0;
    
    // Register this relay with the base node
    baseSocket.emit('registerRelay', { 
      ip: RELAY_IP, 
      port: RELAY_PORT 
    }, (response) => {
      if (response && response.success) {
        relayId = response.relayId || `${RELAY_IP}:${RELAY_PORT}`;
        console.log(`Relay registered with ID: ${relayId}`);
        
        // Send a heartbeat immediately to ensure the base node has our status
        baseSocket.emit('relayHeartbeat', { 
          relayId: relayId,
          ip: RELAY_IP, 
          port: RELAY_PORT,
          connectedUsers: Object.keys(userSockets).length,
          status: 'online'
        });
      } else {
        console.error('Failed to register relay:', response);
      }
    });
  });

  baseSocket.on('connect_error', (error) => {
    console.error('Base node connection error:', error.message);
    reconnectAttempts++;
    
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.error('Max reconnection attempts reached. Relay will operate in standalone mode.');
    }
  });

  baseSocket.on('disconnect', (reason) => {
    console.log(`Disconnected from base node: ${reason}`);
  });

  // Handle message delivery from base node
  baseSocket.on('deliverMessage', ({ from, to, message, fromDeviceId, timestamp, encrypted, publicKey }) => {
    console.log(`Delivering message from base node to local user`);
    
    if (userSockets[to]) {
      userSockets[to].emit('receiveMessage', { 
        from, 
        message, 
        fromDeviceId,
        timestamp: timestamp || new Date().toISOString(),
        encrypted,
        publicKey
      });
      console.log(`Message delivered to recipient`);
    } else {
      console.log(`Recipient not found on this relay`);
      
      // Store the message for later delivery if the user connects to this relay
      const expiresAt = Date.now() + 14400000; // 4 hours
      
      if (!pendingMessages[to]) {
        pendingMessages[to] = [];
      }
      
      pendingMessages[to].push({
        from,
        message,
        fromDeviceId,
        timestamp: timestamp || new Date().toISOString(),
        expiresAt,
        encrypted,
        publicKey
      });
      
      console.log(`Message queued for later delivery`);
    }
  });

  return baseSocket;
};

// Initialize base node connection
connectToBaseNode();

// Send heartbeat to base node
const heartbeatInterval = setInterval(() => {
  if (baseSocket && baseSocket.connected) {
    baseSocket.emit('relayHeartbeat', { 
      relayId: relayId,
      ip: RELAY_IP, 
      port: RELAY_PORT,
      connectedUsers: Object.keys(userSockets).length,
      status: 'online',
      pendingMessageCount: Object.values(pendingMessages).reduce((acc, msgs) => acc + msgs.length, 0)
    });
  }
}, 10000); // Every 10 seconds

// Clean up expired messages every minute
const cleanupInterval = setInterval(cleanupExpiredMessages, 60000);

// Handle client connections
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Handle user registration
  socket.on('register', ({ username, deviceId }, ack) => {
    console.log(`Registration request received (user ID: ${socket.id.substring(0, 6)}...)`);
    // Privacy: Not logging actual username or device ID
    
    // Check if username is already taken locally
    const existingUser = Object.values(socketUsers).find(user => 
      user.username === username && user.deviceId !== deviceId
    );
    
    if (existingUser) {
      console.log(`Registration failed: username already taken locally`);
      if (ack) ack({ success: false, reason: 'Username already taken by another device on this relay' });
      return;
    }
    
    // Register with base node
    if (baseSocket && baseSocket.connected) {
      baseSocket.emit('registerUser', { 
        username, 
        deviceId, 
        relayId: relayId 
      }, (response) => {
        if (response && response.success) {
          // Successfully registered with base node
          userSockets[username] = socket;
          socketUsers[socket.id] = { 
            username, 
            deviceId,
            status: 'online'
          };
          
          console.log(`User registered successfully (socket ID: ${socket.id.substring(0, 6)}...)`);
          console.log(`Total users connected: ${Object.keys(userSockets).length}`);
          
          // Check for pending messages
          if (pendingMessages[username] && pendingMessages[username].length > 0) {
            console.log(`Delivering ${pendingMessages[username].length} pending messages to user`);
            
            // Deliver all pending messages
            pendingMessages[username].forEach(msg => {
              socket.emit('receiveMessage', {
                from: msg.from,
                message: msg.message,
                fromDeviceId: msg.fromDeviceId,
                timestamp: msg.timestamp,
                bounced: true
              });
            });
            
            // Clear pending messages for this user
            delete pendingMessages[username];
          }
          
          if (ack) ack({ success: true });
        } else {
          console.log(`Base node rejected registration:`, response?.reason);
          if (ack) ack({ 
            success: false, 
            reason: response?.reason || 'Registration failed' 
          });
        }
      });
    } else {
      // Base node not connected - register locally only
      console.log(`Base node not connected, registering user locally`);
      console.log(`Total users connected: ${Object.keys(userSockets).length + 1}`);
      userSockets[username] = socket;
      socketUsers[socket.id] = { 
        username, 
        deviceId,
        status: 'online'
      };
      
      // Check for pending messages
      if (pendingMessages[username] && pendingMessages[username].length > 0) {
        console.log(`Delivering ${pendingMessages[username].length} pending messages to user`);
        
        // Deliver all pending messages
        pendingMessages[username].forEach(msg => {
          socket.emit('receiveMessage', {
            from: msg.from,
            message: msg.message,
            fromDeviceId: msg.fromDeviceId,
            timestamp: msg.timestamp,
            bounced: true
          });
        });
        
        // Clear pending messages for this user
        delete pendingMessages[username];
      }
      
      if (ack) ack({ success: true, warning: 'Registered locally only - base node not available' });
    }
  });
  
  // Check if a recipient exists and is online
  socket.on('checkRecipient', ({ username }, ack) => {
    console.log(`Checking recipient status...`);
    
    // First check locally
    if (userSockets[username]) {
      console.log(`Recipient found locally and is online`);
      if (ack) ack({ exists: true, online: true, location: 'local' });
      return;
    }
    
    // Check if we have pending messages for this user
    // If we do, it means the user exists but is offline
    if (pendingMessages[username] && pendingMessages[username].length > 0) {
      console.log(`${username} has pending messages, marking as exists but offline`);
      if (ack) ack({ exists: true, online: false, location: 'pending', hasPendingMessages: true });
      return;
    }
    
    // Check with base node
    if (baseSocket && baseSocket.connected) {
      console.log(`Checking ${username} with base node`);
      baseSocket.emit('checkUser', { username }, (response) => {
        console.log(`Base node response for ${username}:`, response);
        if (ack) ack({ 
          exists: response?.exists || false, 
          online: response?.online || false,
          location: 'remote'
        });
      });
    } else {
      // If base node is not available, assume user might exist
      // This allows relay messages to be sent even when base node is down
      console.log(`Base node not available, assuming ${username} might exist`);
      if (ack) ack({ exists: true, online: false, location: 'unknown', notRegisteredYet: true });
    }
  });
  
  // Handle message sending
  socket.on('sendMessage', ({ to, message, deviceId, bounce = false, encrypted = false, publicKey = null, timestamp = null }, ack) => {
    const fromUser = socketUsers[socket.id];
    if (!fromUser) {
      console.log('Message from unregistered user');
      if (ack) ack({ delivered: false, reason: 'Not registered' });
      return;
    }
    
    console.log(`Message from ${fromUser.username} to ${to}: ${encrypted ? '[ENCRYPTED]' : message}`);
    
    // Check if recipient is connected to this relay
    if (userSockets[to]) {
      // Local delivery
      userSockets[to].emit('receiveMessage', {
        from: fromUser.username,
        message,
        fromDeviceId: deviceId || fromUser.deviceId,
        timestamp: timestamp || new Date().toISOString(),
        encrypted,
        publicKey,
        bounced: false
      });
      
      console.log(`Message delivered locally to ${to}`);
      if (ack) ack({ delivered: true, method: 'local' });
    } else {
      // Try to route through base node
      if (baseSocket && baseSocket.connected) {
        baseSocket.emit('routeMessage', {
          from: fromUser.username,
          to,
          message,
          deviceId: deviceId || fromUser.deviceId,
          encrypted,
          publicKey,
          timestamp: timestamp || new Date().toISOString()
        }, (response) => {
          console.log(`Message routing result:`, response);
          
          // If delivery failed and bounce is requested, store the message for later delivery
          if (!response?.delivered && bounce) {
            // Store message for 4 hours (14400000 ms)
            const expiresAt = Date.now() + 14400000;
            
            if (!pendingMessages[to]) {
              pendingMessages[to] = [];
            }
            
            pendingMessages[to].push({
              from: fromUser.username,
              message,
              fromDeviceId: deviceId || fromUser.deviceId,
              timestamp: timestamp || new Date().toISOString(),
              expiresAt,
              encrypted,
              publicKey
            });
            
            // Always store the message for potential delivery
            console.log(`Message queued for ${to}, will expire in 4 hours.`);
            if (ack) ack({ 
              delivered: false, 
              bounced: true,
              expiresAt,
              reason: 'Message queued for delivery when recipient is available'
            });
          } else {
            if (ack) ack({ 
              delivered: response?.delivered || false, 
              reason: response?.reason,
              method: 'routed'
            });
          }
        });
      } else {
        // If base node is not available and bounce is requested, store locally
        if (bounce) {
          const expiresAt = Date.now() + 14400000; // 4 hours
          
          if (!pendingMessages[to]) {
            pendingMessages[to] = [];
          }
          
          pendingMessages[to].push({
            from: fromUser.username,
            message,
            fromDeviceId: deviceId || fromUser.deviceId,
            timestamp: timestamp || new Date().toISOString(),
            expiresAt,
            encrypted,
            publicKey
          });
          
          console.log(`Message queued locally for ${to}, will expire in 4 hours`);
          if (ack) ack({ 
            delivered: false, 
            bounced: true,
            expiresAt,
            reason: 'Message queued for delivery when recipient is available'
          });
        } else {
          console.log('Cannot route message - base node not connected');
          if (ack) ack({ 
            delivered: false, 
            reason: 'Base node not available for routing' 
          });
        }
      }
    }
  });
  
  // Handle typing indicators
  socket.on('typing', ({ to }) => {
    if (userSockets[to]) {
      userSockets[to].emit('userTyping', { 
        username: socketUsers[socket.id]?.username 
      });
    }
  });
  
  // Handle explicit user logout
  socket.on('userLogout', ({ username, deviceId }, ack) => {
    console.log(`User ${username} (${deviceId}) explicitly logged out`);
    
    const user = socketUsers[socket.id];
    if (user && user.username === username) {
      // Remove from our local registry
      delete userSockets[username];
      delete socketUsers[socket.id];
      
      // Notify base node if connected
      if (baseSocket && baseSocket.connected) {
        baseSocket.emit('userLogout', { 
          username, 
          deviceId,
          relayId 
        });
        
        console.log(`Notified base node about logout of ${username}`);
      }
      
      // Notify other users about the status change
      io.emit('userStatusUpdate', { username, online: false });
      
      // Ensure the username is fully released
      console.log(`Username ${username} has been released and is now available`);
    } else {
      // Handle case where the logout request comes from a different socket
      // This can happen if the user is trying to login from a new device/session
      if (userSockets[username]) {
        console.log(`Handling logout for ${username} from a different socket`);
        
        // Get the device ID from our records
        const existingDeviceId = Object.values(socketUsers).find(u => u.username === username)?.deviceId;
        
        // Remove from our local registry
        delete userSockets[username];
        
        // Remove from socketUsers (need to find the socket ID first)
        const socketId = Object.keys(socketUsers).find(id => socketUsers[id].username === username);
        if (socketId) {
          delete socketUsers[socketId];
        }
        
        // Notify base node if connected
        if (baseSocket && baseSocket.connected) {
          baseSocket.emit('userLogout', { 
            username, 
            deviceId: existingDeviceId || deviceId,
            relayId 
          });
          
          console.log(`Notified base node about logout of ${username} from different socket`);
        }
        
        // Notify other users about the status change
        io.emit('userStatusUpdate', { username, online: false });
      }
    }
    
    if (ack) ack({ success: true });
  });
  
  // Handle public key requests
  socket.on('requestPublicKey', ({ username }, ack) => {
    const fromUser = socketUsers[socket.id];
    if (!fromUser) {
      if (ack) ack({ success: false, reason: 'Not registered' });
      return;
    }
    
    console.log(`Public key request from ${fromUser.username} for ${username}`);
    
    // Check if user is connected to this relay
    if (userSockets[username]) {
      // Request the public key from the user
      userSockets[username].emit('publicKeyRequest', { from: fromUser.username }, (response) => {
        if (response && response.publicKey) {
          console.log(`Received public key for ${username}, forwarding to ${fromUser.username}`);
          if (ack) ack({ success: true, publicKey: response.publicKey });
        } else {
          console.log(`No public key available for ${username}`);
          if (ack) ack({ success: false, reason: 'Public key not available' });
        }
      });
    } else if (baseSocket && baseSocket.connected) {
      // Try to get the key through the base node
      baseSocket.emit('requestPublicKey', { from: fromUser.username, username }, (response) => {
        if (response && response.publicKey) {
          console.log(`Received public key for ${username} from base node`);
          if (ack) ack({ success: true, publicKey: response.publicKey });
        } else {
          console.log(`No public key available for ${username} from base node`);
          if (ack) ack({ success: false, reason: response?.reason || 'Public key not available' });
        }
      });
    } else {
      console.log(`Cannot request public key - user not found and base node not connected`);
      if (ack) ack({ success: false, reason: 'User not found and base node not available' });
    }
  });
  
  // Get relay information
  socket.on('getRelayInfo', (_, ack) => {
    if (ack) {
      const info = {
        relayId: relayId || `${RELAY_IP}:${RELAY_PORT}`,
        ip: RELAY_IP,
        port: RELAY_PORT,
        status: baseSocket?.connected ? 'connected_to_base' : 'standalone',
        baseNodeUrl: BASE_NODE_URL,
        connectedUsers: Object.keys(userSockets).length,
        connectedUsersList: Object.keys(userSockets),
        uptime: process.uptime(),
        pendingMessageCount: Object.values(pendingMessages).reduce((acc, msgs) => acc + msgs.length, 0)
      };
      console.log('Sending relay info:', info);
      ack(info);
    }
  });
  
  // Get online users
  socket.on('getOnlineUsers', (_, ack) => {
    // First get locally connected users
    const localUsers = Object.keys(userSockets);
    
    // If connected to base node, also get users from there
    if (baseSocket && baseSocket.connected) {
      baseSocket.emit('getOnlineUsers', {}, (baseUsers) => {
        // Combine local and base node users, removing duplicates
        const allUsers = [...new Set([...localUsers, ...(baseUsers || [])])];
        console.log('All online users:', allUsers);
        if (ack) ack(allUsers);
      });
    } else {
      // Just return local users
      console.log('Local online users:', localUsers);
      if (ack) ack(localUsers);
    }
  });
  
  // Get detailed relay status
  socket.on('getRelayStatus', (_, ack) => {
    if (ack) {
      const status = {
        relayId: relayId || `${RELAY_IP}:${RELAY_PORT}`,
        ip: RELAY_IP,
        port: RELAY_PORT,
        baseNodeConnected: baseSocket?.connected || false,
        baseNodeUrl: BASE_NODE_URL,
        connectedUsers: Object.keys(userSockets).length,
        connectedUsersList: Object.keys(userSockets),
        pendingMessages: Object.keys(pendingMessages).map(username => ({
          username,
          messageCount: pendingMessages[username].length
        })),
        uptime: process.uptime()
      };
      ack(status);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    const user = socketUsers[socket.id];
    if (user) {
      const { username, deviceId } = user;
      console.log(`User ${username} (${deviceId}) disconnected`);
      
      // Remove from our local registry
      delete userSockets[username];
      delete socketUsers[socket.id];
      
      // Notify base node if connected
      if (baseSocket && baseSocket.connected) {
        baseSocket.emit('userDisconnected', { 
          username, 
          deviceId,
          relayId 
        });
        
        console.log(`Notified base node about disconnection of ${username}`);
      }
      
      // Notify other users about the status change
      io.emit('userStatusUpdate', { username, online: false });
      
      // If there are pending messages for this user, keep them for a while
      if (pendingMessages[username] && pendingMessages[username].length > 0) {
        console.log(`Keeping ${pendingMessages[username].length} pending messages for ${username}`);
        // They will be cleaned up by the regular cleanup interval
      }
      
      // Set a timeout to ensure the username is fully released if the user doesn't reconnect
      setTimeout(() => {
        // Double-check that the user hasn't reconnected
        if (!userSockets[username]) {
          console.log(`Ensuring username ${username} is fully released after disconnect`);
          
          // Notify base node again to ensure username is released
          if (baseSocket && baseSocket.connected) {
            baseSocket.emit('userLogout', { 
              username, 
              deviceId,
              relayId 
            });
            
            console.log(`Sent final logout for ${username} to ensure username is released`);
          }
        }
      }, 15000); // 15 seconds
    }
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