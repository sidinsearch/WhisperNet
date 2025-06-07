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

// Add message receiving endpoint
app.post('/message', express.json(), (req, res) => {
  const message = req.body;
  
  // Validate required fields
  if (!message || !message.to || !message.from || !message.content) {
    return res.status(400).json({ error: 'Invalid message format' });
  }
  
  // Route the message to recipient
  io.to(userRegistry[message.to]?.socketId).emit('message', message);
  
  res.status(200).json({ status: 'Message received' });
});

const server = http.createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: false
  } 
});

// Enhanced user registry with online status tracking and device fingerprinting
const userRegistry = {}; // username -> { relayId, deviceId, online, socketId, knownDevices: [] }
const relaySockets = {}; // relayId -> { socket, status, lastHeartbeat, socketId, ip, port }
const directClients = {}; // socketId -> { username, deviceId } for clients connecting directly to base

// Storage for offline messages
const offlineMessages = {}; // username -> [messages]

console.log('Base node initializing...');

// Helper function to clean up expired offline messages
const cleanupExpiredMessages = () => {
  const now = Date.now();
  for (const username in offlineMessages) {
    if (offlineMessages[username] && offlineMessages[username].length > 0) {
      const validMessages = offlineMessages[username].filter(msg => now < msg.ttl);
      if (validMessages.length !== offlineMessages[username].length) {
        console.log(`Cleaned up ${offlineMessages[username].length - validMessages.length} expired messages for ${username}`);
        offlineMessages[username] = validMessages;
      }
    }
  }
};

// Heartbeat interval to check relay server status and cleanup expired messages
const heartbeatInterval = setInterval(() => {
  const now = Date.now();
  
  // Check relay server status
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
    }
  }
  
  // Clean up expired messages
  cleanupExpiredMessages();
}, 15000); // Check every 15 seconds

