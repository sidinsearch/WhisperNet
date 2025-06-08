import React from 'react';

const AboutPage = () => {
  return (
    <div style={{ 
      flex: 1, 
      padding: '24px', 
      overflowY: 'auto',
      background: '#171c28'
    }}>
      <h2 style={{ color: '#5ccfe6', marginTop: 0 }}>About WhisperNet</h2>
      
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ color: '#bae67e' }}>Architecture Overview</h3>
        <p>
          WhisperNet is a decentralized peer-to-peer messaging application designed for secure, private communication.
          The system uses a hybrid architecture combining centralized coordination with decentralized message delivery.
        </p>
      </div>
      
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ color: '#bae67e' }}>Key Components</h3>
        
        <h4 style={{ color: '#ff8f40' }}>Base Node</h4>
        <p>
          The Base Node serves as the central coordination point for the network. It handles:
        </p>
        <ul>
          <li>User registration and authentication</li>
          <li>Relay server discovery and assignment</li>
          <li>Initial connection handshaking</li>
          <li>Fallback message routing when relays are unavailable</li>
        </ul>
        
        <h4 style={{ color: '#ff8f40' }}>Relay Servers</h4>
        <p>
          Relay servers form the backbone of the message delivery system:
        </p>
        <ul>
          <li>Route messages between users who aren't directly connected</li>
          <li>Store offline messages for up to 4 hours</li>
          <li>Provide redundancy in the network</li>
          <li>Reduce load on the Base Node</li>
        </ul>
        
        <h4 style={{ color: '#ff8f40' }}>Client Application</h4>
        <p>
          The client (this web application) handles:
        </p>
        <ul>
          <li>End-to-end encryption of messages</li>
          <li>Key generation and management</li>
          <li>User interface and message display</li>
          <li>Local storage of messages and encryption keys</li>
          <li>Device fingerprinting for identity verification</li>
        </ul>
      </div>
      
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ color: '#bae67e' }}>Security Features</h3>
        
        <h4 style={{ color: '#ff8f40' }}>End-to-End Encryption</h4>
        <p>
          All messages are encrypted using RSA-OAEP with 2048-bit keys. Only the intended recipient can decrypt messages.
          The encryption keys never leave your device, and the server operators cannot read your messages.
        </p>
        
        <h4 style={{ color: '#ff8f40' }}>Device Fingerprinting</h4>
        <p>
          Each device generates a unique fingerprint based on browser and system characteristics.
          This fingerprint helps detect when a user connects from a new device, providing an additional layer of security against impersonation.
        </p>
        
        <h4 style={{ color: '#ff8f40' }}>Trust Establishment</h4>
        <p>
          WhisperNet uses a mutual messaging model for trust establishment:
        </p>
        <ul>
          <li>When chatting with someone for the first time, a warning is displayed</li>
          <li>Full trust is only established after both users have sent messages to each other</li>
          <li>This prevents one-way spoofing attacks</li>
          <li>Once mutual messaging occurs, encryption keys are exchanged and stored locally</li>
        </ul>
      </div>
      
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ color: '#bae67e' }}>Message Flow</h3>
        <ol>
          <li>User composes a message to a recipient</li>
          <li>Client checks if the recipient is online</li>
          <li>If online, the message is encrypted and sent directly</li>
          <li>If offline, the message can be "bounced" (stored on a relay server)</li>
          <li>Bounced messages are stored for up to 4 hours</li>
          <li>When the recipient comes online, they receive any pending messages</li>
        </ol>
      </div>
      
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ color: '#bae67e' }}>Relay Assignment</h3>
        <p>
          When you connect to WhisperNet:
        </p>
        <ol>
          <li>Your client first connects to the Base Node</li>
          <li>The Base Node provides a list of available relay servers</li>
          <li>Your client connects to the most suitable relay</li>
          <li>If no relays are available, you remain connected to the Base Node</li>
          <li>Your client periodically checks for better relay options</li>
        </ol>
      </div>
      
      <div>
        <h3 style={{ color: '#bae67e' }}>Privacy Considerations</h3>
        <p>
          WhisperNet is designed with privacy in mind:
        </p>
        <ul>
          <li>Message contents are never visible to the servers</li>
          <li>Metadata (sender, recipient, timestamp) is visible to the relay servers</li>
          <li>Messages are automatically deleted from relays after 4 hours</li>
          <li>No logs of message content are kept on any server</li>
        </ul>
      </div>
    </div>
  );
};

export default AboutPage;