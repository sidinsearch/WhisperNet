// relay-server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { io as connectToBase } from 'socket.io-client';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Connect to base node
const baseSocket = connectToBase('http://localhost:5000', {
    auth: {
        ip: 'localhost',
        port: 3001
    }
}); // change to real IP in prod

const userSockets = {}; // username → socket
const socketUsers = {}; // socket.id → username

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register', ({ username }) => {
    userSockets[username] = socket;
    socketUsers[socket.id] = username;

    // Inform base node
    baseSocket.emit('registerUser', { username });
    console.log(`User ${username} registered locally`);
  });

  socket.on('sendMessage', ({ to, message }) => {
    if (userSockets[to]) {
      // Local user
      userSockets[to].emit('receiveMessage', {
        from: socketUsers[socket.id],
        message
      });
    } else {
      // Not local, ask base to route
      baseSocket.emit('routeMessage', {
        from: socketUsers[socket.id],
        to,
        message
      });
    }
  });

  socket.on('disconnect', () => {
    const username = socketUsers[socket.id];
    delete userSockets[username];
    delete socketUsers[socket.id];
    console.log(`User ${username} disconnected`);
  });
});

// Handle messages routed from base
baseSocket.on('deliverMessage', ({ from, to, message }) => {
  if (userSockets[to]) {
    userSockets[to].emit('receiveMessage', { from, message });
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Relay server running on port ${PORT}`);
});
