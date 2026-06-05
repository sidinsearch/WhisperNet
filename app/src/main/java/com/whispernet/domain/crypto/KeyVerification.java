package com.whispernet.domain.crypto;

import com.whispernet.data.local.entity.KeyStoreEntity;

// Direct port of keyVerification.js
public class KeyVerification {

    public static class VerificationResult {
        public final boolean verified;
        public final String status;
        public final String message;
        public final String fingerprint;
        public final String previousFingerprint;
        public final Long verifiedAt;

        public VerificationResult(boolean verified, String status, String message,
                                  String fingerprint, String previousFingerprint, Long verifiedAt) {
            this.verified = verified;
            this.status = status;
            this.message = message;
            this.fingerprint = fingerprint;
            this.previousFingerprint = previousFingerprint;
            this.verifiedAt = verifiedAt;
        }
    }

    public static VerificationResult verifyKey(
            KeyStoreEntity storedKey,
            String receivedPublicKeyBase64,
            String receivedDeviceId) {

        String receivedFingerprint = CryptoManager.generateFingerprint(receivedPublicKeyBase64);

        // New contact — no previous key stored
        if (storedKey == null) {
            return new VerificationResult(
                    false, "new_contact",
                    "New contact, no previous verification",
                    receivedFingerprint, null, null
            );
        }

        // Key mismatch — fingerprint changed
        if (!receivedFingerprint.equals(storedKey.fingerprint)) {
            return new VerificationResult(
                    false, "key_mismatch",
                    "Public key has changed since last verification",
                    receivedFingerprint, storedKey.fingerprint, null
            );
        }

        // Device changed — same key but different device
        if (!storedKey.deviceId.equals(receivedDeviceId)) {
            return new VerificationResult(
                    false, "device_changed",
                    "Device ID has changed since last verification",
                    receivedFingerprint, null, null
            );
        }

        // All checks passed
        return new VerificationResult(
                true, "verified",
                "Identity verified",
                receivedFingerprint, null, storedKey.verifiedAt
        );
    }
}