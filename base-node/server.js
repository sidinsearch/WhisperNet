import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const userToRelayMap = {}; // username -> relaySocketId
const relaySockets = {};   // relaySocketId -> { ip, port }
const activeUsernames = new Set();

app.get('/relay', (req, res) => {
    const relayIds = Object.keys(relaySockets);
    if (relayIds.length > 0) {
        const randomRelayId = relayIds[Math.floor(Math.random() * relayIds.length)];
        const relaySocket = relaySockets[randomRelayId];
        return res.json({ success: true, relay: relaySocket });
    } else {
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
    // Register relay server
    relaySockets[socket.id] = {
        ip: socket.handshake.auth.ip,
        port: socket.handshake.auth.port
    };

    // Relay registers a user
    socket.on('registerUser', ({ username }, ack) => {
        if (activeUsernames.has(username)) {
            if (ack) ack({ success: false, reason: 'Username taken' });
            return;
        }
        userToRelayMap[username] = socket.id;
        activeUsernames.add(username);
        if (ack) ack({ success: true });
    });

    // Relay asks to route a message
    socket.on('routeMessage', ({ from, to, message }, ack) => {
        const targetRelayId = userToRelayMap[to];
        const targetRelaySocket = io.sockets.sockets.get(targetRelayId);
        if (targetRelaySocket) {
            targetRelaySocket.emit('deliverMessage', { from, to, message });
            if (ack) ack({ delivered: true });
        } else {
            // Recipient offline
            if (ack) ack({ delivered: false, reason: 'Recipient offline' });
        }
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
        for (const [username, relayId] of Object.entries(userToRelayMap)) {
            if (relayId === socket.id) {
                delete userToRelayMap[username];
                activeUsernames.delete(username);
            }
        }
        delete relaySockets[socket.id];
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Base node listening on port ${PORT}`);
});