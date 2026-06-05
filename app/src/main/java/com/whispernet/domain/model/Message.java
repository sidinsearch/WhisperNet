package com.whispernet.domain.model;

/**
 * Domain model for a chat message.
 * Mirrors the message object shape used throughout App.js:
 *   { from, to, message, timestamp, fromDeviceId, encrypted, decryptionStatus, bounced, relayed }
 */
public class Message {

    // Status constants — mirrors the web app's decryptionStatus / status values
    public static final String STATUS_SENT            = "sent";
    public static final String STATUS_BOUNCED         = "bounced";       // queued in relay, not yet delivered
    public static final String STATUS_DELIVERED       = "delivered";     // was bounced, now delivered
    public static final String STATUS_FAILED_DECRYPT  = "failed_decrypt";
    public static final String STATUS_PLAINTEXT       = "plaintext";
    public static final String STATUS_DECRYPTED       = "decrypted";

    /** Unique message ID (UUID generated locally on insert) */
    public String id;

    /** Username of the sender */
    public String from;

    /** Username of the recipient */
    public String to;

    /** The actual message content (already decrypted when stored) */
    public String content;

    /** Unix epoch timestamp in milliseconds */
    public long timestamp;

    /** Device ID of the sender */
    public String fromDeviceId;

    /** Whether the message was sent over the wire in encrypted form */
    public boolean encrypted;

    /**
     * Decryption / delivery status.
     * One of: STATUS_SENT, STATUS_BOUNCED, STATUS_DELIVERED,
     *         STATUS_FAILED_DECRYPT, STATUS_PLAINTEXT, STATUS_DECRYPTED
     */
    public String status;

    /** True if this message was queued in the relay and bounced back on recipient connect */
    public boolean bounced;

    /** True if WE sent this via the Relay button (stored locally before ACK) */
    public boolean relayed;

    // -------------------------------------------------------------------------
    // Constructors
    // -------------------------------------------------------------------------

    public Message() {}

    /** Full constructor used when inserting a new outgoing message */
    public Message(String id, String from, String to, String content, long timestamp,
                   String fromDeviceId, boolean encrypted, String status,
                   boolean bounced, boolean relayed) {
        this.id = id;
        this.from = from;
        this.to = to;
        this.content = content;
        this.timestamp = timestamp;
        this.fromDeviceId = fromDeviceId;
        this.encrypted = encrypted;
        this.status = status;
        this.bounced = bounced;
        this.relayed = relayed;
    }

    // -------------------------------------------------------------------------
    // Helper factories
    // -------------------------------------------------------------------------

    /** Build a sent message (before server ACK) */
    public static Message outgoing(String id, String from, String to, String content,
                                   String fromDeviceId, boolean encrypted) {
        return new Message(id, from, to, content, System.currentTimeMillis(),
                fromDeviceId, encrypted, STATUS_SENT, false, false);
    }

    /** Build a relayed outgoing message */
    public static Message outgoingRelay(String id, String from, String to, String content,
                                        String fromDeviceId, boolean encrypted) {
        return new Message(id, from, to, content, System.currentTimeMillis(),
                fromDeviceId, encrypted, STATUS_BOUNCED, false, true);
    }

    /** Build a received message from raw socket data */
    public static Message incoming(String id, String from, String to, String content,
                                   long timestamp, String fromDeviceId, boolean encrypted,
                                   String decryptionStatus, boolean bounced) {
        String status;
        if (STATUS_FAILED_DECRYPT.equals(decryptionStatus)) {
            status = STATUS_FAILED_DECRYPT;
        } else if (bounced) {
            status = STATUS_DELIVERED;
        } else {
            status = decryptionStatus != null ? decryptionStatus : STATUS_PLAINTEXT;
        }
        return new Message(id, from, to, content, timestamp,
                fromDeviceId, encrypted, status, bounced, false);
    }

    // -------------------------------------------------------------------------
    // Convenience
    // -------------------------------------------------------------------------

    public boolean isDecryptionFailed() {
        return STATUS_FAILED_DECRYPT.equals(status);
    }

    public boolean isBounced() {
        return STATUS_BOUNCED.equals(status);
    }

    public boolean isDeliveredAfterBounce() {
        return STATUS_DELIVERED.equals(status) || bounced;
    }
}