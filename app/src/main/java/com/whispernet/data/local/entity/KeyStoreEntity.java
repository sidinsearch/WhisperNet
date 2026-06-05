package com.whispernet.data.local.entity;

import androidx.room.Entity;
import androidx.room.PrimaryKey;
import androidx.annotation.NonNull;

@Entity(tableName = "key_store")
public class KeyStoreEntity {

    @PrimaryKey
    @NonNull
    public String id;           // ownerUsername + "_" + contactUsername

    public String ownerUsername;
    public String contactUsername;
    public String publicKeyBase64;
    public String deviceId;
    public String fingerprint;
    public long verifiedAt;

    public KeyStoreEntity(@NonNull String id, String ownerUsername, String contactUsername,
                          String publicKeyBase64, String deviceId, String fingerprint, long verifiedAt) {
        this.id = id;
        this.ownerUsername = ownerUsername;
        this.contactUsername = contactUsername;
        this.publicKeyBase64 = publicKeyBase64;
        this.deviceId = deviceId;
        this.fingerprint = fingerprint;
        this.verifiedAt = verifiedAt;
    }

    public static String buildId(String ownerUsername, String contactUsername) {
        return ownerUsername + "_" + contactUsername;
    }
}