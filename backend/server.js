import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 3000 });

const peers = new Map(); // Stores connected peers

wss.on("connection", (ws) => {
    ws.on("message", (data) => {
        try {
            const message = JSON.parse(data);

            switch (message.type) {
                case "register":
                    ws.peerId = message.peerId; // ✅ Ensure Peer ID is stored on WebSocket
                    peers.set(ws.peerId, ws);
                    console.log(`✅ Peer registered: ${ws.peerId}`);

                    // Send peer list to newly connected peer
                    ws.send(JSON.stringify({
                        type: "peer-list",
                        peers: Array.from(peers.keys()).filter(id => id !== ws.peerId),
                    }));
                    break;

                case "offer":
                    if (peers.has(message.to)) {
                        peers.get(message.to).send(JSON.stringify({
                            type: "offer",
                            from: ws.peerId, // ✅ Ensure 'from' field is sent correctly
                            offer: message.offer
                        }));
                    }
                    break;

                case "answer":
                    if (peers.has(message.to)) {
                        peers.get(message.to).send(JSON.stringify({
                            type: "answer",
                            from: ws.peerId,
                            answer: message.answer
                        }));
                    }
                    break;

                case "ice-candidate":
                    if (peers.has(message.to)) {
                        peers.get(message.to).send(JSON.stringify({
                            type: "ice-candidate",
                            from: ws.peerId,
                            candidate: message.candidate
                        }));
                    }
                    break;
            }
        } catch (error) {
            console.error("❌ Error processing WebSocket message:", error);
        }
    });

    ws.on("close", () => {
        if (ws.peerId) {
            peers.delete(ws.peerId);
            console.log(`❌ Peer disconnected: ${ws.peerId}`);
        }
    });
});

console.log("🚀 WebSocket signaling server running on ws://localhost:3000");
