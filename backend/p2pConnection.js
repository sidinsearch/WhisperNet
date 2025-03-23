import wrtc from "wrtc";

const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = wrtc;

const peerConnections = new Map();
const dataChannels = new Map();

/**
 * Creates a WebRTC connection for a peer.
 */
export function createPeerConnection(targetPeerId, ws, isOfferer = false) {
    console.log(`🔧 Creating WebRTC connection for ${targetPeerId}...`);

    const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // ICE Candidate Exchange
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(
                JSON.stringify({
                    type: "ice-candidate",
                    from: ws.peerId,
                    to: targetPeerId,
                    candidate: event.candidate,
                })
            );
        }
    };

    // Connection state changes
    pc.onconnectionstatechange = () => {
        console.log(`🔄 Connection state with ${targetPeerId}:`, pc.connectionState);
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            peerConnections.delete(targetPeerId);
            dataChannels.delete(targetPeerId);
        }
    };

    // If this peer is the initiator, create a data channel
    if (isOfferer) {
        console.log(`📡 Creating DataChannel for ${targetPeerId}`);
        const dataChannel = pc.createDataChannel("chat");
        setupDataChannel(targetPeerId, dataChannel);
    } else {
        // Listen for incoming data channels
        pc.ondatachannel = (event) => {
            console.log(`🔄 Received DataChannel from ${targetPeerId}`);
            setupDataChannel(targetPeerId, event.channel);
        };
    }

    // Store connection
    peerConnections.set(targetPeerId, pc);

    return pc;
}

/**
 * Sets up a WebRTC Data Channel for messaging.
 */
function setupDataChannel(targetPeerId, dataChannel) {
    console.log(`📡 Setting up DataChannel with ${targetPeerId}`);
    
    dataChannels.set(targetPeerId, dataChannel);

    dataChannel.onopen = () => {
        console.log(`✅ DataChannel open with ${targetPeerId}`);
    };

    dataChannel.onmessage = (event) => {
        console.log(`💬 Message from ${targetPeerId}: ${event.data}`);
    };

    dataChannel.onclose = () => {
        console.log(`❌ DataChannel closed with ${targetPeerId}`);
        dataChannels.delete(targetPeerId);
    };
}

/**
 * Initiates a connection and creates a WebRTC offer.
 */
export async function connectToPeer(targetPeerId, ws) {
    console.log(`🔗 Initiating connection with ${targetPeerId}...`);

    if (peerConnections.has(targetPeerId)) {
        console.log(`⚠️ Already connected to ${targetPeerId}`);
        return;
    }

    const pc = createPeerConnection(targetPeerId, ws, true); // Offerer creates a data channel

    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        ws.send(
            JSON.stringify({
                type: "offer",
                from: ws.peerId,
                to: targetPeerId,
                offer,
            })
        );
    } catch (error) {
        console.error(`❌ Failed to create offer for ${targetPeerId}:`, error);
    }
}

/**
 * Handles an incoming WebRTC offer.
 */
export async function handleOffer(from, offer, ws) {
    console.log(`📡 Handling offer from ${from}...`);
    const pc = createPeerConnection(from, ws, false); // Answerer should not create data channel

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        ws.send(
            JSON.stringify({
                type: "answer",
                from: ws.peerId,
                to: from,
                answer,
            })
        );
    } catch (error) {
        console.error(`❌ Failed to handle offer from ${from}:`, error);
    }
}

/**
 * Handles an incoming WebRTC answer.
 */
export async function handleAnswer(from, answer) {
    console.log(`🔄 Handling answer from ${from}...`);
    const pc = peerConnections.get(from);
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
}

/**
 * Handles incoming ICE candidates.
 */
export async function handleIceCandidate(from, candidate) {
    console.log(`❄ Handling ICE candidate from ${from}...`);
    const pc = peerConnections.get(from);
    if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

/**
 * Sends a message to a peer over the data channel.
 */
export function sendMessage(targetPeerId, message) {
    const dataChannel = dataChannels.get(targetPeerId);
    if (dataChannel && dataChannel.readyState === "open") {
        console.log(`📤 Sending message to ${targetPeerId}: ${message}`);
        dataChannel.send(message);
    } else {
        console.warn(`⚠️ Cannot send message. DataChannel with ${targetPeerId} is not open.`);
    }
}
