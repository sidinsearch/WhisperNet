package com.whispernet.data.local.dao;

import androidx.lifecycle.LiveData;
import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

import com.whispernet.data.local.entity.MessageEntity;

import java.util.List;

@Dao
public interface MessageDao {

    @Query(
            "SELECT * FROM messages " +
                    "WHERE ownerUsername = :ownerUsername " +
                    "AND chatId = :chatId " +
                    "ORDER BY timestamp ASC"
    )
    LiveData<List<MessageEntity>> getMessages(
            String ownerUsername,
            String chatId
    );

    @Query(
            "SELECT * FROM messages " +
                    "WHERE chatId = :chatId " +
                    "ORDER BY timestamp DESC LIMIT 1"
    )
    MessageEntity getLastMessage(String chatId);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insertMessage(MessageEntity message);

    @Query("DELETE FROM messages WHERE chatId = :chatId")
    void deleteChat(String chatId);

    @Query("DELETE FROM messages")
    void deleteAll();

    // =========================================================================
    // Message status updates
    // =========================================================================

    @Query(
            "UPDATE messages " +
                    "SET status = :newStatus " +
                    "WHERE id = :messageId"
    )
    void updateStatus(
            String messageId,
            String newStatus
    );

    // =========================================================================
    // Delete all messages for a specific logged-in user
    // =========================================================================

    @Query(
            "DELETE FROM messages " +
                    "WHERE ownerUsername = :ownerUsername"
    )
    void deleteAllForUser(String ownerUsername);
}
