import React from 'react';

const ChatInterface = ({
  contacts,
  activeChat,
  switchToChat,
  onlineUsers,
  trustStatus,
  recipient,
  handleRecipientChange,
  message,
  handleMessageChange,
  handleSend,
  handleBounce,
  recipientStatus,
  messages,
  username,
  typing,
  messagesEndRef,
  formatMessageTime,
  getTimestamp,
  showTrustWarning
}) => {
  return (
    <div style={{ display: 'flex', flex: 1 }}>
      {/* Contacts sidebar */}
      <div style={{
        width: '250px',
        borderRight: '1px solid #1e2d3d',
        background: '#171c28',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{ 
          padding: '16px', 
          borderBottom: '1px solid #1e2d3d',
          fontSize: '14px',
          color: '#5ccfe6',
          fontWeight: 'bold'
        }}>
          CONTACTS
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {contacts.length === 0 ? (
            <div style={{ padding: '16px', color: '#636b78', fontSize: '12px' }}>
              No contacts yet. Start a conversation by entering a username in the chat.
            </div>
          ) : (
            contacts.map(contact => (
              <div 
                key={contact}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #1e2d3d',
                  cursor: 'pointer',
                  background: activeChat === contact ? 'rgba(92, 207, 230, 0.1)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
                onClick={() => switchToChat(contact)}
              >
                <div>
                  <div style={{ fontSize: '14px', color: activeChat === contact ? '#5ccfe6' : '#a2aabc' }}>
                    {contact}
                  </div>
                  {trustStatus[contact] && !trustStatus[contact].mutualMessaging && (
                    <div style={{ fontSize: '10px', color: '#ff8f40' }}>
                      Trust pending
                    </div>
                  )}
                </div>
                
                <div style={{ 
                  width: 8, 
                  height: 8, 
                  borderRadius: '50%', 
                  background: onlineUsers.includes(contact) ? '#bae67e' : '#636b78'
                }}></div>
              </div>
            ))
          )}
        </div>
        
        {/* New chat button */}
        <div style={{ padding: '16px', borderTop: '1px solid #1e2d3d' }}>
          <button 
            style={{ 
              width: '100%',
              padding: '8px', 
              borderRadius: 4, 
              background: '#1c3b4b', 
              color: '#5ccfe6', 
              fontSize: 14, 
              border: 'none',
              cursor: 'pointer',
              fontFamily: '"Fira Code", monospace'
            }}
            onClick={() => switchToChat(null)}
          >
            NEW CHAT
          </button>
        </div>
      </div>
      
      {/* Chat area */}
      <div style={{ 
        flex: 1, 
        background: '#0d1117',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}>
        {/* Chat header */}
        {activeChat && (
          <div style={{
            padding: '16px',
            borderBottom: '1px solid #1e2d3d',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ 
                width: 10, 
                height: 10, 
                borderRadius: '50%', 
                background: onlineUsers.includes(activeChat) ? '#bae67e' : '#636b78',
                marginRight: 8
              }}></div>
              <div style={{ fontSize: '16px', color: '#5ccfe6' }}>
                {activeChat}
              </div>
            </div>
            
            {trustStatus[activeChat] && !trustStatus[activeChat].mutualMessaging && (
              <div style={{ 
                fontSize: '12px', 
                color: '#ff8f40', 
                padding: '4px 8px',
                background: 'rgba(255, 143, 64, 0.1)',
                borderRadius: '4px'
              }}>
                Trust pending
              </div>
            )}
          </div>
        )}
        
        {/* Trust warning */}
        {showTrustWarning && activeChat && (
          <div style={{
            padding: '12px 16px',
            background: '#4b1c1c',
            color: '#ff8f40',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center'
          }}>
            <span style={{ marginRight: '8px' }}>⚠️</span>
            <span>First-time conversation: Identity verification pending. Encryption keys have not yet been exchanged.</span>
          </div>
        )}
        
        {/* Message area */}
        <div style={{ 
          flex: 1,
          padding: '16px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {!activeChat ? (
            <div style={{ 
              flex: 1, 
              display: 'flex', 
              flexDirection: 'column', 
              justifyContent: 'center', 
              alignItems: 'center',
              color: '#636b78',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '16px', marginBottom: '16px' }}>
                Start a new conversation
              </div>
              <div style={{ fontSize: '14px' }}>
                Enter a username in the field below to begin chatting
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div style={{ color: '#5ccfe6', fontSize: 14 }}>
              {getTimestamp()} Connection established. Awaiting transmission...
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} style={{ 
                alignSelf: msg.from === username ? 'flex-end' : 'flex-start',
                maxWidth: '70%',
                marginBottom: 12, 
                padding: 12,
                borderRadius: 8,
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
                  <span style={{ color: '#636b78', marginLeft: '8px' }}>{formatMessageTime(msg.timestamp)}</span>
                </div>
                <div style={{ wordBreak: 'break-word', fontSize: 14 }}>{msg.message}</div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
        
        {/* Typing indicator */}
        {typing && recipient && (
          <div style={{ fontSize: 12, color: '#5ccfe6', padding: '0 16px 8px' }}>
            {recipient} is typing...
          </div>
        )}
        
        {/* Message input */}
        <form onSubmit={handleSend} style={{ 
          padding: '16px', 
          borderTop: '1px solid #1e2d3d',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {!activeChat && (
            <div style={{ display: 'flex', marginBottom: 8 }}>
              <input
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
                placeholder="Recipient username"
                value={recipient}
                onChange={handleRecipientChange}
                required
              />
              {recipient && (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  marginLeft: 8,
                  fontSize: 12
                }}>
                  <div style={{ 
                    width: 8, 
                    height: 8, 
                    borderRadius: '50%', 
                    background: recipientStatus.online ? '#bae67e' : 
                               recipientStatus.exists ? '#ff8f40' : '#ff3333',
                    marginRight: 6 
                  }}></div>
                  <span style={{
                    fontSize: 12,
                    color: recipientStatus.online ? '#bae67e' : 
                          recipientStatus.exists ? '#ff8f40' : '#ff3333'
                  }}>
                    {recipientStatus.online ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>
              )}
            </div>
          )}
          
          <div style={{ display: 'flex' }}>
            <input
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
              value={message}
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
              
              {/* Always show the RELAY button */}
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
                  fontFamily: '"Fira Code", monospace'
                }} 
                type="button"
                onClick={handleBounce}
                title="Send message via relay (will be delivered when recipient comes online)"
              >
                RELAY
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChatInterface;