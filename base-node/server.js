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

const userRegistry = {}; // username -> relayId
const relaySockets = {}; // relayId -> socket

io.on('connection', (socket) => {
  socket.on('registerRelay', ({ ip, port }, ack) => {
    const relayId = `${ip}:${port}`;
    relaySockets[relayId] = socket;
    if (ack) ack({ success: true });
  });

  socket.on('registerUser', ({ username }, ack) => {
    if (userRegistry[username]) {
      if (ack) ack({ success: false, reason: 'Username already taken' });
      return;
    }
    userRegistry[username] = socket.id;
    if (ack) ack({ success: true });
  });

  socket.on('routeMessage', ({ from, to, message }, ack) => {
    const relayId = userRegistry[to];
    if (!relayId) {
      if (ack) ack({ delivered: false, reason: 'User not found' });
      return;
    }
    const relaySocket = io.sockets.sockets.get(relayId);
    if (relaySocket) {
      relaySocket.emit('deliverMessage', { from, to, message });
      if (ack) ack({ delivered: true });
    } else {
      if (ack) ack({ delivered: false, reason: 'Relay not found' });
    }
  });

  socket.on('disconnect', () => {
    for (const username in userRegistry) {
      if (userRegistry[username] === socket.id) {
        delete userRegistry[username];
      }
    }
    for (const relayId in relaySockets) {
      if (relaySockets[relayId].id === socket.id) {
        delete relaySockets[relayId];
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Base node running on port ${PORT}`);
});