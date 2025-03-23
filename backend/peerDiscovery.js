import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import {
    connectToPeer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    sendMessage
} from "./p2pConnection.js";

const SIGNALING_SERVER_URL = "ws://localhost:3000";
const peerId = uuidv4();
console.log(`🔹 Your Peer ID: ${peerId}`);

const ws = new WebSocket(SIGNALING_SERVER_URL);
const peers = new Map();

ws.on("open", () => {
    console.log("✅ Connected to signaling server");
    ws.send(JSON.stringify({ type: "register", peerId }));
});

ws.on("message", (data) => {
    try {
        const message = JSON.parse(data);
        switch (message.type) {
            case "peer-list":
                console.log("🔍 Received peer list:", message.peers);
                message.peers.forEach((peer) => {
                    if (peer !== peerId && !peers.has(peer)) {
                        peers.set(peer, { peerId: peer });
                        connectToPeer(peer, ws);
                    }
                });
                break;
            case "offer":
                console.log(`📡 Received offer from ${message.from}`);
                handleOffer(message.from, message.offer, ws);
                break;
            case "answer":
                console.log(`🔄 Received answer from ${message.from}`);
                handleAnswer(message.from, message.answer);
                break;
            case "ice-candidate":
                console.log(`❄ Received ICE candidate from ${message.from}`);
                handleIceCandidate(message.from, message.candidate);
                break;
            default:
                console.warn("❓ Unknown message type:", message);
        }
    } catch (error) {
        console.error("❌ Failed to parse WebSocket message:", error);
    }
});

// 📩 Capture user input for sending messages dynamically
process.stdin.on("data", (input) => {
    const message = input.toString().trim();
    if (message === "") return;

    for (const targetPeerId of peers.keys()) {
        console.log(`📤 Sending message to ${targetPeerId}: ${message}`);
        sendMessage(targetPeerId, message);
    }
});
