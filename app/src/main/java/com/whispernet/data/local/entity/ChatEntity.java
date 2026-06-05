package com.whispernet.data.local.entity;

import androidx.room.Entity;
import androidx.room.PrimaryKey;
import androidx.annotation.NonNull;

@Entity(tableName = "chats")
public class ChatEntity {

    @PrimaryKey
    @NonNull
    public String chatId;       // "ownerUser_contactUser"

    public String ownerUsername;
    public String contactUsername;
    public int unreadCount;
    public long lastMessageTime;

    public ChatEntity(@NonNull String chatId, String ownerUsername, String contactUsername,
                      int unreadCount, long lastMessageTime) {
        this.chatId = chatId;
        this.ownerUsername = ownerUsername;
        this.contactUsername = contactUsername;
        this.unreadCount = unreadCount;
        this.lastMessageTime = lastMessageTime;
    }

    public static String buildChatId(String user1, String user2) {
        // Always the same regardless of order
        String[] sorted = { user1, user2 };
        java.util.Arrays.sort(sorted);
        return sorted[0] + "_" + sorted[1];
    }
}