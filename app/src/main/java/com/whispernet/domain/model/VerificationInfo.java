package com.whispernet.domain.model;

public class VerificationInfo {
    public String status;              // "new_contact" | "key_mismatch" | "device_changed" | "verified"
    public String message;
    public String contactUsername;
    public String fingerprint;
    public String previousFingerprint;
    public Long verifiedAt;

    public boolean isWarning() {
        return "key_mismatch".equals(status) || "device_changed".equals(status);
    }

    public boolean isNewContact() {
        return "new_contact".equals(status);
    }
    public boolean isVerified() {
        return "verified".equals(status);
    }
}