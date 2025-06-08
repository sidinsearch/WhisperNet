import React from 'react';

const LoginScreen = ({ 
  username, 
  handleUsernameChange, 
  handleUsernameSubmit, 
  isCheckingUsername, 
  usernameAvailable, 
  relayStatus, 
  status, 
  securityAlert, 
  dismissAlert, 
  retryConnection,
  getTimestamp 
}) => {
  return (
    <div style={{ 
      flex: 1, 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: '#171c28'
    }}>
      <div style={{ 
        maxWidth: '400px', 
        width: '100%', 
        padding: '32px',
        borderRadius: '8px',
        border: '1px solid rgba(0, 255, 170, 0.3)',
        background: '#0d1117'
      }}>
        <div style={{ marginBottom: 16, fontSize: 14, color: '#5ccfe6' }}>
          {getTimestamp()} Initializing secure connection...
        </div>
        
        {securityAlert && (
          <div style={{ 
            background: '#4b1c1c', 
            color: '#ff8f40', 
            padding: 12, 
            borderRadius: 4, 
            marginBottom: 16,
            position: 'relative',
            fontSize: 14
          }}>
            <div style={{ marginRight: 20 }}>{securityAlert.message}</div>
            <button 
              style={{ 
                position: 'absolute', 
                top: 8, 
                right: 8, 
                background: 'none', 
                border: 'none', 
                color: '#ff8f40', 
                cursor: 'pointer',
                fontSize: 16
              }}
              onClick={dismissAlert}
            >
              ×
            </button>
          </div>
        )}
        
        <form onSubmit={handleUsernameSubmit}>
          <input
            style={{ 
              width: '100%', 
              padding: 10, 
              borderRadius: 4, 
              border: '1px solid #1e2d3d', 
              background: '#0d1117',
              color: '#a2aabc',
              fontSize: 14,
              marginBottom: 12,
              fontFamily: '"Fira Code", monospace'
            }}
            placeholder="Choose a username"
            value={username}
            onChange={handleUsernameChange}
            required
          />
          
          {isCheckingUsername && (
            <div style={{ fontSize: 12, color: '#5ccfe6', marginBottom: 12 }}>
              Checking username availability...
            </div>
          )}
          
          {!usernameAvailable && username && !isCheckingUsername && (
            <div style={{ fontSize: 12, color: '#ff3333', marginBottom: 12 }}>
              Username is already taken. Please choose another.
            </div>
          )}
          
          <button 
            style={{ 
              width: '100%',
              padding: 10, 
              borderRadius: 4, 
              background: relayStatus === 'online' ? 'linear-gradient(90deg, #5ccfe6, #bae67e)' : '#636b78', 
              color: '#171c28', 
              fontWeight: 'bold', 
              fontSize: 14, 
              border: 'none',
              cursor: relayStatus === 'online' ? 'pointer' : 'not-allowed',
              fontFamily: '"Fira Code", monospace'
            }} 
            type="submit"
            disabled={relayStatus !== 'online' || (!usernameAvailable && username.length > 0) || isCheckingUsername}
          >
            CONNECT
          </button>
        </form>
        
        {relayStatus !== 'online' && (
          <button 
            style={{ 
              width: '100%',
              marginTop: 12,
              padding: 10, 
              borderRadius: 4, 
              background: '#4b1c1c', 
              color: '#ff8f40', 
              fontSize: 14, 
              border: 'none',
              cursor: 'pointer',
              fontFamily: '"Fira Code", monospace'
            }} 
            onClick={retryConnection}
          >
            RETRY CONNECTION
          </button>
        )}
        
        <div style={{ marginTop: 12, color: '#ff3333', textAlign: 'center', fontSize: 14 }}>
          {status}
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;