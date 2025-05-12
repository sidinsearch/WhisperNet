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
const io = new Server(server, { cors: { origin: '*' } });

// Enhanced user registry with online status tracking
const userRegistry = {}; // username -> { relayId, deviceId, online }
const relaySockets = {}; // relayId -> { socket, status, lastHeartbeat }

// Heartbeat interval to check relay server status
setInterval(() => {
  const now = Date.now();
  for (const relayId in relaySockets) {
    const relay = relaySockets[relayId];
    if (now - relay.lastHeartbeat > 30000) { // 30 seconds timeout
      relay.status = 'offline';
      // Notify connected clients about relay status change
      io.emit('relayStatusUpdate', { relayId, status: 'offline' });
    }
  }
}, 15000); // Check every 15 seconds

io.on('connection', (socket) => {
  socket.on('registerRelay', ({ ip, port }, ack) => {
    const relayId = `${ip}:${port}`;
    relaySockets[relayId] = { 
      socket, 
      status: 'online',
      lastHeartbeat: Date.now() 
    };
    
    // Notify connected clients about new relay
    io.emit('relayStatusUpdate', { relayId, status: 'online' });
    
    if (ack) ack({ success: true });
  });

  // Relay heartbeat handler
  socket.on('relayHeartbeat', ({ ip, port }, ack) => {
    const relayId = `${ip}:${port}`;
    if (relaySockets[relayId]) {
      relaySockets[relayId].lastHeartbeat = Date.now();
      relaySockets[relayId].status = 'online';
    }
    if (ack) ack({ success: true });
  });

  // Check if user exists
  socket.on('checkUser', ({ username }, ack) => {
    const user = userRegistry[username];
    if (ack) ack({ exists: !!user, online: user?.online || false });
  });

  // Update your registerUser handler
  socket.on('registerUser', ({ username, deviceId }, ack) => {
    if (userRegistry[username] && userRegistry[username].deviceId !== deviceId) {
      if (ack) ack({ success: false, reason: 'Username already taken by another device' });
      return;
    }
    userRegistry[username] = { relayId: socket.id, deviceId, online: true };
    if (ack) ack({ success: true });
  });
  
  // Update your routeMessage handler
  socket.on('routeMessage', ({ from, to, message, deviceId }, ack) => {
    const relayInfo = userRegistry[to];
    if (!relayInfo) {
      if (ack) ack({ delivered: false, reason: 'User not found' });
      return;
    }
    
    if (!relayInfo.online) {
      if (ack) ack({ delivered: false, reason: 'User is offline' });
      return;
    }
    
    const relaySocket = io.sockets.sockets.get(relayInfo.relayId);
    if (relaySocket) {
      relaySocket.emit('deliverMessage', { from, to, message, fromDeviceId: deviceId });
      if (ack) ack({ delivered: true });
    } else {
      if (ack) ack({ delivered: false, reason: 'Relay not found' });
    }
  });

  socket.on('disconnect', () => {
    // Clean up userRegistry when a socket disconnects
    for (const username in userRegistry) {
      if (userRegistry[username].relayId === socket.id) {
        userRegistry[username].online = false;
        // Don't delete the user, just mark as offline
        // This allows for device verification when they reconnect
      }
    }
    
    // Clean up relaySockets when a socket disconnects
    for (const relayId in relaySockets) {
      if (relaySockets[relayId].socket.id === socket.id) {
        delete relaySockets[relayId];
        // Notify connected clients about relay disconnection
        io.emit('relayStatusUpdate', { relayId, status: 'offline' });
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Base node running on port ${PORT}`);
});