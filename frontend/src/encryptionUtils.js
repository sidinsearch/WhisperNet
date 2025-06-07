/**
 * WhisperNet Encryption Utilities
 * Provides end-to-end encryption for secure messaging
 */

// We'll use the Web Crypto API for strong encryption
const generateKeyPair = async () => {
  try {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      ["deriveKey", "deriveBits"]
    );
    
    // Export the public key for sharing
    const publicKeyExported = await window.crypto.subtle.exportKey(
      "spki",
      keyPair.publicKey
    );
    
    // Convert to base64 for easier transmission
    const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyExported)));
    
    return {
      keyPair,
      publicKeyBase64
    };
  } catch (error) {
    console.error('Error generating key pair:', error);
    throw error;
  }
};

// Import a public key from base64 format
const importPublicKey = async (publicKeyBase64) => {
  try {
    const binaryString = atob(publicKeyBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    return await window.crypto.subtle.importKey(
      "spki",
      bytes.buffer,
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      []
    );
  } catch (error) {
    console.error('Error importing public key:', error);
    throw error;
  }
};

// Derive a shared secret from our private key and their public key
const deriveSharedSecret = async (privateKey, publicKey) => {
  try {
    return await window.crypto.subtle.deriveBits(
      {
        name: "ECDH",
        public: publicKey
      },
      privateKey,
      256
    );
  } catch (error) {
    console.error('Error deriving shared secret:', error);
    throw error;
  }
};

// Generate an AES key from the shared secret
const deriveEncryptionKey = async (sharedSecret) => {
  try {
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      sharedSecret,
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );
    
    return await window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: new TextEncoder().encode("WhisperNetSalt"),
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  } catch (error) {
    console.error('Error deriving encryption key:', error);
    throw error;
  }
};

// Encrypt a message using the derived key
const encryptMessage = async (message, encryptionKey) => {
  try {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encodedMessage = new TextEncoder().encode(message);
    
    const encryptedData = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv
      },
      encryptionKey,
      encodedMessage
    );
    
    // Convert to base64 for transmission
    const encryptedBase64 = btoa(String.fromCharCode(...new Uint8Array(encryptedData)));
    const ivBase64 = btoa(String.fromCharCode(...iv));
    
    return {
      encryptedData: encryptedBase64,
      iv: ivBase64
    };
  } catch (error) {
    console.error('Error encrypting message:', error);
    throw error;
  }
};

// Decrypt a message using the derived key
const decryptMessage = async (encryptedBase64, ivBase64, encryptionKey) => {
  try {
    // Convert from base64
    const binaryEncrypted = atob(encryptedBase64);
    const encryptedBytes = new Uint8Array(binaryEncrypted.length);
    for (let i = 0; i < binaryEncrypted.length; i++) {
      encryptedBytes[i] = binaryEncrypted.charCodeAt(i);
    }
    
    const binaryIv = atob(ivBase64);
    const ivBytes = new Uint8Array(binaryIv.length);
    for (let i = 0; i < binaryIv.length; i++) {
      ivBytes[i] = binaryIv.charCodeAt(i);
    }
    
    const decryptedData = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ivBytes
      },
      encryptionKey,
      encryptedBytes
    );
    
    return new TextDecoder().decode(decryptedData);
  } catch (error) {
    console.error('Error decrypting message:', error);
    throw error;
  }
};

// Generate a device-specific encryption key based on device fingerprint
const generateDeviceKey = async (deviceId) => {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(deviceId);
    
    const hash = await window.crypto.subtle.digest('SHA-256', data);
    
    return await window.crypto.subtle.importKey(
      "raw",
      hash,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
  } catch (error) {
    console.error('Error generating device key:', error);
    throw error;
  }
};

// Create a simple shared key for users who haven't exchanged public keys yet
// This is less secure but allows for initial communication
const createTemporarySharedKey = async (username1, username2, deviceId) => {
  try {
    // Sort usernames to ensure the same key regardless of who initiates
    const sortedNames = [username1, username2].sort().join('_');
    const encoder = new TextEncoder();
    const data = encoder.encode(sortedNames + '_' + deviceId);
    
    const hash = await window.crypto.subtle.digest('SHA-256', data);
    
    return await window.crypto.subtle.importKey(
      "raw",
      hash,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
  } catch (error) {
    console.error('Error creating temporary shared key:', error);
    throw error;
  }
};

// Fallback encryption using a simple XOR cipher for environments without Web Crypto API
const fallbackEncrypt = (message, key) => {
  let result = '';
  for (let i = 0; i < message.length; i++) {
    result += String.fromCharCode(message.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(result); // Convert to base64
};

// Fallback decryption
const fallbackDecrypt = (encryptedBase64, key) => {
  try {
    const encrypted = atob(encryptedBase64); // Convert from base64
    let result = '';
    for (let i = 0; i < encrypted.length; i++) {
      result += String.fromCharCode(encrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  } catch (error) {
    console.error('Error in fallback decryption:', error);
    return '[Decryption Failed]';
  }
};

// Check if Web Crypto API is available
const isWebCryptoSupported = () => {
  return typeof window !== 'undefined' && 
         window.crypto && 
         window.crypto.subtle && 
         typeof window.crypto.subtle.generateKey === 'function';
};

// Export a public key to base64 format
const exportPublicKeyBase64 = async (publicKey) => {
  try {
    const exported = await window.crypto.subtle.exportKey("spki", publicKey);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
  } catch (error) {
    console.error('Error exporting public key to base64:', error);
    throw error;
  }
};

// Export a key to JWK format
const exportKeyToJwk = async (key) => {
  try {
    return await window.crypto.subtle.exportKey("jwk", key);
  } catch (error) {
    console.error('Error exporting key to JWK:', error);
    throw error;
  }
};

// Import a private key from JWK format
const importPrivateKey = async (privateKeyJwk) => {
  try {
    return await window.crypto.subtle.importKey(
      "jwk",
      privateKeyJwk,
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      ["deriveKey", "deriveBits"]
    );
  } catch (error) {
    console.error('Error importing private key:', error);
    throw error;
  }
};

export {
  generateKeyPair,
  importPublicKey,
  importPrivateKey,
  deriveSharedSecret,
  deriveEncryptionKey,
  encryptMessage,
  decryptMessage,
  generateDeviceKey,
  createTemporarySharedKey,
  fallbackEncrypt,
  fallbackDecrypt,
  isWebCryptoSupported,
  exportPublicKeyBase64,
  exportKeyToJwk
};
