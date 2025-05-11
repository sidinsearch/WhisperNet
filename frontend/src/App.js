import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import axios from "axios";

const BASE_NODE_URL = process.env.REACT_APP_BASE_NODE_URL || "http://localhost:5000";

function App() {
  const [username, setUsername] = useState("");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const socketRef = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (connected) return;
    if (!username) return;
    const connectToRelay = async () => {
      try {
        const res = await axios.get(`${BASE_NODE_URL}/relay`);
        const { success, relay, fallback } = res.data;
        const relayUrl = success
          ? `http://${relay.ip}:${relay.port}`
          : `http://${fallback.ip}:${fallback.port}`;
        socketRef.current = io(relayUrl);
        socketRef.current.emit("register", { username }, (response) => {
          if (!response.success) {
            setError(response.reason);
            setUsername("");
            return;
          }
          setConnected(true);
        });
        socketRef.current.on("receiveMessage", ({ from, message }) => {
          setMessages((msgs) => [...msgs, { from, message }]);
        });
      } catch (err) {
        setError("Failed to connect to relay server");
      }
    };
    connectToRelay();
    // eslint-disable-next-line
  }, [username]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!recipient || !message) return;
    socketRef.current.emit("sendMessage", {
      to: recipient,
      message
    }, (response) => {
      if (!response.delivered) {
        setMessages((msgs) => [...msgs, { from: "System", message: `User '${recipient}' is offline or unavailable.` }]);
      } else {
        setMessages((msgs) => [...msgs, { from: username, message }]);
      }
    });
    setMessage("");
  };

  if (!username) {
    return (
      <div className="container vh-100 d-flex align-items-center justify-content-center">
        <div className="chat-window w-100" style={{ maxWidth: 400 }}>
          <h2 className="mb-4 text-center">WhisperNet Messenger</h2>
          {error && <div className="alert alert-danger">{error}</div>}
          <form onSubmit={e => { e.preventDefault(); setUsername(e.target.username.value); setError(""); }}>
            <div className="mb-3">
              <label className="form-label">Enter your username</label>
              <input name="username" className="form-control" required autoFocus />
            </div>
            <button className="btn btn-primary w-100">Join</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="container vh-100 d-flex align-items-center justify-content-center">
      <div className="chat-window w-100" style={{ maxWidth: 500, minHeight: 500 }}>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h4 className="mb-0">Hi, {username}</h4>
          <button className="btn btn-sm btn-danger" onClick={() => { setUsername(""); setConnected(false); setMessages([]); setError(""); }}>Logout</button>
        </div>
        <div className="mb-3">
          <input
            className="form-control"
            placeholder="Recipient username"
            value={recipient}
            onChange={e => setRecipient(e.target.value)}
            required
          />
        </div>
        <div className="mb-3" style={{ height: 300, overflowY: 'auto', background: '#181a1b', borderRadius: 8, padding: 10 }}>
          {messages.length === 0 && <div className="text-muted text-center">No messages yet.</div>}
          {messages.map((msg, idx) => (
            <div key={idx} className="message-row clearfix">
              <div className={
                "message-bubble " + (msg.from === username ? "sent float-end" : msg.from === "System" ? "received float-start bg-warning text-dark" : "received float-start")
              }>
                <span className="fw-bold">{msg.from}:</span> {msg.message}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <form className="d-flex" onSubmit={handleSend} autoComplete="off">
          <input
            className="form-control me-2"
            placeholder="Type your message..."
            value={message}
            onChange={e => setMessage(e.target.value)}
            required
            autoFocus
          />
          <button className="btn btn-success">Send</button>
        </form>
      </div>
    </div>
  );
}

export default App;