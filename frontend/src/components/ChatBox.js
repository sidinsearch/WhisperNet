import React, { useState, useRef, useEffect } from 'react';

const ChatBox = ({ 
  recipient, 
  messages, 
  username, 
  onSendMessage, 
  onRelayMessage, 
  recipientStatus,
  typing,
  onMessageChange,
  onClose,
  verificationStatus,
  onVerifyIdentity
}) => {
  const [messageInput, setMessageInput] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    if (messageInput.trim()) {
      onSendMessage(recipient, messageInput);
      setMessageInput('');
    }
  };

  const handleRelay = (e) => {
    e.preventDefault();
    if (messageInput.trim()) {
      onRelayMessage(recipient, messageInput);
      setMessageInput('');
    }
  };

  const handleMessageChange = (e) => {
    setMessageInput(e.target.value);
    onMessageChange(e.target.value);
  };

  const formatMessageTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <>
      <div className="chat-header">
        <div className="chat-header-info">
          <div className={`chat-avatar ${recipientStatus.online ? 'online' : ''}`}>
            {recipient.charAt(0).toUpperCase()}
          </div>
          <div className="chat-user-details">
            <span className="chat-username">{recipient}</span>
            <span className={`chat-status ${recipientStatus.online ? 'online' : 'offline'}`}>
              <span className={`status-dot ${recipientStatus.online ? 'online' : 'offline'}`}></span>
              {recipientStatus.online ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {verificationStatus && (
            <div 
              className={`verification-badge ${verificationStatus.verified ? 'verified' : 'unverified'}`}
              onClick={() => onVerifyIdentity && onVerifyIdentity(recipient)}
            >
              {verificationStatus.verified ? '✓ Verified' : '⚠ Unverified'}
            </div>
          )}
          <button className="btn-close-chat" onClick={onClose}>×</button>
        </div>
      </div>

      <div className="messages-container">
        {messages.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
            Start a conversation with {recipient}...
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`message ${msg.from === username ? 'sent' : 'received'}`}>
              <div className="message-header">
                <span className="message-sender">
                  {msg.from === username ? 'You' : msg.from}
                  {msg.bounced && <span style={{ marginLeft: 8, fontSize: 10 }}>📨 Queued</span>}
                </span>
                <span className="message-time">{formatMessageTime(msg.timestamp)}</span>
              </div>
              <div className="message-content">{msg.message}</div>
              {msg.status === 'bounced' && (
                <div className="message-status bounced">
                  ⏳ Will be delivered when recipient comes online
                </div>
              )}
              {msg.bounced && (
                <div className="message-status">
                  ✓ Delivered when recipient came online
                </div>
              )}
            </div>
          ))
        )}
        {typing && (
          <div className="typing-indicator">
            <div className="typing-dots">
              <span></span><span></span><span></span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{recipient} is typing...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="message-input-container">
        <form className="message-input-form" onSubmit={handleSend}>
          <input
            className="message-input"
            placeholder="Type a message..."
            value={messageInput}
            onChange={handleMessageChange}
            required
          />
          <button 
            className="btn-send"
            type="submit"
            disabled={!recipientStatus.online}
          >
            Send
          </button>
          <button 
            className="btn-relay"
            onClick={handleRelay}
            type="button"
          >
            Relay
            <span className="relay-badge">4h</span>
          </button>
        </form>
      </div>
    </>
  );
};

export default ChatBox;