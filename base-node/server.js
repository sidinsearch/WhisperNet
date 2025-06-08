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

  // Handle user disconnection from relay
  socket.on('userDisconnected', ({ username, deviceId, relayId }) => {
    console.log(`User ${username} disconnected from relay ${relayId}`);
    
    if (userRegistry[username]) {
      // Check if this is the same device ID
      if (userRegistry[username].deviceId === deviceId) {
        console.log(`Marking user ${username} as offline`);
        userRegistry[username].online = false;
        
        // Set a timeout to completely remove the user if they don't reconnect
        setTimeout(() => {
          if (userRegistry[username] && !userRegistry[username].online) {
            console.log(`Removing inactive user ${username} from registry`);
            delete userRegistry[username];
          }
        }, 300000); // 5 minutes
        
        // Notify other users about the status change
        io.emit('userStatusUpdate', { username, online: false });
      } else {
        console.log(`Ignoring disconnect for ${username} - different device ID`);
      }
    }
  });
  
  // Handle explicit user logout
  socket.on('userLogout', ({ username, deviceId, relayId }) => {
    console.log(`User ${username} explicitly logged out from ${relayId || 'direct connection'}`);
    
    if (userRegistry[username]) {
      // Check if this is the same device ID
      if (userRegistry[username].deviceId === deviceId) {
        console.log(`Removing user ${username} from registry due to explicit logout`);
        delete userRegistry[username];
        
        // If this was a direct client, remove from direct clients
        if (directClients[socket.id] && directClients[socket.id].username === username) {
          delete directClients[socket.id];
        }
        
        // Notify other users about the status change
        io.emit('userStatusUpdate', { username, online: false });
        
        // Immediately notify that this username is available
        io.emit('usernameReleased', { username });
        
        console.log(`Username ${username} has been released and is now available`);
      } else {
        console.log(`Ignoring logout for ${username} - different device ID`);
      }
    }
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
      // Update relay information
      relaySockets[relayId].lastHeartbeat = Date.now();
      relaySockets[relayId].status = data?.status || 'online';
      
      // Update additional information if provided
      if (data.connectedUsers !== undefined) {
        relaySockets[relayId].connectedUsers = data.connectedUsers;
      }
      
      if (data.pendingMessageCount !== undefined) {
        relaySockets[relayId].pendingMessageCount = data.pendingMessageCount;
      }
      
      if (data.ip) {
        relaySockets[relayId].ip = data.ip;
      }
      
      if (data.port) {
        relaySockets[relayId].port = data.port;
      }
      
      console.log(`Heartbeat from relay ${relayId} with ${relaySockets[relayId].connectedUsers || 0} users`);
    } else if (data?.ip && data?.port) {
      // This might be a relay we don't know about yet, try to register it
      const newRelayId = `${data.ip}:${data.port}`;
      console.log(`Received heartbeat from unknown relay, registering as ${newRelayId}`);
      
      relaySockets[newRelayId] = {
        socketId: socket.id,
        ip: data.ip,
        port: data.port,
        status: data?.status || 'online',
        lastHeartbeat: Date.now(),
        connectedUsers: data.connectedUsers || 0,
        pendingMessageCount: data.pendingMessageCount || 0
      };
      
      relayId = newRelayId;
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
  socket.on('routeMessage', ({ from, to, message, deviceId, encrypted = false, publicKey = null, timestamp = null }, ack) => {
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
        targetSocket.emit('receiveMessage', { 
          from, 
          message, 
          fromDeviceId: deviceId,
          timestamp: timestamp || new Date().toISOString(),
          encrypted,
          publicKey
        });
        console.log(`Message delivered directly to ${to}`);
        if (ack) ack({ delivered: true });
      } else {
        if (ack) ack({ delivered: false, reason: 'Target socket not found' });
      }
    } else {
      // Target is on a relay server
      const relay = relaySockets[targetUser.relayId];
      if (relay && relay.socket) {
        relay.socket.emit('deliverMessage', { 
          from, 
          to, 
          message, 
          fromDeviceId: deviceId,
          timestamp: timestamp || new Date().toISOString(),
          encrypted,
          publicKey
        });
        console.log(`Message routed through relay ${targetUser.relayId} to ${to}`);
        if (ack) ack({ delivered: true });
      } else {
        console.log(`Relay ${targetUser.relayId} not found or offline`);
        if (ack) ack({ delivered: false, reason: 'Relay not available' });
      }
    }
  });

  // Handle direct client messaging (when base node acts as relay)
  socket.on('sendMessage', ({ to, message, deviceId, encrypted, publicKey, bounce }, ack) => {
    const fromUser = directClients[socket.id];
    if (!fromUser) {
      if (ack) ack({ delivered: false, reason: 'Not registered' });
      return;
    }

    console.log(`Direct message from ${fromUser.username} to ${to}`);
    
    // Route the message using the routeMessage logic
    const from = fromUser.username;
    
    const targetUser = userRegistry[to];
    if (!targetUser) {
      console.log(`Target user ${to} not found`);
      
      // If bounce is requested, store for potential future delivery
      if (bounce) {
        // Store the message for potential future delivery
        // This allows messages to be delivered to users who register later
        console.log(`Message from ${from} to ${to} will be stored for potential future delivery`);
        
        // In a production implementation, you would store this in a database
        // For now, we'll just acknowledge it as bounced
        if (ack) ack({ 
          delivered: false, 
          bounced: true,
          expiresAt: Date.now() + 14400000, // 4 hours
          reason: 'User not found, message will be delivered if they register' 
        });
      } else {
        if (ack) ack({ delivered: false, reason: 'User not found' });
      }
      return;
    }
    
    if (!targetUser.online) {
      console.log(`Target user ${to} is offline`);
      
      // If bounce is requested, store for later delivery
      if (bounce) {
        // In a real implementation, you would store this message for later delivery
        console.log(`Message from ${from} to ${to} will be bounced for later delivery`);
        if (ack) ack({ 
          delivered: false, 
          bounced: true,
          expiresAt: Date.now() + 14400000, // 4 hours
          reason: 'User is offline, message will be delivered when they come online' 
        });
      } else {
        if (ack) ack({ delivered: false, reason: 'User is offline' });
      }
      return;
    }
    
    // Check if target is on a relay server
    if (targetUser.relayId.startsWith('direct-')) {
      // Direct connection to base node
      const targetSocket = io.sockets.sockets.get(targetUser.socketId);
      if (targetSocket) {
        targetSocket.emit('receiveMessage', { 
          from, 
          message, 
          fromDeviceId: deviceId || fromUser.deviceId,
          timestamp: new Date().toISOString(),
          encrypted,
          publicKey
        });
        console.log(`Message delivered directly to ${to}`);
        if (ack) ack({ delivered: true });
      } else {
        if (ack) ack({ delivered: false, reason: 'Target socket not found' });
      }
    } else {
      // Target is on a relay server
      const relay = relaySockets[targetUser.relayId];
      if (relay && relay.socket) {
        relay.socket.emit('deliverMessage', { 
          from, 
          to, 
          message, 
          fromDeviceId: deviceId || fromUser.deviceId,
          timestamp: new Date().toISOString(),
          encrypted,
          publicKey
        });
        console.log(`Message routed through relay ${targetUser.relayId} to ${to}`);
        if (ack) ack({ delivered: true });
      } else {
        console.log(`Relay ${targetUser.relayId} not found or offline`);
        if (ack) ack({ delivered: false, reason: 'Relay not available' });
      }
    }
  });
  
  // Get relay info for a specific user
  socket.on('getMyRelayInfo', ({ username }, ack) => {
    if (!username || !userRegistry[username]) {
      if (ack) ack({ success: false, reason: 'User not found' });
      return;
    }
    
    const user = userRegistry[username];
    const relayId = user.relayId;
    const isDirect = relayId.startsWith('direct-');
    
    // If this is a direct connection, get the socket ID
    let socketId = null;
    if (isDirect) {
      socketId = user.socketId;
    }
    
    // Get relay details if this is a relay connection
    let relayDetails = null;
    if (!isDirect && relaySockets[relayId]) {
      relayDetails = {
        ip: relaySockets[relayId].ip,
        port: relaySockets[relayId].port,
        status: relaySockets[relayId].status,
        lastHeartbeat: relaySockets[relayId].lastHeartbeat
      };
    }
    
    if (ack) ack({ 
      success: true, 
      relayId,
      isDirect,
      socketId,
      relayDetails
    });
  });
  
  // Get information about the base node and connected relays
  socket.on('getBaseNodeInfo', (_, ack) => {
    const relayCount = Object.keys(relaySockets).length;
    const userCount = Object.keys(userRegistry).length;
    const directClientCount = Object.keys(directClients).length;
    
    const activeRelays = Object.entries(relaySockets)
      .filter(([_, relay]) => relay.status === 'online')
      .map(([id, relay]) => ({
        id,
        ip: relay.ip,
        port: relay.port,
        connectedUsers: relay.connectedUsers || 0,
        lastHeartbeat: relay.lastHeartbeat
      }));
    
    if (ack) ack({
      success: true,
      relayCount,
      userCount,
      directClientCount,
      activeRelays
    });
  });
  
  // Handle public key requests
  socket.on('requestPublicKey', ({ from, username }, ack) => {
    console.log(`Public key request from ${from} for ${username}`);
    
    const targetUser = userRegistry[username];
    if (!targetUser) {
      console.log(`Target user ${username} not found`);
      if (ack) ack({ success: false, reason: 'User not found' });
      return;
    }
    
    if (!targetUser.online) {
      console.log(`Target user ${username} is offline`);
      if (ack) ack({ success: false, reason: 'User is offline' });
      return;
    }
    
    // Check if target is on a relay server
    if (targetUser.relayId.startsWith('direct-')) {
      // Direct connection to base node
      const targetSocket = io.sockets.sockets.get(targetUser.socketId);
      if (targetSocket) {
        targetSocket.emit('publicKeyRequest', { from }, (response) => {
          if (response && response.publicKey) {
            console.log(`Received public key for ${username}, forwarding to ${from}`);
            if (ack) ack({ success: true, publicKey: response.publicKey });
          } else {
            console.log(`No public key available for ${username}`);
            if (ack) ack({ success: false, reason: 'Public key not available' });
          }
        });
      } else {
        if (ack) ack({ success: false, reason: 'Target socket not found' });
      }
    } else {
      // Target is on a relay server
      const relay = relaySockets[targetUser.relayId];
      if (relay && relay.socket) {
        relay.socket.emit('requestPublicKey', { from, username }, (response) => {
          if (response && response.publicKey) {
            console.log(`Received public key for ${username} from relay, forwarding to ${from}`);
            if (ack) ack({ success: true, publicKey: response.publicKey });
          } else {
            console.log(`No public key available for ${username} from relay`);
            if (ack) ack({ success: false, reason: response?.reason || 'Public key not available' });
          }
        });
      } else {
        console.log(`Relay ${targetUser.relayId} not found or offline`);
        if (ack) ack({ success: false, reason: 'Relay not available' });
      }
    }
  });
  
  // Handle user disconnection
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    
    // Check if this was a direct client
    if (directClients[socket.id]) {
      const { username, deviceId } = directClients[socket.id];
      console.log(`Direct client disconnected: ${username} (${deviceId})`);
      
      // Remove from direct clients
      delete directClients[socket.id];
      
      // Update user registry
      if (userRegistry[username] && userRegistry[username].socketId === socket.id) {
        console.log(`Marking user ${username} as offline`);
        userRegistry[username].online = false;
        
        // Set a timeout to completely remove the user if they don't reconnect
        setTimeout(() => {
          if (userRegistry[username] && !userRegistry[username].online) {
            console.log(`Removing inactive user ${username} from registry`);
            delete userRegistry[username];
            
            // Notify other users that this username is now available
            io.emit('usernameReleased', { username });
          }
        }, 30000); // 30 seconds - reduced from 5 minutes to make usernames available sooner
        
        // Notify other users about the status change
        io.emit('userStatusUpdate', { username, online: false });
      }
    }
    
    // Check if this was a relay server
    for (const relayId in relaySockets) {
      if (relaySockets[relayId].socketId === socket.id) {
        console.log(`Relay server disconnected: ${relayId}`);
        
        // Mark relay as offline
        relaySockets[relayId].status = 'offline';
        relaySockets[relayId].socket = null;
        
        // Mark all users on this relay as offline and schedule them for removal
        for (const username in userRegistry) {
          if (userRegistry[username].relayId === relayId) {
            userRegistry[username].online = false;
            
            // Notify other users about the status change
            io.emit('userStatusUpdate', { username, online: false });
            
            // Schedule username for release
            setTimeout(() => {
              if (userRegistry[username] && !userRegistry[username].online) {
                console.log(`Removing inactive user ${username} from registry after relay disconnect`);
                delete userRegistry[username];
                
                // Notify other users that this username is now available
                io.emit('usernameReleased', { username });
              }
            }, 30000); // 30 seconds
          }
        }
        
        // Set a timeout to remove the relay if it doesn't reconnect
        setTimeout(() => {
          if (relaySockets[relayId] && relaySockets[relayId].status === 'offline') {
            console.log(`Removing inactive relay ${relayId}`);
            delete relaySockets[relayId];
          }
        }, 60000); // 1 minute - reduced from 10 minutes
        
        break;
      }
    }
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
  
  // Get online users
  socket.on('getOnlineUsers', (_, ack) => {
    const onlineUsers = Object.entries(userRegistry)
      .filter(([_, user]) => user.online)
      .map(([username, _]) => username);
    
    console.log('Online users:', onlineUsers);
    if (ack) ack(onlineUsers);
    
    // Also broadcast the current online users to all connected clients
    // This helps keep everyone's online user list in sync
    io.emit('onlineUsersUpdate', { users: onlineUsers });
  });

  // Note: We've removed the duplicate disconnect handler to avoid confusion
  // The primary disconnect handler above handles all disconnect scenarios
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Base node running on port ${PORT}`);
  console.log(`Base node URL: http://localhost:${PORT}`);
});