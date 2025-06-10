import React, { useState } from 'react';

const UserList = ({ 
  users, 
  activeChats, 
  unreadCounts, 
  onSelectUser, 
  currentUser,
  onClearHistory,
  onNewChat
}) => {
  const [showNewChatDialog, setShowNewChatDialog] = useState(false);
  const [newChatUsername, setNewChatUsername] = useState('');

  // Filter out current user from the users list
  const filteredUsers = users.filter(user => user.username !== currentUser);
  
  // Get active chats excluding current user
  const activeChatsArray = Object.keys(activeChats).filter(username => username !== currentUser);
  
  // Check if we have any contacts (online users or active chats)
  const hasContacts = filteredUsers.length > 0 || activeChatsArray.length > 0;
  
  const handleNewChatSubmit = (e) => {
    e.preventDefault();
    if (newChatUsername.trim() && newChatUsername !== currentUser) {
      onNewChat(newChatUsername.trim());
      setNewChatUsername('');
      setShowNewChatDialog(false);
    }
  };

  return (
    <div style={{
      width: '220px',
      borderRight: '1px solid #1e2d3d',
      background: '#171c28',
      display: 'flex',
      flexDirection: 'column',
      height: '100%'
    }}>
      {/* Current user display */}
      <div style={{
        padding: '16px 12px',
        borderBottom: '1px solid #1e2d3d',
        background: '#0d1117'
      }}>
        <div style={{ 
          color: '#5ccfe6', 
          fontWeight: 'bold', 
          fontSize: 14,
          marginBottom: 4
        }}>
          Logged in as:
        </div>
        <div style={{ 
          color: '#bae67e', 
          fontSize: 16,
          fontWeight: 'bold',
          wordBreak: 'break-word'
        }}>
          {currentUser}
        </div>
      </div>

      {/* User list header */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid #1e2d3d',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{ 
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8
        }}>
          <div style={{ 
            color: '#a2aabc', 
            fontSize: 14,
            fontWeight: 'bold'
          }}>
            CONTACTS
          </div>
          <button
            style={{
              background: '#4b1c1c',
              color: '#ff8f40',
              border: 'none',
              padding: '3px 6px',
              borderRadius: 3,
              fontSize: 9,
              cursor: 'pointer'
            }}
            onClick={onClearHistory}
            title="Clear all chat history"
          >
            CLEAR ALL
          </button>
        </div>
        <button
          style={{
            background: '#1e2d3d',
            color: '#5ccfe6',
            border: 'none',
            padding: '6px 0',
            borderRadius: 4,
            fontSize: 11,
            cursor: 'pointer',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={() => setShowNewChatDialog(true)}
          title="Start a new chat"
        >
          <span style={{ marginRight: 4 }}>+</span> NEW CHAT
        </button>
      </div>

      {/* New Chat Dialog */}
      {showNewChatDialog && (
        <div style={{
          padding: '16px',
          borderBottom: '1px solid #1e2d3d',
          background: '#0d1117'
        }}>
          <form onSubmit={handleNewChatSubmit}>
            <div style={{ 
              fontSize: 13, 
              color: '#5ccfe6', 
              marginBottom: 10,
              fontWeight: 'bold'
            }}>
              Start a new conversation
            </div>
            <div style={{ 
              fontSize: 12, 
              color: '#a2aabc', 
              marginBottom: 12
            }}>
              Enter username to chat with:
            </div>
            {/* Username input */}
            <input
              style={{
                width: '100%',
                padding: '8px 10px',
                background: '#171c28',
                border: '1px solid #1e2d3d',
                borderRadius: 4,
                color: '#a2aabc',
                fontSize: 13,
                marginBottom: 10
              }}
              value={newChatUsername}
              onChange={(e) => setNewChatUsername(e.target.value)}
              placeholder="Username"
              autoFocus
            />
            
            {/* Action buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button
                style={{
                  background: 'transparent',
                  color: '#636b78',
                  border: 'none',
                  padding: '8px 0',
                  fontSize: 12,
                  cursor: 'pointer',
                  textDecoration: 'underline'
                }}
                type="button"
                onClick={() => setShowNewChatDialog(false)}
              >
                Cancel
              </button>
              
              <button
                style={{
                  background: '#5ccfe6',
                  color: '#171c28',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  minWidth: '80px'
                }}
                type="submit"
              >
                START
              </button>
            </div>
          </form>
        </div>
      )}

      {/* User list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px 0'
      }}>
        {!hasContacts ? (
          <div style={{ 
            padding: '16px 12px', 
            color: '#636b78', 
            fontSize: 12,
            textAlign: 'center'
          }}>
            <div style={{ marginBottom: 8, fontStyle: 'italic' }}>
              No contacts yet
            </div>
            <div style={{ fontSize: 11, marginBottom: 12 }}>
              Click on NEW CHAT to start a conversation
            </div>
          </div>
        ) : (
          <div>
            {/* Online contacts (users you've chatted with who are online) */}
            {activeChatsArray
              .filter(username => filteredUsers.some(u => u.username === username && u.online))
              .length > 0 && (
                <div style={{ 
                  padding: '4px 12px', 
                  color: '#636b78', 
                  fontSize: 10,
                  textTransform: 'uppercase',
                  fontWeight: 'bold'
                }}>
                  Online Contacts
                </div>
              )}
            {activeChatsArray
              .filter(username => filteredUsers.some(u => u.username === username && u.online))
              .map(username => (
                <div 
                  key={username} 
                  style={{
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    background: activeChats[username] ? 'rgba(92, 207, 230, 0.1)' : 'transparent',
                    borderLeft: activeChats[username] ? '3px solid #5ccfe6' : '3px solid transparent',
                    transition: 'background 0.2s'
                  }}
                  onClick={() => onSelectUser(username)}
                >
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ 
                      width: 8, 
                      height: 8, 
                      borderRadius: '50%', 
                      background: '#bae67e',
                      marginRight: 8 
                    }}></div>
                    <span style={{ color: '#a2aabc' }}>{username}</span>
                  </div>
                  {unreadCounts[username] > 0 && (
                    <div style={{
                      background: '#5ccfe6',
                      color: '#171c28',
                      borderRadius: '50%',
                      width: 18,
                      height: 18,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 'bold'
                    }}>
                      {unreadCounts[username]}
                    </div>
                  )}
                </div>
              ))}

            {/* Offline contacts */}
            {activeChatsArray
              .filter(username => !filteredUsers.some(u => u.username === username && u.online))
              .length > 0 && (
                <div style={{ 
                  padding: '4px 12px', 
                  color: '#636b78', 
                  fontSize: 10,
                  textTransform: 'uppercase',
                  fontWeight: 'bold',
                  marginTop: activeChatsArray.filter(username => 
                    filteredUsers.some(u => u.username === username && u.online)).length > 0 ? 8 : 0
                }}>
                  Offline Contacts
                </div>
              )}
            {activeChatsArray
              .filter(username => !filteredUsers.some(u => u.username === username && u.online))
              .map(username => (
                <div 
                  key={username} 
                  style={{
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    background: activeChats[username] ? 'rgba(255, 143, 64, 0.1)' : 'transparent',
                    borderLeft: activeChats[username] ? '3px solid #ff8f40' : '3px solid transparent',
                    transition: 'background 0.2s'
                  }}
                  onClick={() => onSelectUser(username)}
                >
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ 
                      width: 8, 
                      height: 8, 
                      borderRadius: '50%', 
                      background: '#ff3333',
                      marginRight: 8 
                    }}></div>
                    <span style={{ color: '#a2aabc' }}>{username}</span>
                  </div>
                  {unreadCounts[username] > 0 && (
                    <div style={{
                      background: '#ff8f40',
                      color: '#171c28',
                      borderRadius: '50%',
                      width: 18,
                      height: 18,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 'bold'
                    }}>
                      {unreadCounts[username]}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UserList;