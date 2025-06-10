import React, { useState, useRef, useEffect } from 'react';

// ChatBox component for individual conversations
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

  // Scroll to bottom when messages change
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
      // Call the relay function with the recipient and message
      onRelayMessage(recipient, messageInput);
      
      // Clear the input immediately to provide visual feedback
      setMessageInput('');
    }
  };

  const handleMessageChange = (e) => {
    setMessageInput(e.target.value);
    onMessageChange(e.target.value);
  };

  // Format timestamp for messages
  const formatMessageTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return `[${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}]`;
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden'
    }}>
      {/* Chat header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid #1e2d3d',
        background: '#0d1117'
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ 
            width: 8, 
            height: 8, 
            borderRadius: '50%', 
            background: recipientStatus.online ? '#bae67e' : '#ff3333',
            marginRight: 8 
          }}></div>
          <span style={{ 
            color: recipientStatus.online ? '#bae67e' : '#ff8f40',
            fontWeight: 'bold'
          }}>
            {recipient}
          </span>
          <span style={{ 
            fontSize: 12, 
            color: '#636b78', 
            marginLeft: 8 
          }}>
            {recipientStatus.online ? 'ONLINE' : 'OFFLINE'}
          </span>
          
          {/* Verification status badge */}
          {verificationStatus && (
            <div 
              onClick={() => onVerifyIdentity && onVerifyIdentity(recipient)}
              style={{
                display: 'flex',
                alignItems: 'center',
                marginLeft: 12,
                padding: '2px 6px',
                borderRadius: 4,
                background: verificationStatus.verified ? 
                  'rgba(186, 230, 126, 0.1)' : 
                  'rgba(255, 143, 64, 0.1)',
                border: verificationStatus.verified ? 
                  '1px solid #bae67e' : 
                  '1px solid #ff8f40',
                cursor: 'pointer'
              }}
              title={verificationStatus.message || 'Click to verify identity'}
            >
              <span style={{
                fontSize: 10,
                color: verificationStatus.verified ? '#bae67e' : '#ff8f40',
                fontWeight: 'bold'
              }}>
                {verificationStatus.verified ? 'VERIFIED' : 'UNVERIFIED'}
              </span>
              {verificationStatus.verified ? (
                <span style={{ marginLeft: 4, color: '#bae67e' }}>✓</span>
              ) : (
                <span style={{ marginLeft: 4, color: '#ff8f40' }}>!</span>
              )}
            </div>
          )}
        </div>
        <button 
          style={{ 
            background: 'none', 
            border: 'none', 
            color: '#636b78', 
            cursor: 'pointer',
            fontSize: 16
          }}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* Messages area */}
      <div style={{ 
        flex: 1,
        overflowY: 'auto', 
        padding: 12,
        background: '#0d1117',
        borderBottom: '1px solid #1e2d3d'
      }}>
        {messages.length === 0 ? (
          <div style={{ color: '#5ccfe6', fontSize: 14 }}>
            Start a conversation with {recipient}...
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} style={{ 
              marginBottom: 12, 
              padding: 8,
              borderRadius: 4,
              background: msg.from === username ? 'rgba(92, 207, 230, 0.1)' : 'rgba(186, 230, 126, 0.1)',
              borderLeft: msg.from === username ? '2px solid #5ccfe6' : '2px solid #bae67e'
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                marginBottom: 4, 
                fontSize: 12 
              }}>
                <span style={{ 
                  color: msg.from === username ? '#5ccfe6' : '#bae67e',
                  fontWeight: 'bold'
                }}>
                  {msg.from === username ? 'YOU' : msg.from}
                  {msg.bounced && <span style={{ color: '#ff8f40', marginLeft: 6 }}>(bounced)</span>}
                </span>
                <span style={{ color: '#636b78' }}>{formatMessageTime(msg.timestamp)}</span>
              </div>
              <div style={{ wordBreak: 'break-word', fontSize: 14 }}>{msg.message}</div>
              {msg.status === 'bounced' && (
                <div style={{ 
                  fontSize: 10, 
                  color: '#ff8f40', 
                  marginTop: 4,
                  fontStyle: 'italic'
                }}>
                  Message will be delivered when recipient comes online (expires in 4 hours)
                </div>
              )}
              {msg.bounced && (
                <div style={{ 
                  fontSize: 10, 
                  color: '#5ccfe6', 
                  marginTop: 4,
                  fontStyle: 'italic'
                }}>
                  This message was delivered to you when you came online
                </div>
              )}
            </div>
          ))
        )}
        {typing && (
          <div style={{ fontSize: 12, color: '#5ccfe6', marginTop: 8 }}>
            {recipient} is typing...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message input */}
      <form className="chat-input" onSubmit={handleSend} style={{ 
        display: 'flex', 
        padding: 12,
        background: '#0d1117'
      }}>
        <input
          className="chat-input-field"
          style={{ 
            flex: 1, 
            padding: 10, 
            borderRadius: 4, 
            border: '1px solid #1e2d3d', 
            background: '#0d1117',
            color: '#a2aabc',
            fontSize: 14,
            marginRight: 8,
            fontFamily: '"Fira Code", monospace'
          }}
          placeholder="Type a message"
          value={messageInput}
          onChange={handleMessageChange}
          required
        />
        <div style={{ display: 'flex' }}>
          {/* SEND button */}
          <button 
            style={{ 
              padding: '0 18px', 
              borderRadius: '4px 0 0 4px', 
              background: recipientStatus.online ? 
                'linear-gradient(90deg, #5ccfe6, #bae67e)' : 
                '#636b78', 
              color: '#171c28', 
              fontWeight: 'bold', 
              fontSize: 14, 
              border: 'none',
              cursor: recipientStatus.online ? 'pointer' : 'not-allowed',
              fontFamily: '"Fira Code", monospace'
            }} 
            type="submit"
            disabled={!recipientStatus.online}
            title={recipientStatus.online ? "Send message directly" : "User is offline or not found"}
          >
            SEND
          </button>
          
          {/* RELAY button */}
          <button 
            style={{ 
              padding: '0 12px', 
              borderRadius: '0 4px 4px 0', 
              background: '#4b1c1c', 
              color: '#ff8f40', 
              fontWeight: 'bold', 
              fontSize: 14, 
              border: 'none',
              cursor: 'pointer',
              fontFamily: '"Fira Code", monospace',
              display: 'flex',
              alignItems: 'center'
            }} 
            onClick={handleRelay}
            type="button" // Explicitly set as button type to prevent form submission
            title="Message will be securely encrypted and bounce across the relay network until delivered"
          >
            RELAY
            <span style={{
              fontSize: 10,
              marginLeft: 4,
              background: 'rgba(255, 143, 64, 0.2)',
              padding: '1px 3px',
              borderRadius: 2
            }}>
              4h
            </span>
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChatBox;