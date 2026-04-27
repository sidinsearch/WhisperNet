import React, { useState } from 'react';

const UserList = ({ 
  users, 
  activeChats, 
  unreadCounts, 
  onSelectUser, 
  currentUser,
  onClearHistory,
  onNewChat,
  chatMessages,
  recipientStatuses
}) => {
  const [showNewChatDialog, setShowNewChatDialog] = useState(false);
  const [newChatUsername, setNewChatUsername] = useState('');

  const filteredUsers = users.filter(user => user.username !== currentUser);
  const activeChatsArray = Object.keys(activeChats).filter(username => username !== currentUser);
  const hasContacts = filteredUsers.length > 0 || activeChatsArray.length > 0;
  
  const getLastMessage = (username) => {
    const messages = chatMessages[username] || [];
    if (messages.length === 0) return '';
    const lastMsg = messages[messages.length - 1];
    return lastMsg.message?.substring(0, 30) + (lastMsg.message?.length > 30 ? '...' : '');
  };
  
  const handleNewChatSubmit = (e) => {
    e.preventDefault();
    if (newChatUsername.trim() && newChatUsername !== currentUser) {
      onNewChat(newChatUsername.trim());
      setNewChatUsername('');
      setShowNewChatDialog(false);
    }
  };

  return (
    <div className="sidebar">
      <div className="user-profile">
        <div className="user-label">Logged in as</div>
        <div className="username-display">{currentUser}</div>
      </div>

      <div className="sidebar-header">
        <span className="sidebar-title">Contacts</span>
        <div className="sidebar-actions">
          <button className="btn-new-chat" onClick={() => setShowNewChatDialog(true)}>
            + New Chat
          </button>
          <button className="btn-clear" onClick={onClearHistory} title="Clear all chat history">
            Clear
          </button>
        </div>
      </div>

      {showNewChatDialog && (
        <div className="new-chat-overlay" onClick={() => setShowNewChatDialog(false)}>
          <div className="new-chat-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>New Conversation</h3>
            <p>Enter the username you want to message:</p>
            <form className="new-chat-form" onSubmit={handleNewChatSubmit}>
              <input
                className="form-input"
                value={newChatUsername}
                onChange={(e) => setNewChatUsername(e.target.value)}
                placeholder="Username"
                autoFocus
              />
              <div className="new-chat-actions">
                <button className="btn-secondary" type="button" onClick={() => setShowNewChatDialog(false)}>
                  Cancel
                </button>
                <button className="btn-primary" type="submit" style={{ padding: '10px 20px' }}>
                  Start
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="user-list">
        {!hasContacts ? (
          <div className="user-list-empty">
            <p>No contacts yet</p>
            <small>Click "New Chat" to start a conversation</small>
          </div>
        ) : (
          <div>
            {activeChatsArray.filter(username => filteredUsers.some(u => u.username === username && u.online)).length > 0 && (
              <div className="user-section-title">Online</div>
            )}
            {activeChatsArray
              .filter(username => filteredUsers.some(u => u.username === username && u.online))
              .map(username => (
                <div 
                  key={username} 
                  className={`user-item ${activeChats[username] ? 'active' : ''}`}
                  onClick={() => onSelectUser(username)}
                >
                  <div className="user-item-info">
                    <div className={`user-avatar ${recipientStatuses[username]?.online ? 'online' : ''}`}>
                      {username.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="user-name">{username}</div>
                      {getLastMessage(username) && (
                        <div className="user-preview">{getLastMessage(username)}</div>
                      )}
                    </div>
                  </div>
                  {unreadCounts[username] > 0 && (
                    <div className="unread-badge">{unreadCounts[username]}</div>
                  )}
                </div>
              ))}

            {activeChatsArray.filter(username => !filteredUsers.some(u => u.username === username && u.online)).length > 0 && (
              <div className="user-section-title">Offline</div>
            )}
            {activeChatsArray
              .filter(username => !filteredUsers.some(u => u.username === username && u.online))
              .map(username => (
                <div 
                  key={username} 
                  className={`user-item ${activeChats[username] ? 'active' : ''}`}
                  onClick={() => onSelectUser(username)}
                >
                  <div className="user-item-info">
                    <div className="user-avatar">
                      {username.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="user-name">{username}</div>
                      {getLastMessage(username) && (
                        <div className="user-preview">{getLastMessage(username)}</div>
                      )}
                    </div>
                  </div>
                  {unreadCounts[username] > 0 && (
                    <div className="unread-badge" style={{ background: '#f39c12' }}>{unreadCounts[username]}</div>
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