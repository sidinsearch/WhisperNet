package com.whispernet.ui.chat;

import android.app.Application;
import androidx.annotation.NonNull;
import androidx.lifecycle.AndroidViewModel;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import com.whispernet.WhisperNetApp;
import com.whispernet.data.local.entity.MessageEntity;
import com.whispernet.data.prefs.AppPreferences;
import com.whispernet.data.repository.ChatRepository;
import com.whispernet.domain.model.VerificationInfo;
import java.util.List;

/**
 * ChatViewModel — owns the state for a single open chat conversation.
 *
 * Delegates all heavy lifting (sending, encryption, relay) to MainViewModel;
 * this ViewModel only exposes the per-chat data that ChatFragment needs:
 *   • The message list (LiveData from Room)
 *   • The recipient's online status
 *   • The verification status
 *   • The typing flag
 *
 * The recipient username is set once via {@link #setRecipient(String)} after
 * the ViewModel is created (driven by the fragment argument).
 */
public class ChatViewModel extends AndroidViewModel {

    // -------------------------------------------------------------------------
    // Dependencies
    // -------------------------------------------------------------------------
    private final ChatRepository chatRepo;
    private final AppPreferences prefs;

    // -------------------------------------------------------------------------
    // Per-chat state
    // -------------------------------------------------------------------------

    /** Set once after instantiation by ChatFragment */
    private String recipientUsername;

    /** Live stream of messages from Room for the current chat */
    private LiveData<List<MessageEntity>> messagesLive;

    /** Whether the current message input text is non-empty (enables Send button) */
    public final MutableLiveData<Boolean> canSend = new MutableLiveData<>(false);

    /** True while an outgoing message is being encrypted / sent */
    public final MutableLiveData<Boolean> isSending = new MutableLiveData<>(false);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    public ChatViewModel(@NonNull Application application) {
        super(application);
        WhisperNetApp app = (WhisperNetApp) application;
        chatRepo = new ChatRepository(app.getDatabase());
        prefs    = app.getPreferences();
    }

    // =========================================================================
    // INITIALISE WITH RECIPIENT
    // =========================================================================

    /**
     * Must be called once by ChatFragment (passing the fragment argument).
     * Wires up the Room LiveData for this specific chat.
     */
    public void setRecipient(String recipient) {
        this.recipientUsername = recipient;
        String owner = prefs.getUsername();
        messagesLive = chatRepo.getMessagesLive(owner, recipient);
    }

    public String getRecipientUsername() {
        return recipientUsername;
    }

    // =========================================================================
    // MESSAGES
    // =========================================================================

    /**
     * Observe the message list for this chat.
     * Returns null if setRecipient() has not been called yet.
     */
    public LiveData<List<MessageEntity>> getMessages() {
        return messagesLive;
    }

    // =========================================================================
    // INPUT HANDLING
    // =========================================================================

    /**
     * Called by ChatFragment's TextWatcher on every keystroke.
     * Updates canSend so the Send button enables/disables correctly.
     */
    public void onInputChanged(String text) {
        canSend.setValue(text != null && !text.trim().isEmpty());
    }

    // =========================================================================
    // CONVENIENCE GETTERS (delegates to MainViewModel via the repository)
    // =========================================================================

    public String getOwnerUsername() {
        return prefs.getUsername();
    }
}