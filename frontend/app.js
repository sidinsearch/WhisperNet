// const serverUrl = 'http://localhost:8080';

// const pingServer = async () => {
//     const response = await fetch(serverUrl + '/ping', {
//         method: 'POST',
//         headers: {
//            'Content-Type': 'application/json' 
//         }, 
//         body: JSON.stringify({
//             id: 1
//         })
//     });
//     const data = await response.json();
//     console.log(data);
// }

// pingServer()
// .then(() => {
//     console.log('Pinged to server successfully!');
// })
// .catch((err) => {
//     console.log('Error pinging the server: '+err.message);
//     return;
// });

import readline from "readline";
import { io } from "socket.io-client";
const serverUrl = 'http://localhost:8080';

const socket = io(serverUrl);
const rl = readline.createInterface({
    input: process.stdin,
    output:  process.stdout
});

let username;

const sendMessage = () => {
    rl.question('Enter recipient\'s username: ', (receiver) => {
        rl.question('Enter your message: ', (message) => {
            socket.emit('send_message', {
                sender: username, receiver, message
            });
            sendMessage();
        });
    });
}

rl.question('Enter your username: ', (name) => {
    username = name;
    socket.emit('register', username);
    console.log(`Registered as ${username}. Start chatting!`);
    sendMessage();
});

socket.on('receive_message', ({ sender, message }) => {
    console.log(`\n\n> ${sender}: ${message}\n`);
    console.log('Enter recipient\'s username: ');
});