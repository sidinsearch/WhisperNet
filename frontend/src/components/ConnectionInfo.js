import React from 'react';

const ConnectionInfo = ({
  status,
  connected,
  connectionDetails,
  relayServerUrl,
  relayStatus,
  deviceId,
  BASE_NODE_URL
}) => {
  return (
    <div style={{ 
      background: '#0d1117', 
      padding: 12, 
      borderRadius: 4, 
      fontSize: 12, 
      fontFamily: 'monospace',
      marginBottom: 16,
      border: '1px solid #1e2d3d'
    }}>
      <div>Status: {status}</div>
      {connected && (
        <>
          <div>Socket ID: {connectionDetails.socketId || 'unknown'}</div>
          <div>Transport: {connectionDetails.transport || 'unknown'}</div>
          <div>Base Node: {connectionDetails.baseNodeUrl || BASE_NODE_URL}</div>
          <div>Relay ID: <span style={{ color: '#5ccfe6' }}>{relayServerUrl || 'Unknown'}</span></div>
          <div>Relay Status: <span style={{ 
            color: connectionDetails.relayStatus === 'connected_to_relay' ? '#bae67e' : 
                   connectionDetails.relayStatus === 'direct_to_base' ? '#5ccfe6' : 
                   connectionDetails.relayStatus === 'handshake' ? '#ff8f40' : '#bae67e'
          }}>
            {connectionDetails.relayStatus === 'connected_to_relay' ? 'Connected to Relay' : 
             connectionDetails.relayStatus === 'direct_to_base' ? 'Direct to Base Node' : 
             connectionDetails.relayStatus === 'handshake' ? 'Handshake' : 'Connected'}
          </span></div>
          {connectionDetails.connectedUsers !== undefined && (
            <div>Users on Relay: {connectionDetails.connectedUsers}</div>
          )}
          {connectionDetails.ip && connectionDetails.port && (
            <div>Relay Address: {connectionDetails.ip}:{connectionDetails.port}</div>
          )}
        </>
      )}
      <div>Base Node Status: <span style={{
        color: relayStatus === 'online' ? '#bae67e' : '#ff8f40'
      }}>{relayStatus}</span></div>
      {deviceId && <div>Device ID: {deviceId.substring(0, 8)}...</div>}
    </div>
  );
};

export default ConnectionInfo;