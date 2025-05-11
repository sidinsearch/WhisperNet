import React, { useState, useRef, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';

const BASE_NODE_URL = process.env.REACT_APP_BASE_NODE_URL || 'http://localhost:5000';

function App() {
  const [username, setUsername] = useState('');
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (connected) {
      socketRef.current = io(BASE_NODE_URL.replace(/\/$/, ''), {
        transports: ['websocket']
      });
      setStatus('Connecting');
      socketRef.current.on('connect', () => {
        setStatus('Connected');
        socketRef.current.emit('register', { username }, (res) => {
          if (!res.success) {
            setStatus('Username taken');
            setConnected(false);
            socketRef.current.disconnect();
          }
        });
      });
      socketRef.current.on('disconnect', () => {
        setStatus('Disconnected');
      });
      socketRef.current.on('receiveMessage', ({ from, message }) => {
        setMessages((msgs) => [...msgs, { from, message }]);
      });
      return () => {
        socketRef.current.disconnect();
      };
    }
  }, [connected, username]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username) setConnected(true);
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!recipient || !message) return;
    socketRef.current.emit('sendMessage', { to: recipient, message }, (res) => {
      if (res?.delivered) {
        setMessages((msgs) => [...msgs, { from: username, message }]);
        setMessage('');
      } else {
        setStatus(res?.reason || 'Delivery failed');
      }
    });
  };

  return (
    <div style={{ background: '#181c20', minHeight: '100vh', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#23272f', padding: 32, borderRadius: 12, minWidth: 350, boxShadow: '0 4px 24px #0006' }}>
        <h2 style={{ textAlign: 'center', marginBottom: 24 }}>WhisperNet</h2>
        {!connected ? (
          <form onSubmit={handleLogin}>
            <input
              style={{ width: '100%', padding: 10, marginBottom: 12, borderRadius: 6, border: 'none', fontSize: 16 }}
              placeholder="Enter username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
            />
            <button style={{ width: '100%', padding: 10, borderRadius: 6, background: '#4ecdc4', color: '#181c20', fontWeight: 'bold', fontSize: 16, border: 'none' }} type="submit">Login</button>
            <div style={{ marginTop: 12, color: '#f66', textAlign: 'center' }}>{status !== 'Disconnected' && status}</div>
          </form>
        ) : (
          <>
            <div style={{ marginBottom: 16, color: '#4ecdc4', textAlign: 'center' }}>Status: {status}</div>
            <form onSubmit={handleSend} style={{ display: 'flex', marginBottom: 16 }}>
              <input
                style={{ flex: 1, padding: 10, borderRadius: 6, border: 'none', fontSize: 16, marginRight: 8 }}
                placeholder="Recipient username"
                value={recipient}
                onChange={e => setRecipient(e.target.value)}
                required
              />
              <input
                style={{ flex: 2, padding: 10, borderRadius: 6, border: 'none', fontSize: 16, marginRight: 8 }}
                placeholder="Type a message"
                value={message}
                onChange={e => setMessage(e.target.value)}
                required
              />
              <button style={{ padding: '0 18px', borderRadius: 6, background: '#4ecdc4', color: '#181c20', fontWeight: 'bold', fontSize: 16, border: 'none' }} type="submit">Send</button>
            </form>
            <div style={{ background: '#181c20', borderRadius: 8, padding: 12, minHeight: 180, maxHeight: 300, overflowY: 'auto', marginBottom: 8 }}>
              {messages.map((msg, i) => (
                <div key={i} style={{ marginBottom: 8, color: msg.from === username ? '#4ecdc4' : '#fff' }}>
                  <b>{msg.from}:</b> {msg.message}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <button style={{ width: '100%', padding: 10, borderRadius: 6, background: '#f66', color: '#fff', fontWeight: 'bold', fontSize: 16, border: 'none' }} onClick={() => setConnected(false)}>Logout</button>
          </>
        )}
      </div>
    </div>
  );
}

export default App;