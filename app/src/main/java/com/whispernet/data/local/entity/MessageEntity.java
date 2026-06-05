package com.whispernet.data.local.entity;

import androidx.annotation.NonNull;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "messages")
public class MessageEntity {

    @PrimaryKey
    @NonNull
    public String id;   // UUID

    @ColumnInfo(name = "ownerUsername")
    public String ownerUsername;

    public String chatId;

    @ColumnInfo(name = "sender")
    public String from;

    @ColumnInfo(name = "receiver")
    public String to;

    public String content;

    public long timestamp;

    public boolean encrypted;

    // sent | delivered | bounced | failed_decrypt
    public String status;

    public boolean relayed;

    public MessageEntity(
            @NonNull String id,
            String ownerUsername,
            String chatId,
            String from,
            String to,
            String content,
            long timestamp,
            boolean encrypted,
            String status,
            boolean relayed
    ) {
        this.id = id;
        this.ownerUsername = ownerUsername;
        this.chatId = chatId;
        this.from = from;
        this.to = to;
        this.content = content;
        this.timestamp = timestamp;
        this.encrypted = encrypted;
        this.status = status;
        this.relayed = relayed;
    }
}
