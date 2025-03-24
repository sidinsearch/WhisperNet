import express from "express";
import { searchUser, sendMessange } from "./utils.js";
import http from 'http';
import { Server } from "socket.io";
const PORT = 8080;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const onlineUsers = new Set();

let users = {};
// app.use(express.json());

// app.get('/', (req, res) => {
//     res.send('HomePage!');
// });

// app.post('/ping', (req, res) => {
//     const { id } = req.body;
//     const user = searchUser(id);
//     if(!user) {
//         res.json({message: 'User not found!'});
//         return;
//     }
//     onlineUsers.add(id);
//     console.log(user.name+' is online!');
//     res.json(user);
// });

// app.post('/sendMessage', (req, res) => {
//     const { senderId, receiverId, message } = req.body;
//     if(!onlineUsers.has(senderId)) {
//         res.json({
//             error: 'Internal server erorr!'
//         });
//         return;
//     }
//     console.log(receiverId, message);
//     const user = searchUser(receiverId);
//     if(!user) {
//         res.json({
//             error: 'User not found!'
//         });
//         return;
//     }
//     if(onlineUsers.has(receiverId)) {
//         sendMessange();
//         res.json({
//             msg: 'Message sent successfully!'
//         });
//         return;
//     }
//     res.json({
//         error: 'User is not online!'
//     });
//     return;
// });

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('register', (username) => {
        users[username] = socket.id;
        console.log(`User registered: ${username} -> ${socket.id}`);
    });

    socket.on('send_message', ({sender, receiver, message}) => {
        console.log(`Message from ${sender} to ${receiver}: ${message}`);

        if (users[receiver]) {
            io.to(users[receiver]).emit("receive_message", { sender, message });
        } else {
            console.log(`User ${receiver} not found`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const user in users) {
            if (users[user] === socket.id) {
                delete users[user];
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`App is running on http://localhost:${PORT}`);
});