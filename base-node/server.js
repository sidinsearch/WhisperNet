import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name using ES modules approach
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Fallback route to serve index.html for any GET request
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: false
  } 
});

// Enhanced user registry with online status tracking
const userRegistry = {}; // username -> { relayId, deviceId, online, socketId }
const relaySockets = {}; // relayId -> { socket, status, lastHeartbeat, socketId }
const directClients = {}; // socketId -> { username, deviceId } for clients connecting directly to base

console.log('Base node initializing...');

// Heartbeat interval to check relay server status
const heartbeatInterval = setInterval(() => {
  const now = Date.now();
  for (const relayId in relaySockets) {
    const relay = relaySockets[relayId];
    if (now - relay.lastHeartbeat > 35000) { // 35 seconds timeout
      console.log(`Relay ${relayId} went offline (timeout)`);
      relay.status = 'offline';
      
      // Mark users on this relay as offline
      for (const username in userRegistry) {
        if (userRegistry[username].relayId === relayId) {
          userRegistry[username].online = false;
        }
      }
      
      // Notify all clients about relay status change
      io.emit('relayStatusUpdate', { relayId, status: 'offline' });
    }
  }
}, 15000); // Check every 15 seconds

io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  // Handle relay server registration
  socket.on('registerRelay', (data, ack) => {
    console.log('Relay registration attempt:', data);
    
    let relayId;
    if (data && data.ip && data.port) {
      relayId = `${data.ip}:${data.port}`;
    } else {
      // Fallback: use socket ID if no IP/port provided
      relayId = `relay-${socket.id}`;
    }
    
    relaySockets[relayId] = { 
      socket, 
      socketId: socket.id,
      status: 'online',
      lastHeartbeat: Date.now(),
      ip: data?.ip || 'unknown',
      port: data?.port || 'unknown'
    };
    
    console.log(`Relay registered: ${relayId}`);
    
    // Notify all clients about new relay
    io.emit('relayStatusUpdate', { relayId, status: 'online' });
    
    if (ack) ack({ success: true, relayId });
  });

  // Relay heartbeat handler
  socket.on('relayHeartbeat', (data, ack) => {
    let relayId = data?.relayId;
    
    // If no relayId provided, find it by socket ID
    if (!relayId) {
      for (const id in relaySockets) {
        if (relaySockets[id].socketId === socket.id) {
          relayId = id;
          break;
        }
      }
    }
    
    if (relayId && relaySockets[relayId]) {
      relaySockets[relayId].lastHeartbeat = Date.now();
      relaySockets[relayId].status = 'online';
    }
    
    if (ack) ack({ success: true, relayId });
  });

  // Check if user exists
  socket.on('checkUser', ({ username }, ack) => {
    const user = userRegistry[username];
    const response = { 
      exists: !!user, 
      online: user?.online || false 
    };
    console.log(`User check for ${username}:`, response);
    if (ack) ack(response);
  });

  // Handle user registration (can be from relay or direct client)
  socket.on('registerUser', ({ username, deviceId, relayId }, ack) => {
    console.log(`User registration: ${username}, deviceId: ${deviceId}, relayId: ${relayId}`);
    
    // Check if username is already taken by a different device
    if (userRegistry[username] && 
        userRegistry[username].deviceId !== deviceId && 
        userRegistry[username].online) {
      console.log(`Username ${username} already taken by different device`);
      if (ack) ack({ success: false, reason: 'Username already taken by another device' });
      return;
    }
    
    // Determine relay ID - could be from a relay server or direct connection
    const finalRelayId = relayId || `direct-${socket.id}`;
    
    userRegistry[username] = { 
      relayId: finalRelayId,
      deviceId, 
      online: true,
      socketId: socket.id
    };
    
    // If it's a direct connection, track it
    if (!relayId) {
      directClients[socket.id] = { username, deviceId };
    }
    
    console.log(`User ${username} registered successfully`);
    if (ack) ack({ success: true });
  });
  
  // Handle message routing
  socket.on('routeMessage', ({ from, to, message, deviceId }, ack) => {
    console.log(`Routing message from ${from} to ${to}`);
    
    const targetUser = userRegistry[to];
    if (!targetUser) {
      console.log(`Target user ${to} not found`);
      if (ack) ack({ delivered: false, reason: 'User not found' });
      return;
    }
    
    if (!targetUser.online) {
      console.log(`Target user ${to} is offline`);
      if (ack) ack({ delivered: false, reason: 'User is offline' });
      return;
    }
    
    // Check if target is on a relay server
    if (targetUser.relayId.startsWith('direct-')) {
      // Direct connection to base node
      const targetSocket = io.sockets.sockets.get(targetUser.socketId);
      if (targetSocket) {
        targetSocket.emit('receiveMessage', { from, message, fromDeviceId: deviceId });
        console.log(`Message delivered directly to ${to}`);
        if (ack) ack({ delivered: true });
      } else {
        if (ack) ack({ delivered: false, reason: 'Target socket not found' });
      }
    } else {
      // Target is on a relay server
      const relay = relaySockets[targetUser.relayId];
      if (relay && relay.socket) {
        relay.socket.emit('deliverMessage', { from, to, message, fromDeviceId: deviceId });
        console.log(`Message routed through relay ${targetUser.relayId} to ${to}`);
        if (ack) ack({ delivered: true });
      } else {
        console.log(`Relay ${targetUser.relayId} not found or offline`);
        if (ack) ack({ delivered: false, reason: 'Relay not available' });
      }
    }
  });

  // Handle direct client messaging (when base node acts as relay)
  socket.on('sendMessage', ({ to, message, deviceId }, ack) => {
    const fromUser = directClients[socket.id];
    if (!fromUser) {
      if (ack) ack({ delivered: false, reason: 'Not registered' });
      return;
    }

    console.log(`Direct message from ${fromUser.username} to ${to}`);
    
    // Route the message
    socket.emit('routeMessage', {
      from: fromUser.username,
      to,
      message,
      deviceId: deviceId || fromUser.deviceId
    }, ack);
  });

  // Handle getting available relays
  socket.on('getAvailableRelays', (_, ack) => {
    const availableRelays = [];
    for (const relayId in relaySockets) {
      const relay = relaySockets[relayId];
      if (relay.status === 'online') {
        availableRelays.push({
          id: relayId,
          ip: relay.ip,
          port: relay.port,
          status: relay.status
        });
      }
    }
    
    console.log(`Available relays: ${availableRelays.length}`);
    if (ack) ack({ relays: availableRelays });
  });

  socket.on('disconnect', () => {
    console.log(`Connection ${socket.id} disconnected`);
    
    // Clean up user registry
    for (const username in userRegistry) {
      if (userRegistry[username].socketId === socket.id) {
        userRegistry[username].online = false;
        console.log(`User ${username} marked as offline`);
      }
    }
    
    // Clean up direct clients
    if (directClients[socket.id]) {
      delete directClients[socket.id];
    }
    
    // Clean up relay sockets
    for (const relayId in relaySockets) {
      if (relaySockets[relayId].socketId === socket.id) {
        console.log(`Relay ${relayId} disconnected`);
        delete relaySockets[relayId];
        
        // Mark users on this relay as offline
        for (const username in userRegistry) {
          if (userRegistry[username].relayId === relayId) {
            userRegistry[username].online = false;
          }
        }
        
        // Notify clients about relay disconnection
        io.emit('relayStatusUpdate', { relayId, status: 'offline' });
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Base node running on port ${PORT}`);
  console.log(`Base node URL: http://localhost:${PORT}`);
});