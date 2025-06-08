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
  baseSocket.on('deliverMessage', ({ from, to, message, fromDeviceId }) => {
    console.log(`Delivering message from base node: ${from} -> ${to}`);
    
    if (userSockets[to]) {
      userSockets[to].emit('receiveMessage', { 
        from, 
        message, 
        fromDeviceId 
      });
      console.log(`Message delivered to ${to}`);
    } else {
      console.log(`User ${to} not found on this relay`);
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
      port: RELAY_PORT 
    });
  }
}, 10000); // Every 10 seconds

// Handle client connections
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Handle user registration
  socket.on('register', ({ username, deviceId }, ack) => {
    console.log(`Registration request: ${username} with device ${deviceId}`);
    
    // Check if username is already taken locally
    const existingUser = Object.values(socketUsers).find(user => 
      user.username === username && user.deviceId !== deviceId
    );
    
    if (existingUser) {
      console.log(`Username ${username} already taken locally`);
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
          
          console.log(`User ${username} registered successfully`);
          if (ack) ack({ success: true });
        } else {
          console.log(`Base node rejected registration for ${username}:`, response?.reason);
          if (ack) ack({ 
            success: false, 
            reason: response?.reason || 'Registration failed' 
          });
        }
      });
    } else {
      // Base node not connected - register locally only
      console.log(`Base node not connected, registering ${username} locally`);
      userSockets[username] = socket;
      socketUsers[socket.id] = { 
        username, 
        deviceId,
        status: 'online'
      };
      
      if (ack) ack({ success: true, warning: 'Registered locally only - base node not available' });
    }
  });
  
  // Check if a recipient exists and is online
  socket.on('checkRecipient', ({ username }, ack) => {
    // First check locally
    if (userSockets[username]) {
      if (ack) ack({ exists: true, online: true, location: 'local' });
      return;
    }
    
    // Check with base node
    if (baseSocket && baseSocket.connected) {
      baseSocket.emit('checkUser', { username }, (response) => {
        if (ack) ack({ 
          exists: response?.exists || false, 
          online: response?.online || false,
          location: 'remote'
        });
      });
    } else {
      if (ack) ack({ exists: false, online: false, location: 'unknown' });
    }
  });
  
  // Handle message sending
  socket.on('sendMessage', ({ to, message, deviceId }, ack) => {
    const fromUser = socketUsers[socket.id];
    if (!fromUser) {
      console.log('Message from unregistered user');
      if (ack) ack({ delivered: false, reason: 'Not registered' });
      return;
    }
    
    console.log(`Message from ${fromUser.username} to ${to}: ${message}`);
    
    // Check if recipient is connected to this relay
    if (userSockets[to]) {
      // Local delivery
      userSockets[to].emit('receiveMessage', {
        from: fromUser.username,
        message,
        fromDeviceId: deviceId || fromUser.deviceId
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
          deviceId: deviceId || fromUser.deviceId
        }, (response) => {
          console.log(`Message routing result:`, response);
          if (ack) ack({ 
            delivered: response?.delivered || false, 
            reason: response?.reason,
            method: 'routed'
          });
        });
      } else {
        console.log('Cannot route message - base node not connected');
        if (ack) ack({ 
          delivered: false, 
          reason: 'Base node not available for routing' 
        });
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
  
  // Get relay information
  socket.on('getRelayInfo', (_, ack) => {
    if (ack) ack({ 
      url: `${RELAY_IP}:${RELAY_PORT}`,
      ip: RELAY_IP,
      port: RELAY_PORT,
      status: baseSocket?.connected ? 'connected' : 'disconnected',
      baseNodeUrl: BASE_NODE_URL,
      relayId: relayId
    });
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    const user = socketUsers[socket.id];
    if (user) {
      console.log(`User ${user.username} disconnected`);
      delete userSockets[user.username];
      delete socketUsers[socket.id];
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