// client.js
import readline from "readline";
import { io } from "socket.io-client";
import axios from "axios";

const BASE_NODE_URL = "http://localhost:5000";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let socket;
let username;

const connectToRelay = async () => {
  try {
    const res = await axios.get(`${BASE_NODE_URL}/relay`);
    const { success, relay, fallback } = res.data;

    const relayUrl = success
      ? `http://${relay.ip}:${relay.port}`
      : `http://${fallback.ip}:${fallback.port}`;

    console.log(`Connecting to relay at ${relayUrl}`);
    socket = io(relayUrl);

    setupSocketEvents();
  } catch (err) {
    console.error("Failed to get relay server info:", err.message);
    process.exit(1);
  }
};

const setupSocketEvents = () => {
  rl.question('Enter your username: ', (name) => {
    username = name;
    socket.emit('register', { username });
    console.log(`Registered as ${username}. Start chatting!\n`);
    sendMessage();
  });

  socket.on('receiveMessage', ({ from, message }) => {
    console.log(`\nMessage from ${from}: ${message}\n`);
    console.log('Enter recipient\'s username: ');
  });
};

const sendMessage = () => {
  rl.question('Enter recipient\'s username: ', (receiver) => {
    rl.question('Enter your message: ', (message) => {
      socket.emit('sendMessage', {
        to: receiver,
        message
      });
      sendMessage();
    });
  });
};

connectToRelay();
