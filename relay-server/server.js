import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { io as connectToBase } from 'socket.io-client';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const BASE_NODE_URL = process.env.BASE_NODE_URL || 'http://localhost:5000';
const RELAY_IP = process.env.RELAY_IP || 'localhost';
const RELAY_PORT = process.env.PORT || 3001;

const baseSocket = connectToBase(BASE_NODE_URL, {
    auth: {
        ip: RELAY_IP,
        port: RELAY_PORT
    }
});

const userSockets = {}; // username → socket
const socketUsers = {}; // socket.id → username

io.on('connection', (socket) => {
  socket.on('register', ({ username }, ack) => {
    // Ask base node for username uniqueness
    baseSocket.emit('registerUser', { username }, (response) => {
      if (!response.success) {
        if (ack) ack({ success: false, reason: response.reason });
        return;
      }
      userSockets[username] = socket;
      socketUsers[socket.id] = username;
      if (ack) ack({ success: true });
    });
  });

  socket.on('sendMessage', ({ to, message }, ack) => {
    if (userSockets[to]) {
      userSockets[to].emit('receiveMessage', {
        from: socketUsers[socket.id],
        message
      });
      if (ack) ack({ delivered: true });
    } else {
      baseSocket.emit('routeMessage', {
        from: socketUsers[socket.id],
        to,
        message
      }, (response) => {
        if (ack) ack(response);
      });
    }
  });

  socket.on('disconnect', () => {
    const username = socketUsers[socket.id];
    delete userSockets[username];
    delete socketUsers[socket.id];
    // Inform base node to release username
    // (Handled by base node on relay disconnect)
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