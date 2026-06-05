package com.whispernet.data.local.dao;

import androidx.lifecycle.LiveData;
import androidx.room.*;
import com.whispernet.data.local.entity.ChatEntity;
import java.util.List;

@Dao
public interface ChatDao {

    @Query("SELECT * FROM chats WHERE ownerUsername = :owner ORDER BY lastMessageTime DESC")
    LiveData<List<ChatEntity>> getChats(String owner);

    @Query("SELECT * FROM chats WHERE chatId = :chatId LIMIT 1")
    ChatEntity getChat(String chatId);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insertChat(ChatEntity chat);

    @Query("UPDATE chats SET unreadCount = :count WHERE chatId = :chatId")
    void updateUnreadCount(String chatId, int count);

    @Query("UPDATE chats SET lastMessageTime = :time WHERE chatId = :chatId")
    void updateLastMessageTime(String chatId, long time);

    @Query("DELETE FROM chats WHERE chatId = :chatId")
    void deleteChat(String chatId);

    @Query("DELETE FROM chats WHERE ownerUsername = :owner")
    void deleteAllForUser(String owner);
}