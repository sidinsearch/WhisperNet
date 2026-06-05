package com.whispernet.domain.model;

/**
 * Domain model representing another user as seen in the contacts/online-users list.
 * Mirrors the shape of objects produced by 'onlineUsersUpdate' and 'userStatusUpdate'
 * socket events in the web app.
 */
public class User {

    /** The user's chosen username (their unique identity on the network) */
    public String username;

    /** Whether this user is currently online (connected to a relay / base node) */
    public boolean online;

    /**
     * The user's RSA public key in Base64-encoded X.509 / JWK format.
     * Populated the first time we receive a message from them, or via
     * a 'publicKeyRequest' acknowledgement.
     * May be null until we receive their first message.
     */
    public String publicKeyBase64;

    /** Device ID reported by this user's client (used for key-change detection) */
    public String deviceId;

    // -------------------------------------------------------------------------
    // Constructors
    // -------------------------------------------------------------------------

    public User() {}

    public User(String username, boolean online) {
        this.username = username;
        this.online = online;
    }

    public User(String username, boolean online, String publicKeyBase64, String deviceId) {
        this.username = username;
        this.online = online;
        this.publicKeyBase64 = publicKeyBase64;
        this.deviceId = deviceId;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /** Returns the first character of the username, upper-cased, for avatar display */
    public String avatarLetter() {
        if (username == null || username.isEmpty()) return "?";
        return String.valueOf(Character.toUpperCase(username.charAt(0)));
    }

    public boolean hasPublicKey() {
        return publicKeyBase64 != null && !publicKeyBase64.isEmpty();
    }

    @Override
    public String toString() {
        return "User{username='" + username + "', online=" + online + "}";
    }
}