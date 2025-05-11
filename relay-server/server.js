import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { io as connectToBase } from 'socket.io-client';

const app = express();
app.get('/', (req, res) => {
  const baseNodeUrl = process.env.BASE_NODE_URL || 'http://localhost:5000';
  res.send(`<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Relay Server Live</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#181c20;color:#fff;font-family:sans-serif;flex-direction:column;}h1{font-size:4rem;letter-spacing:2px;}p{font-size:1.5rem;margin-top:2rem;}@media(max-width:600px){h1{font-size:2rem;}p{font-size:1rem;}}</style></head><body><h1>Relay Server is Live</h1><p>Base Node URL: <span style='color:#4ecdc4;'>${baseNodeUrl}</span></p></body></html>`);
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const BASE_NODE_URL = process.env.BASE_NODE_URL || 'http://localhost:5000';
const RELAY_IP = process.env.RELAY_IP || 'localhost';
const RELAY_PORT = process.env.PORT || 3001;

const baseSocket = connectToBase(BASE_NODE_URL, {
  auth: {
    ip: RELAY_IP,
    port: RELAY_PORT
  }
});

const userSockets = {}; // username -> socket
const socketUsers = {}; // socket.id -> username

io.on('connection', (socket) => {
  // Add to your existing socket.on('register') handler
  socket.on('register', ({ username, deviceId }, ack) => {
    baseSocket.emit('registerUser', { username, deviceId }, (response) => {
      if (!response.success) {
        if (ack) ack({ success: false, reason: response.reason });
        return;
      }
      userSockets[username] = socket;
      socketUsers[socket.id] = { username, deviceId }; // Store both username and deviceId
      if (ack) ack({ success: true });
    });
  });
  
  // Update your sendMessage handler
  socket.on('sendMessage', ({ to, message, deviceId }, ack) => {
    if (userSockets[to]) {
      const fromUser = socketUsers[socket.id];
      userSockets[to].emit('receiveMessage', {
        from: fromUser.username,
        message,
        fromDeviceId: deviceId || fromUser.deviceId
      });
      if (ack) ack({ delivered: true });
    } else {
      baseSocket.emit('routeMessage', {
        from: socketUsers[socket.id].username,
        to,
        message,
        deviceId: deviceId || socketUsers[socket.id].deviceId
      }, (response) => {
        if (ack) ack(response);
      });
    }
  });
  
  // Add typing indicator support
  socket.on('typing', ({ to }) => {
    if (userSockets[to]) {
      userSockets[to].emit('userTyping', { username: socketUsers[socket.id].username });
    }
  });
  socket.on('disconnect', () => {
    const username = socketUsers[socket.id];
    delete userSockets[username];
    delete socketUsers[socket.id];
  });
});

baseSocket.on('deliverMessage', ({ from, to, message }) => {
  if (userSockets[to]) {
    userSockets[to].emit('receiveMessage', { from, message });
  }
});

server.listen(RELAY_PORT, () => {
  console.log(`Relay server running on port ${RELAY_PORT}`);
});