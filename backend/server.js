// base-node.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const userToRelayMap = {}; // { username: socketId }
const relaySockets = {};   // { socketId: socket }

// Add to base-node.js
app.get('/relay', (req, res) => {
    const relayIds = Object.keys(relaySockets);
    console.log(relayIds);

    if (relayIds.length > 0) {
        const randomRelayId = relayIds[Math.floor(Math.random() * relayIds.length)];
        console.log(randomRelayId);

        const relaySocket = relaySockets[randomRelayId];
        console.log(relaySocket);

        return res.json({ success: true, relay: relaySocket });
    } else {
        // No relay available, use base node as fallback
        return res.json({
            success: false,
            fallback: {
                ip: "localhost",
                port: 5000
            }
        });
    }
});


io.on('connection', (socket) => {
    console.log('Relay connected:', socket.id);
    relaySockets[socket.id] = {
        ip: socket.handshake.auth.ip,
        port: socket.handshake.auth.port
    };

    // Relay registers a user
    socket.on('registerUser', ({ username }) => {
        userToRelayMap[username] = socket.id;
        console.log(`User ${username} registered via relay ${socket.id}`);
    });

    // Relay asks to route a message to another user
    socket.on('routeMessage', ({ from, to, message }) => {
        const targetRelayId = userToRelayMap[to];
        const targetRelaySocket = relaySockets[targetRelayId];

        if (targetRelaySocket) {
            targetRelaySocket.emit('deliverMessage', { from, to, message });
            console.log(`Routing message from ${from} to ${to} via relay ${targetRelayId}`);
        } else {
            console.log(`User ${to} not found on any relay`);
        }
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
        console.log('Relay disconnected:', socket.id);
        for (const [username, relayId] of Object.entries(userToRelayMap)) {
            if (relayId === socket.id) {
                delete userToRelayMap[username];
            }
        }
        delete relaySockets[socket.id];
    });
});

const PORT = 5000;
server.listen(PORT, () => {
    console.log(`Base node listening on port ${PORT}`);
});
