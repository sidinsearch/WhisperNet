package com.whispernet.data.repository;

import android.os.Handler;
import android.os.Looper;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import com.whispernet.data.local.AppDatabase;
import com.whispernet.data.local.dao.ChatDao;
import com.whispernet.data.local.dao.MessageDao;
import com.whispernet.data.local.entity.ChatEntity;
import com.whispernet.data.local.entity.MessageEntity;
import com.whispernet.domain.model.Chat;
import com.whispernet.domain.model.Message;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * ChatRepository — single source of truth for all chat and message data.
 *
 * Mirrors the full behaviour of chatStorage.js:
 *   saveChatHistory / loadChatHistory / getActiveChats / clearAllChatHistory /
 *   saveUnreadCounts / loadUnreadCounts / resetUnreadCount / incrementUnreadCount
 *
 * All DB operations run on a background executor; results are posted back to the
 * main thread via LiveData or a callback Handler so ViewModels never block the UI.
 */
public class ChatRepository {

    private final MessageDao messageDao;
    private final ChatDao chatDao;
    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    public ChatRepository(AppDatabase db) {
        this.messageDao = db.messageDao();
        this.chatDao    = db.chatDao();
    }

    // =========================================================================
    // MESSAGES — mirrors chatStorage.saveChatHistory / loadChatHistory
    // =========================================================================

    /**
     * Observe all messages for a chat in real time (LiveData).
     * The chatId is deterministic: always sorted(user1, user2) joined by "_".
     */
    public LiveData<List<MessageEntity>> getMessagesLive(
            String ownerUsername,
            String contactUsername) {

        String chatId =
                ChatEntity.buildChatId(
                        ownerUsername,
                        contactUsername);

        return messageDao.getMessages(
                ownerUsername,
                chatId
        );
    }

    /**
     * Insert a new message into the DB (background thread).
     * Also updates the parent ChatEntity's lastMessageTime.
     *
     * @param ownerUsername  the logged-in user
     * @param msg            domain Message object to persist
     */
    public void saveMessage(String ownerUsername, Message msg) {
        executor.execute(() -> {
            String chatId = ChatEntity.buildChatId(ownerUsername,
                    msg.from.equals(ownerUsername) ? msg.to : msg.from);

            // Build entity
            MessageEntity entity = new MessageEntity(
                    msg.id != null ? msg.id : UUID.randomUUID().toString(),
                    ownerUsername,
                    chatId,
                    msg.from,
                    msg.to,
                    msg.content,
                    msg.timestamp,
                    msg.encrypted,
                    msg.status,
                    msg.relayed
            );
            messageDao.insertMessage(entity);

            // Keep the parent chat row up to date
            String contactUsername = msg.from.equals(ownerUsername) ? msg.to : msg.from;
            ensureChatExists(ownerUsername, contactUsername, chatId);
            chatDao.updateLastMessageTime(chatId, msg.timestamp);
        });
    }

    /**
     * Delete all messages for a specific chat (mirrors clearChatHistory).
     */
    public void clearChat(String ownerUsername, String contactUsername) {
        executor.execute(() -> {
            String chatId = ChatEntity.buildChatId(ownerUsername, contactUsername);
            messageDao.deleteChat(chatId);
            chatDao.deleteChat(chatId);
        });
    }

    /**
     * Delete ALL messages and chat rows for a given user (mirrors clearAllChatHistory).
     */
    public void clearAllChats(String ownerUsername) {
        executor.execute(() -> {
            messageDao.deleteAllForUser(ownerUsername);
            chatDao.deleteAllForUser(ownerUsername);
        });
    }

    // =========================================================================
    // CHATS — mirrors getActiveChats / updateActiveChats
    // =========================================================================

    /**
     * LiveData list of Chat domain objects for the sidebar, ordered by last message.
     * Updates automatically when DB changes (insert / update / delete).
     */

    public LiveData<List<Chat>> getActiveChatsLive(String ownerUsername) {

        // Room returns ChatEntity list; we map to domain Chat objects
        MutableLiveData<List<Chat>> result =
                new MutableLiveData<>(new ArrayList<>());

        LiveData<List<ChatEntity>> entityLive =
                chatDao.getChats(ownerUsername);

        entityLive.observeForever(entities -> {

            // DEBUG LOGS
            if (entities != null) {

                for (ChatEntity e : entities) {

                    android.util.Log.d(
                            "CHAT_DB",
                            "owner=" + e.ownerUsername +
                                    " contact=" + e.contactUsername +
                                    " chatId=" + e.chatId
                    );
                }
            }

            executor.execute(() -> {

                List<Chat> chats = new ArrayList<>();

                if (entities != null) {

                    for (ChatEntity e : entities) {

                        MessageEntity last =
                                messageDao.getLastMessage(e.chatId);

                        String lastMsg =
                                last != null ? last.content : "";

                        chats.add(
                                new Chat(
                                        e.contactUsername,
                                        lastMsg,
                                        e.lastMessageTime,
                                        e.unreadCount,
                                        false
                                )
                        );
                    }
                }

                result.postValue(chats);
            });
        });

        return result;
    }


    /**
     * Ensure a chat row exists for this pair (mirrors updateActiveChats).
     * Safe to call multiple times — uses REPLACE strategy.
     */
    public void ensureChatExists(String ownerUsername, String contactUsername) {
        executor.execute(() -> {
            String chatId = ChatEntity.buildChatId(ownerUsername, contactUsername);
            ensureChatExists(ownerUsername, contactUsername, chatId);
        });
    }

    // Internal helper (already on executor thread)
    private void ensureChatExists(String ownerUsername, String contactUsername, String chatId) {
        ChatEntity existing = chatDao.getChat(chatId);
        if (existing == null) {
            ChatEntity chat = new ChatEntity(
                    chatId, ownerUsername, contactUsername, 0, System.currentTimeMillis());
            chatDao.insertChat(chat);
        }
    }

    // =========================================================================
    // UNREAD COUNTS — mirrors saveUnreadCounts / resetUnreadCount / incrementUnreadCount
    // =========================================================================

    /**
     * Increment the unread counter for a contact (mirrors incrementUnreadCount).
     * Called when a message arrives and the chat is NOT currently open.
     */
    public void incrementUnreadCount(String ownerUsername, String contactUsername) {
        executor.execute(() -> {
            String chatId = ChatEntity.buildChatId(ownerUsername, contactUsername);
            ensureChatExists(ownerUsername, contactUsername, chatId);
            ChatEntity chat = chatDao.getChat(chatId);
            if (chat != null) {
                chatDao.updateUnreadCount(chatId, chat.unreadCount + 1);
            }
        });
    }

    /**
     * Reset unread counter to zero (mirrors resetUnreadCount).
     * Called when the user opens a chat.
     */
    public void resetUnreadCount(String ownerUsername, String contactUsername) {
        executor.execute(() -> {
            String chatId = ChatEntity.buildChatId(ownerUsername, contactUsername);
            chatDao.updateUnreadCount(chatId, 0);
        });
    }

    // =========================================================================
    // SINGLE MESSAGE STATUS UPDATE
    // =========================================================================

    /**
     * Update the status of a specific message (e.g. bounced → delivered).
     */
    public void updateMessageStatus(String messageId, String newStatus) {
        executor.execute(() -> messageDao.updateStatus(messageId, newStatus));
    }

    // =========================================================================
    // CALLBACK INTERFACE
    // =========================================================================

    public interface Callback {
        void onComplete(boolean success);
    }
}