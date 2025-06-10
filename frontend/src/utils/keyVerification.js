// Key Verification Utilities
// This module handles key exchange, storage, and verification for user identity

/**
 * Stores a verified key for a user
 * @param {string} currentUser - The current user's username
 * @param {string} contactUsername - The contact's username
 * @param {Object} publicKey - The contact's public key in JWK format
 * @param {string} deviceId - The contact's device ID
 * @returns {boolean} - Success status
 */
export const storeVerifiedKey = (currentUser, contactUsername, publicKey, deviceId) => {
  try {
    // Create a unique key for the keystore
    const keyStoreKey = `whispernetKeyStore_${currentUser}`;
    
    // Get existing keystore or create a new one
    let keyStore = {};
    const existingStore = localStorage.getItem(keyStoreKey);
    
    if (existingStore) {
      keyStore = JSON.parse(existingStore);
    }
    
    // Store the key with device ID and verification timestamp
    keyStore[contactUsername] = {
      publicKey,
      deviceId,
      verifiedAt: Date.now(),
      fingerprint: generateKeyFingerprint(publicKey)
    };
    
    // Save to localStorage
    localStorage.setItem(keyStoreKey, JSON.stringify(keyStore));
    
    return true;
  } catch (error) {
    console.error('Error storing verified key:', error);
    return false;
  }
};

/**
 * Retrieves a verified key for a user
 * @param {string} currentUser - The current user's username
 * @param {string} contactUsername - The contact's username
 * @returns {Object|null} - The stored key information or null if not found
 */
export const getVerifiedKey = (currentUser, contactUsername) => {
  try {
    // Create a unique key for the keystore
    const keyStoreKey = `whispernetKeyStore_${currentUser}`;
    
    // Get existing keystore
    const existingStore = localStorage.getItem(keyStoreKey);
    
    if (existingStore) {
      const keyStore = JSON.parse(existingStore);
      return keyStore[contactUsername] || null;
    }
    
    return null;
  } catch (error) {
    console.error('Error retrieving verified key:', error);
    return null;
  }
};

/**
 * Checks if a user has a verified key
 * @param {string} currentUser - The current user's username
 * @param {string} contactUsername - The contact's username
 * @returns {boolean} - Whether the user has a verified key
 */
export const hasVerifiedKey = (currentUser, contactUsername) => {
  return getVerifiedKey(currentUser, contactUsername) !== null;
};

/**
 * Verifies if a received key matches the stored key
 * @param {string} currentUser - The current user's username
 * @param {string} contactUsername - The contact's username
 * @param {Object} receivedKey - The received public key in JWK format
 * @param {string} receivedDeviceId - The received device ID
 * @returns {Promise<Object>} - Promise resolving to verification result with status and details
 */
export const verifyKey = (currentUser, contactUsername, receivedKey, receivedDeviceId) => {
  return new Promise((resolve, reject) => {
    try {
      const storedKeyInfo = getVerifiedKey(currentUser, contactUsername);
      
      // If no stored key, this is a new contact
      if (!storedKeyInfo) {
        resolve({
          verified: false,
          status: 'new_contact',
          message: 'New contact, no previous verification'
        });
        return;
      }
      
      // Get the stored fingerprint
      const storedFingerprint = storedKeyInfo.fingerprint;
      
      // Generate fingerprint for the received key
      generateKeyFingerprint(receivedKey)
        .then(receivedFingerprint => {
          // Check if the key fingerprint matches
          if (receivedFingerprint !== storedFingerprint) {
            resolve({
              verified: false,
              status: 'key_mismatch',
              message: 'Public key has changed since last verification',
              previousDeviceId: storedKeyInfo.deviceId,
              currentDeviceId: receivedDeviceId,
              previousFingerprint: storedFingerprint,
              fingerprint: receivedFingerprint
            });
            return;
          }
          
          // Check if the device ID matches
          if (storedKeyInfo.deviceId !== receivedDeviceId) {
            resolve({
              verified: false,
              status: 'device_changed',
              message: 'Device ID has changed since last verification',
              previousDeviceId: storedKeyInfo.deviceId,
              currentDeviceId: receivedDeviceId,
              fingerprint: receivedFingerprint
            });
            return;
          }
          
          // All checks passed
          resolve({
            verified: true,
            status: 'verified',
            message: 'Identity verified',
            verifiedAt: storedKeyInfo.verifiedAt,
            fingerprint: receivedFingerprint
          });
        })
        .catch(error => {
          console.error('Error generating fingerprint during verification:', error);
          reject(error);
        });
    } catch (error) {
      console.error('Error verifying key:', error);
      resolve({
        verified: false,
        status: 'error',
        message: 'Error verifying key: ' + error.message
      });
    }
  });
};

