package com.whispernet.domain.crypto;

import android.util.Base64;
import java.security.*;
import java.security.spec.*;
import javax.crypto.Cipher;
import java.security.MessageDigest;

public class CryptoManager {

    private static final String ALGORITHM     = "RSA";
    private static final String TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding";
    private static final int KEY_SIZE         = 2048;

    // Generate a new RSA key pair
    public static KeyPair generateKeyPair() throws NoSuchAlgorithmException {
        KeyPairGenerator keyGen = KeyPairGenerator.getInstance(ALGORITHM);
        keyGen.initialize(KEY_SIZE);
        return keyGen.generateKeyPair();
    }

    // Export PublicKey → Base64 string
    public static String publicKeyToBase64(PublicKey publicKey) {
        return Base64.encodeToString(publicKey.getEncoded(), Base64.NO_WRAP);
    }

    // Export PrivateKey → Base64 string
    public static String privateKeyToBase64(PrivateKey privateKey) {
        return Base64.encodeToString(privateKey.getEncoded(), Base64.NO_WRAP);
    }

    // Import PublicKey from Base64
    public static PublicKey publicKeyFromBase64(String base64) throws Exception {
        byte[] keyBytes = Base64.decode(base64, Base64.NO_WRAP);
        X509EncodedKeySpec spec = new X509EncodedKeySpec(keyBytes);
        KeyFactory factory = KeyFactory.getInstance(ALGORITHM);
        return factory.generatePublic(spec);
    }

    // Import PrivateKey from Base64
    public static PrivateKey privateKeyFromBase64(String base64) throws Exception {
        byte[] keyBytes = Base64.decode(base64, Base64.NO_WRAP);
        PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(keyBytes);
        KeyFactory factory = KeyFactory.getInstance(ALGORITHM);
        return factory.generatePrivate(spec);
    }

    // Encrypt message with recipient's public key
    public static String encrypt(String plaintext, PublicKey publicKey) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, publicKey);
        byte[] encryptedBytes = cipher.doFinal(plaintext.getBytes("UTF-8"));
        return Base64.encodeToString(encryptedBytes, Base64.NO_WRAP);
    }

    // Encrypt using Base64 public key string
    public static String encrypt(String plaintext, String publicKeyBase64) throws Exception {
        PublicKey publicKey = publicKeyFromBase64(publicKeyBase64);
        return encrypt(plaintext, publicKey);
    }

    // Decrypt message with our private key
    public static String decrypt(String encryptedBase64, PrivateKey privateKey) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, privateKey);
        byte[] encryptedBytes = Base64.decode(encryptedBase64, Base64.NO_WRAP);
        byte[] decryptedBytes = cipher.doFinal(encryptedBytes);
        return new String(decryptedBytes, "UTF-8");
    }

    // Decrypt using Base64 private key string
    public static String decrypt(String encryptedBase64, String privateKeyBase64) {
        try {
            PrivateKey privateKey = privateKeyFromBase64(privateKeyBase64);
            return decrypt(encryptedBase64, privateKey);
        } catch (Exception e) {
            return null; // decryption failed
        }
    }

    // Generate a short fingerprint (16 hex chars) from a public key
    // Mirrors keyVerification.js generateKeyFingerprint()
    public static String generateFingerprint(String publicKeyBase64) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(publicKeyBase64.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 8; i++) { // first 8 bytes = 16 hex chars
                sb.append(String.format("%02x", hash[i]));
            }
            return sb.toString();
        } catch (Exception e) {
            return Long.toHexString(System.currentTimeMillis()).substring(0, 16);
        }
    }
}