io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);
  
  // Handle relay server registration
  socket.on('registerRelay', (data, ack) => {
    console.log('Relay registration attempt:', data);
    
    let relayId = `${data.ip}:${data.port}`;
    relaySockets[relayId] = { 
      socket, 
      status: 'online', 
      lastHeartbeat: Date.now(), 
      socketId: socket.id, 
      ip: data.ip, 
      port: data.port,
      capabilities: data.capabilities || { offlineRelay: false, encryption: false }
    };
    
    console.log(`Relay registered: ${relayId} with capabilities:`, relaySockets[relayId].capabilities);
    
    // Notify all clients about the new relay
    io.emit('relayStatusUpdate', { 
      relayId, 
      status: 'online', 
      ip: data.ip, 
      port: data.port,
      capabilities: relaySockets[relayId].capabilities
    });
    
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
  
  // Get available relay servers
  socket.on('getRelays', (_, ack) => {
    const availableRelays = Object.entries(relaySockets)
      .filter(([_, relay]) => relay.status === 'online')
      .map(([relayId, relay]) => ({ 
        relayId, 
        status: relay.status,
        ip: relay.ip,
        port: relay.port,
        capabilities: relay.capabilities || { offlineRelay: false, encryption: false }
      }));
    
    if (ack) ack(availableRelays);
  });
  
  // Helper function to send relay list to a specific socket
  const sendRelayListToSocket = (targetSocket) => {
    const relays = Object.entries(relaySockets)
      .filter(([_, relay]) => relay.status === 'online')
      .map(([relayId, relay]) => ({ 
        relayId, 
        status: relay.status,
        ip: relay.ip,
        port: relay.port,
        capabilities: relay.capabilities || { offlineRelay: false, encryption: false }
      }));
    
    targetSocket.emit('relayList', relays);
  };

  // Check if user exists with device fingerprinting
  socket.on('checkUser', ({ username }, ack) => {
    const exists = !!userRegistry[username];
    const online = exists && userRegistry[username].online;
    console.log(`User check: ${username} exists=${exists} online=${online}`);
    if (ack) ack({ exists, online });
  });
  
  // Handle checking if a username is available for registration
  socket.on('checkUsernameAvailable', ({ username }, ack) => {
    const exists = !!userRegistry[username];
    console.log(`Username availability check: ${username} available=${!exists}`);
    if (ack) ack({ available: !exists });
  });

  // Handle message delivery confirmation
  socket.on('confirmMessageDelivery', ({ messageId, to }, ack) => {
    // If there are offline messages for this user, remove the delivered message
    if (offlineMessages[to]) {
      const index = offlineMessages[to].findIndex(msg => msg.id === messageId);
      if (index !== -1) {
        offlineMessages[to].splice(index, 1);
        console.log(`Message ${messageId} confirmed delivered to ${to}`);
        if (ack) ack({ success: true });
      } else {
        if (ack) ack({ success: false, message: 'Message not found' });
      }
    } else {
      if (ack) ack({ success: false, message: 'No offline messages for user' });
    }
  });
  
  // Handle relay message bouncing
  socket.on('bounceMessage', (message, ack) => {
    // Increment bounce count
    message.bounceCount = (message.bounceCount || 0) + 1;
    
    // Check if message has expired or reached max bounces
    if (Date.now() > message.ttl || message.bounceCount > message.maxBounces) {
      console.log(`Message ${message.id} expired or reached max bounces`);
      if (ack) ack({ success: false, message: 'Message expired or reached max bounces' });
      return;
    }
    
    // Try to deliver the message
    if (userRegistry[message.to] && userRegistry[message.to].online) {
      // User is online, deliver the message
      this.emit('sendMessage', {
        to: message.to,
        message: message.content,
        deviceId: message.fromDeviceId,
        id: message.id,
        encrypted: message.encrypted,
        encryptedContent: message.encryptedContent,
        iv: message.iv,
        ttl: message.ttl
      }, (response) => {
        if (ack) ack(response);
      });
    } else {
      // Store for offline delivery
      if (!offlineMessages[message.to]) {
        offlineMessages[message.to] = [];
      }
      offlineMessages[message.to].push(message);
      console.log(`Bounced message stored for offline delivery to ${message.to}`);
      if (ack) ack({ success: true, message: 'Message stored for offline delivery' });
    }
  });

  // Clean up offline users after a certain period of inactivity
const cleanupOfflineUsers = () => {
  const now = Date.now();
  const OFFLINE_TIMEOUT = 3600000; // 1 hour in milliseconds
  
  Object.keys(userRegistry).forEach(username => {
    if (!userRegistry[username].online && userRegistry[username].lastSeen) {
      const timeSinceLastSeen = now - userRegistry[username].lastSeen;
      if (timeSinceLastSeen > OFFLINE_TIMEOUT) {
        console.log(`Cleaning up inactive user: ${username}`);
        delete userRegistry[username];
      }
    }
  });
};

// Run cleanup every hour
setInterval(cleanupOfflineUsers, 3600000);

// Handle user registration (can be from relay or direct client)
  socket.on('registerUser', ({ username, deviceId, publicKey }, ack) => {
    console.log(`User registration: ${username} with device ${deviceId}`);
    
    // Check if username is already registered and online
    if (userRegistry[username] && userRegistry[username].online) {
      // If it's the same device, allow reconnection
      if (userRegistry[username].deviceId === deviceId) {
        console.log(`User ${username} reconnecting with same device`);
      } else {
        console.log(`Username ${username} is already in use by a different device`);
        if (ack) ack({ success: false, message: 'Username is already in use by a different device' });
        return;
      }
    }
    
    // Check if this is a known device for this username
    const isNewDevice = !userRegistry[username] || 
                       !userRegistry[username].knownDevices || 
                       !userRegistry[username].knownDevices.includes(deviceId);
    
    // Register or update the user
    if (!userRegistry[username]) {
      userRegistry[username] = { 
        relayId: 'direct', 
        deviceId, 
        online: true, 
        socketId: socket.id,
        knownDevices: [deviceId],
        publicKey
      };
    } else {
      // Update existing user
      userRegistry[username].relayId = 'direct';
      userRegistry[username].deviceId = deviceId;
      userRegistry[username].online = true;
      userRegistry[username].socketId = socket.id;
      userRegistry[username].publicKey = publicKey || userRegistry[username].publicKey;
      
      // Add to known devices if new
      if (isNewDevice && userRegistry[username].knownDevices) {
        userRegistry[username].knownDevices.push(deviceId);
      } else if (isNewDevice) {
        userRegistry[username].knownDevices = [deviceId];
      }
    }
    
    directClients[socket.id] = { username, deviceId };
    
    console.log(`User ${username} registered successfully`);
    
    // Send available relays to the client
    const availableRelays = Object.entries(relaySockets)
      .filter(([_, relay]) => relay.status === 'online')
      .map(([relayId, relay]) => ({ 
        relayId, 
        status: relay.status,
        ip: relay.ip,
        port: relay.port
      }));
    
    // Check if there are any offline messages for this user
    const pendingMessages = offlineMessages[username] || [];
    
    if (ack) ack({ 
      success: true, 
      message: 'Registration successful',
      relays: availableRelays,
      isNewDevice: isNewDevice,
      pendingMessages: pendingMessages.length > 0 ? pendingMessages : null
    });
    
    // If there are pending messages, deliver them
    if (pendingMessages.length > 0) {
      console.log(`Delivering ${pendingMessages.length} offline messages to ${username}`);
      
      // Deliver each message
      pendingMessages.forEach(msg => {
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
      
      // Clear the offline messages for this user
      delete offlineMessages[username];
    }
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
    console.log(`Direct message request from socket ${socket.id} to ${to}`);
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
    
    // Handle user disconnect
    if (directClients[socket.id]) {
      const { username } = directClients[socket.id];
      console.log(`User ${username} disconnected`);
      
      if (userRegistry[username]) {
        userRegistry[username].online = false;
        userRegistry[username].lastSeen = Date.now(); // Track when user went offline
        console.log(`User ${username} marked as offline`);
      }
      
      // Notify other users about status change
      io.emit('userStatus', { username, status: 'offline' });
      
      // Remove from direct clients
      delete directClients[socket.id];
    }
    
    // Handle relay disconnect
    for (const relayId in relaySockets) {
      if (relaySockets[relayId].socketId === socket.id) {
        console.log(`Relay ${relayId} disconnected`);
        relaySockets[relayId].status = 'offline';
        relaySockets[relayId].lastSeen = Date.now();
        
        // Mark users on this relay as offline
        for (const username in userRegistry) {
          if (userRegistry[username].relayId === relayId) {
            userRegistry[username].online = false;
            userRegistry[username].lastSeen = Date.now();
            console.log(`User ${username} marked as offline`);
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