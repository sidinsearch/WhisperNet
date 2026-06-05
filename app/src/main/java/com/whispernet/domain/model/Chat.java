package com.whispernet.domain.model;

public class Chat {
    public String contactUsername;
    public String lastMessage;
    public long lastMessageTime;
    public int unreadCount;
    public boolean isOnline;

    public Chat(String contactUsername, String lastMessage, long lastMessageTime,
                int unreadCount, boolean isOnline) {
        this.contactUsername = contactUsername;
        this.lastMessage = lastMessage;
        this.lastMessageTime = lastMessageTime;
        this.unreadCount = unreadCount;
        this.isOnline = isOnline;
    }
}