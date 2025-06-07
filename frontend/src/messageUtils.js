/**
 * WhisperNet Message Utilities
 * Handles message persistence, offline relay, and message tracking
 */

// Generate a unique message ID
const generateMessageId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
};

// Calculate message TTL (Time To Live) in milliseconds
// Default: 4 hours = 14400000 ms
const calculateMessageTTL = (hours = 4) => {
  return Date.now() + (hours * 60 * 60 * 1000);
};

// Alias for calculateMessageTTL for backward compatibility
const calculateTTL = calculateMessageTTL;

// Check if a message has expired
const isMessageExpired = (ttl) => {
  return Date.now() > ttl;
};

// Create a relay message with all necessary metadata
const createRelayMessage = (from, to, content, deviceId, encryptedContent, iv) => {
  return {
    id: generateMessageId(),
    from,
    to,
    content: content || null, // Plain content (if not encrypted)
    fromDeviceId: deviceId,
    timestamp: new Date().toISOString(),
    ttl: calculateMessageTTL(),
    encrypted: !!encryptedContent,
    encryptedContent,
    iv,
    delivered: false,
    bounceCount: 0,
    maxBounces: 10 // Maximum number of relay hops
  };
};

// Store pending messages locally
const storePendingMessage = (message) => {
  try {
    const pendingMessages = getPendingMessages();
    pendingMessages.push(message);
    localStorage.setItem('whisperNetPendingMessages', JSON.stringify(pendingMessages));
    return true;
  } catch (error) {
    console.error('Error storing pending message:', error);
    return false;
  }
};

// Get all pending messages
const getPendingMessages = () => {
  try {
    const messages = localStorage.getItem('whisperNetPendingMessages');
    return messages ? JSON.parse(messages) : [];
  } catch (error) {
    console.error('Error retrieving pending messages:', error);
    return [];
  }
};

// Remove a pending message by ID
const removePendingMessage = (messageId) => {
  try {
    const pendingMessages = getPendingMessages();
    const updatedMessages = pendingMessages.filter(msg => msg.id !== messageId);
    localStorage.setItem('whisperNetPendingMessages', JSON.stringify(updatedMessages));
    return true;
  } catch (error) {
    console.error('Error removing pending message:', error);
    return false;
  }
};

// Clean up expired messages
const cleanupExpiredMessages = () => {
  try {
    const pendingMessages = getPendingMessages();
    const validMessages = pendingMessages.filter(msg => !isMessageExpired(msg.ttl));
    
    if (validMessages.length !== pendingMessages.length) {
      localStorage.setItem('whisperNetPendingMessages', JSON.stringify(validMessages));
      console.log(`Cleaned up ${pendingMessages.length - validMessages.length} expired messages`);
    }
    
    return validMessages;
  } catch (error) {
    console.error('Error cleaning up expired messages:', error);
    return [];
  }
};

// Track message delivery status
const trackMessageDelivery = (messageId, status) => {
  try {
    const pendingMessages = getPendingMessages();
    const updatedMessages = pendingMessages.map(msg => {
      if (msg.id === messageId) {
        return { ...msg, delivered: status };
      }
      return msg;
    });
    
    localStorage.setItem('whisperNetPendingMessages', JSON.stringify(updatedMessages));
    return true;
  } catch (error) {
    console.error('Error tracking message delivery:', error);
    return false;
  }
};

// Increment bounce count for a message
const incrementBounceCount = (messageId) => {
  try {
    const pendingMessages = getPendingMessages();
    const message = pendingMessages.find(msg => msg.id === messageId);
    
    if (!message) return false;
    
    if (message.bounceCount >= message.maxBounces) {
      // Message has reached max bounces, mark for removal
      removePendingMessage(messageId);
      return false;
    }
    
    const updatedMessages = pendingMessages.map(msg => {
      if (msg.id === messageId) {
        return { ...msg, bounceCount: msg.bounceCount + 1 };
      }
      return msg;
    });
    
    localStorage.setItem('whisperNetPendingMessages', JSON.stringify(updatedMessages));
    return true;
  } catch (error) {
    console.error('Error incrementing bounce count:', error);
    return false;
  }
};

// Store known device IDs for usernames
const storeKnownDevice = (username, deviceId) => {
  try {
    const knownDevices = getKnownDevices();
    
    if (!knownDevices[username]) {
      knownDevices[username] = [];
    }
    
    // Only add if not already known
    if (!knownDevices[username].includes(deviceId)) {
      knownDevices[username].push(deviceId);
    }
    
    localStorage.setItem('whisperNetKnownDevices', JSON.stringify(knownDevices));
    return true;
  } catch (error) {
    console.error('Error storing known device:', error);
    return false;
  }
};

// Get all known devices
const getKnownDevices = () => {
  try {
    const devices = localStorage.getItem('whisperNetKnownDevices');
    return devices ? JSON.parse(devices) : {};
  } catch (error) {
    console.error('Error retrieving known devices:', error);
    return {};
  }
};

// Check if a device is known for a username
const isKnownDevice = (username, deviceId) => {
  try {
    const knownDevices = getKnownDevices();
    return knownDevices[username] && knownDevices[username].includes(deviceId);
  } catch (error) {
    console.error('Error checking known device:', error);
    return false;
  }
};

// Store encryption keys for contacts
const storeContactKey = (username, publicKey) => {
  try {
    const contactKeys = getContactKeys();
    contactKeys[username] = publicKey;
    localStorage.setItem('whisperNetContactKeys', JSON.stringify(contactKeys));
    return true;
  } catch (error) {
    console.error('Error storing contact key:', error);
    return false;
  }
};

// Get all contact encryption keys
const getContactKeys = () => {
  try {
    const keys = localStorage.getItem('whisperNetContactKeys');
    return keys ? JSON.parse(keys) : {};
  } catch (error) {
    console.error('Error retrieving contact keys:', error);
    return {};
  }
};

// Get a specific contact's encryption key
const getContactKey = (username) => {
  try {
    const contactKeys = getContactKeys();
    return contactKeys[username] || null;
  } catch (error) {
    console.error('Error getting contact key:', error);
    return null;
  }
};

// Send message to recipient via relay
const sendMessage = async (message, relayUrl) => {
  try {
    const response = await axios.post(`${relayUrl}/message`, message, {
      timeout: 5000
    });
    
    if (response.status === 200) {
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error sending message:', error);
    return false;
  }
};

export {
  generateMessageId,
  calculateMessageTTL,
  calculateTTL,
  isMessageExpired,
  createRelayMessage,
  storePendingMessage,
  getPendingMessages,
  removePendingMessage,
  cleanupExpiredMessages,
  trackMessageDelivery,
  incrementBounceCount,
  storeKnownDevice,
  getKnownDevices,
  isKnownDevice,
  storeContactKey,
  getContactKeys,
  getContactKey,
  sendMessage
};