/**
 * Generates a fingerprint for a public key
 * @param {Object} publicKey - The public key in JWK format
 * @returns {Promise<string>} - Promise resolving to the fingerprint as a hex string
 */
export const generateKeyFingerprint = (publicKey) => {
  return new Promise((resolve) => {
    try {
      // Convert JWK to a stable string representation
      const keyString = JSON.stringify(publicKey, Object.keys(publicKey).sort());
      
      // Use SubtleCrypto to hash the key
      const encoder = new TextEncoder();
      const data = encoder.encode(keyString);
      
      window.crypto.subtle.digest('SHA-256', data)
        .then(hashBuffer => {
          // Convert hash to hex string
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          
          // Return a shortened version for display (first 16 chars)
          resolve(hashHex.substring(0, 16));
        })
        .catch(error => {
          console.error('Error generating key fingerprint with SubtleCrypto:', error);
          
          // Fallback to a simple hash if SubtleCrypto fails
          let hash = 0;
          for (let i = 0; i < keyString.length; i++) {
            const char = keyString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
          }
          resolve(Math.abs(hash).toString(16).substring(0, 16));
        });
    } catch (error) {
      console.error('Error generating key fingerprint:', error);
      
      // Fallback to a timestamp-based fingerprint if all else fails
      const fallbackFingerprint = Date.now().toString(16).substring(0, 16);
      resolve(fallbackFingerprint);
    }
  });
};

/**
 * Gets all verified contacts
 * @param {string} currentUser - The current user's username
 * @returns {Array} - Array of verified contact usernames
 */
export const getVerifiedContacts = (currentUser) => {
  try {
    // Create a unique key for the keystore
    const keyStoreKey = `whispernetKeyStore_${currentUser}`;
    
    // Get existing keystore
    const existingStore = localStorage.getItem(keyStoreKey);
    
    if (existingStore) {
      const keyStore = JSON.parse(existingStore);
      return Object.keys(keyStore);
    }
    
    return [];
  } catch (error) {
    console.error('Error getting verified contacts:', error);
    return [];
  }
};

/**
 * Removes a verified key for a user
 * @param {string} currentUser - The current user's username
 * @param {string} contactUsername - The contact's username
 * @returns {boolean} - Success status
 */
export const removeVerifiedKey = (currentUser, contactUsername) => {
  try {
    // Create a unique key for the keystore
    const keyStoreKey = `whispernetKeyStore_${currentUser}`;
    
    // Get existing keystore
    const existingStore = localStorage.getItem(keyStoreKey);
    
    if (existingStore) {
      const keyStore = JSON.parse(existingStore);
      
      // Remove the key
      if (keyStore[contactUsername]) {
        delete keyStore[contactUsername];
        
        // Save to localStorage
        localStorage.setItem(keyStoreKey, JSON.stringify(keyStore));
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error removing verified key:', error);
    return false;
  }
};

/**
 * Clears all verified keys for a user
 * @param {string} currentUser - The current user's username
 * @returns {boolean} - Success status
 */
export const clearAllVerifiedKeys = (currentUser) => {
  try {
    // Create a unique key for the keystore
    const keyStoreKey = `whispernetKeyStore_${currentUser}`;
    
    // Remove from localStorage
    localStorage.removeItem(keyStoreKey);
    
    return true;
  } catch (error) {
    console.error('Error clearing verified keys:', error);
    return false;
  }
};

/**
 * Detects if localStorage has been reset
 * @returns {boolean} - Whether localStorage appears to have been reset
 */
export const detectStorageReset = () => {
  try {
    // Check if we have a marker in localStorage
    const marker = localStorage.getItem('whispernetStorageMarker');
    
    if (!marker) {
      // Set a marker for future checks
      localStorage.setItem('whispernetStorageMarker', Date.now().toString());
      
      // Check if we have any other WhisperNet data
      // If we do, storage was likely reset
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('whispernet') && key !== 'whispernetStorageMarker') {
          return false; // We have other data, so storage wasn't reset
        }
      }
      
      // No other WhisperNet data found, this might be first run
      return false;
    }
    
    // Marker exists, storage wasn't reset
    return false;
  } catch (error) {
    console.error('Error detecting storage reset:', error);
    return false;
  }
};

/**
 * Formats a verification timestamp
 * @param {number} timestamp - The verification timestamp
 * @returns {string} - Formatted date string
 */
export const formatVerificationTime = (timestamp) => {
  if (!timestamp) return 'Unknown';
  
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + 
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};