import React from 'react';

const SecurityAlert = ({ alert, onDismiss }) => {
  if (!alert) return null;
  
  return (
    <div style={{ 
      background: '#4b1c1c', 
      color: '#ff8f40', 
      padding: 12, 
      borderRadius: 4, 
      marginBottom: 16,
      position: 'relative',
      fontSize: 14
    }}>
      <div style={{ marginRight: 20 }}>{alert.message}</div>
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
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
};

export default SecurityAlert;