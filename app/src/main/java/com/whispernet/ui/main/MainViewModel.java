package com.whispernet.ui.main;

import android.app.Application;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.lifecycle.AndroidViewModel;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.Transformations;

import com.whispernet.WhisperNetApp;
import com.whispernet.data.prefs.AppPreferences;
import com.whispernet.data.remote.SocketManager;
import com.whispernet.data.repository.ChatRepository;
import com.whispernet.data.repository.KeyRepository;
import com.whispernet.domain.crypto.CryptoManager;
import com.whispernet.domain.model.Chat;
import com.whispernet.domain.model.Message;
import com.whispernet.domain.model.VerificationInfo;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainViewModel extends AndroidViewModel {

    // -------------------------------------------------------------------------
    // Dependencies
    // -------------------------------------------------------------------------

    private final AppPreferences prefs;
    private final SocketManager socketManager;
    private final ChatRepository chatRepo;
    private final KeyRepository keyRepo;

    private final ExecutorService executor =
            Executors.newFixedThreadPool(2);

    private final Handler mainHandler =
            new Handler(Looper.getMainLooper());

    // -------------------------------------------------------------------------
    // Session data
    // -------------------------------------------------------------------------

    private final String myDeviceId;

    // -------------------------------------------------------------------------
    // LiveData
    // -------------------------------------------------------------------------

    public final MutableLiveData<String> relayStatus =
            new MutableLiveData<>("checking");

    public final MutableLiveData<String> statusText =
            new MutableLiveData<>("");

    public final MutableLiveData<Boolean> isDarkTheme =
            new MutableLiveData<>(true);

    public final MutableLiveData<String> currentChat =
            new MutableLiveData<>(null);

    public final MutableLiveData<Map<String, Boolean>> onlineStatusMap =
            new MutableLiveData<>(new HashMap<>());

    public final MutableLiveData<Map<String, VerificationInfo>>
            verificationStatuses =
            new MutableLiveData<>(new HashMap<>());

    public final MutableLiveData<Map<String, Boolean>> typingUsers =
            new MutableLiveData<>(new HashMap<>());

    private final Map<String, String> publicKeyCache =
            new HashMap<>();

    public final MutableLiveData<SecurityAlert> securityAlert =
            new MutableLiveData<>(null);

    public final MutableLiveData<VerificationInfo>
            showVerificationDialog =
            new MutableLiveData<>(null);

    private final MutableLiveData<String> currentUser =
            new MutableLiveData<>();

    public final LiveData<List<Chat>> activeChats;

    public final MutableLiveData<Boolean> chatsCleared =
            new MutableLiveData<>(false);

    private final Map<String, Runnable> typingTimeouts =
            new HashMap<>();

    private Runnable periodicRefreshRunnable;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    public MainViewModel(@NonNull Application application) {
        super(application);

        WhisperNetApp app = (WhisperNetApp) application;

        prefs         = app.getPreferences();
        socketManager = app.getSocketManager();
        chatRepo      = new ChatRepository(app.getDatabase());
        keyRepo       = new KeyRepository(app.getDatabase());

        android.util.Log.d(
                "SESSION",
                "MainViewModel created for user = "
                        + prefs.getUsername()
        );
        activeChats = Transformations.switchMap(
                currentUser,
                username -> chatRepo.getActiveChatsLive(username)
        );

        myDeviceId = prefs.getDeviceId();

        isDarkTheme.setValue(prefs.isDarkTheme());

        currentUser.setValue(prefs.getUsername());

        attachSocketListeners();

        checkRelayStatus();
    }

    // =========================================================================
    // SOCKET LISTENERS
    // =========================================================================

    private void attachSocketListeners() {

        socketManager.addConnectionListener(
                new SocketManager.ConnectionListener() {

                    @Override
                    public void onConnected() {

                        relayStatus.postValue("online");
                        statusText.postValue("Connected");

                        socketManager.getOnlineUsers(null);

                        startPeriodicRefresh();
                    }

                    @Override
                    public void onDisconnected() {

                        relayStatus.postValue("offline");
                        statusText.postValue("Disconnected. Reconnecting…");
                    }

                    @Override
                    public void onConnectError(String error) {

                        relayStatus.postValue("error");
                        statusText.postValue(
                                "Connection error: " + error
                        );
                    }
                });

        // ---------------------------------------------------------------------
        // Incoming messages
        // ---------------------------------------------------------------------

        socketManager.addMessageListener(
                (from,
                 encryptedContent,
                 timestamp,
                 encrypted,
                 senderPublicKey,
                 fromDeviceId) -> {

                    if (senderPublicKey != null &&
                            !senderPublicKey.isEmpty()) {

                        publicKeyCache.put(from, senderPublicKey);

                        runKeyVerification(
                                from,
                                senderPublicKey,
                                fromDeviceId
                        );
                    }

                    String content = encryptedContent;
                    String decryptionStatus;

                    if (encrypted) {

                        String privateKeyB64 =
                                prefs.getPrivateKeyBase64();

                        String decrypted =
                                privateKeyB64 != null
                                        ? CryptoManager.decrypt(
                                        encryptedContent,
                                        privateKeyB64
                                )
                                        : null;

                        if (decrypted != null) {

                            content = decrypted;

                            decryptionStatus =
                                    Message.STATUS_DECRYPTED;

                        } else {

                            content =
                                    "[Encrypted message — cannot decrypt]";

                            decryptionStatus =
                                    Message.STATUS_FAILED_DECRYPT;

                            postAlert(
                                    new SecurityAlert(
                                            "System",
                                            "Failed to decrypt message from "
                                                    + from,
                                            "warning"
                                    )
                            );
                        }

                    } else {

                        decryptionStatus =
                                Message.STATUS_PLAINTEXT;
                    }

                    boolean bounced = false;

                    Message msg = Message.incoming(
                            UUID.randomUUID().toString(),
                            from,
                            prefs.getUsername(),
                            content,
                            timestamp,
                            fromDeviceId,
                            encrypted,
                            decryptionStatus,
                            bounced
                    );

                    chatRepo.saveMessage(
                            prefs.getUsername(),
                            msg
                    );

                    String openChat = currentChat.getValue();

                    if (!from.equals(openChat)) {

                        chatRepo.incrementUnreadCount(
                                prefs.getUsername(),
                                from
                        );
                    }

                    chatRepo.ensureChatExists(
                            prefs.getUsername(),
                            from
                    );

                    Map<String, Boolean> statusMap =
                            new HashMap<>(
                                    onlineStatusMap.getValue() != null
                                            ? onlineStatusMap.getValue()
                                            : new HashMap<>()
                            );

                    statusMap.put(from, true);

                    onlineStatusMap.postValue(statusMap);
                });

        // ---------------------------------------------------------------------
        // User status updates
        // ---------------------------------------------------------------------

        socketManager.addStatusListener(
                (username, online) -> {

                    Map<String, Boolean> map =
                            new HashMap<>(
                                    onlineStatusMap.getValue() != null
                                            ? onlineStatusMap.getValue()
                                            : new HashMap<>()
                            );

                    map.put(username, online);

                    onlineStatusMap.postValue(map);
                });

        // ---------------------------------------------------------------------
        // Online users
        // ---------------------------------------------------------------------

        socketManager.addOnlineUsersListener(users -> {

            Map<String, Boolean> map =
                    new HashMap<>();

            for (String u : users) {
                map.put(u, true);
            }

            Map<String, Boolean> current =
                    onlineStatusMap.getValue();

            if (current != null) {

                for (Map.Entry<String, Boolean> entry
                        : current.entrySet()) {

                    if (!map.containsKey(entry.getKey())) {

                        map.put(entry.getKey(), false);
                    }
                }
            }

            onlineStatusMap.postValue(map);
        });

        // ---------------------------------------------------------------------
        // Typing
        // ---------------------------------------------------------------------

        socketManager.addTypingListener(fromUser -> {

            Map<String, Boolean> map =
                    new HashMap<>(
                            typingUsers.getValue() != null
                                    ? typingUsers.getValue()
                                    : new HashMap<>()
                    );

            map.put(fromUser, true);

            typingUsers.postValue(map);

            Runnable existing =
                    typingTimeouts.get(fromUser);

            if (existing != null) {
                mainHandler.removeCallbacks(existing);
            }

            Runnable clear = () -> {

                Map<String, Boolean> m =
                        new HashMap<>(
                                typingUsers.getValue() != null
                                        ? typingUsers.getValue()
                                        : new HashMap<>()
                        );

                m.put(fromUser, false);

                typingUsers.postValue(m);
            };

            typingTimeouts.put(fromUser, clear);

            mainHandler.postDelayed(clear, 3000);
        });

        socketManager.setPublicKeyRequestListener(
                fromUsername -> prefs.getPublicKeyBase64()
        );
    }

    // =========================================================================
    // Periodic refresh
    // =========================================================================

    private void startPeriodicRefresh() {

        if (periodicRefreshRunnable != null) {
            mainHandler.removeCallbacks(periodicRefreshRunnable);
        }

        periodicRefreshRunnable = new Runnable() {

            @Override
            public void run() {

                if (socketManager.isConnected()) {
                    socketManager.getOnlineUsers(null);
                }

                mainHandler.postDelayed(this, 30000);
            }
        };

        mainHandler.postDelayed(
                periodicRefreshRunnable,
                30000
        );
    }

    // =========================================================================
    // Verification
    // =========================================================================

    public void requestVerification(
            String contactUsername
    ) {

        String publicKeyB64 =
                publicKeyCache.get(contactUsername);

        if (publicKeyB64 == null) {

            postAlert(
                    new SecurityAlert(
                            "System",
                            "No public key available.",
                            "error"
                    )
            );

            return;
        }

        String deviceId =
                getDeviceIdForContact(contactUsername);

        keyRepo.verifyKey(
                prefs.getUsername(),
                contactUsername,
                publicKeyB64,
                deviceId,
                info -> {

                    info.contactUsername =
                            contactUsername;

                    showVerificationDialog
                            .postValue(info);
                }
        );
    }

    public void confirmVerification(
            String contactUsername
    ) {

        String publicKeyB64 =
                publicKeyCache.get(contactUsername);

        if (publicKeyB64 == null) return;

        String deviceId =
                getDeviceIdForContact(contactUsername);

        keyRepo.storeVerifiedKey(
                prefs.getUsername(),
                contactUsername,
                publicKeyB64,
                deviceId
        );

        String fingerprint =
                CryptoManager.generateFingerprint(
                        publicKeyB64
                );

        VerificationInfo info =
                new VerificationInfo();

        info.status = "verified";
        info.message = "Identity verified";
        info.contactUsername = contactUsername;
        info.fingerprint = fingerprint;
        info.verifiedAt = System.currentTimeMillis();

        Map<String, VerificationInfo> map =
                new HashMap<>(
                        verificationStatuses.getValue() != null
                                ? verificationStatuses.getValue()
                                : new HashMap<>()
                );

        map.put(contactUsername, info);

        verificationStatuses.postValue(map);

        showVerificationDialog.postValue(null);
    }

    public void cancelVerification() {
        showVerificationDialog.postValue(null);
    }

    private void runKeyVerification(
            String contactUsername,
            String publicKeyB64,
            String deviceId
    ) {

        keyRepo.verifyKey(
                prefs.getUsername(),
                contactUsername,
                publicKeyB64,
                deviceId != null ? deviceId : "",
                info -> {

                    Map<String, VerificationInfo> map =
                            new HashMap<>(
                                    verificationStatuses.getValue() != null
                                            ? verificationStatuses.getValue()
                                            : new HashMap<>()
                            );

                    map.put(contactUsername, info);

                    verificationStatuses.postValue(map);
                }
        );
    }

    // =========================================================================
    // Chat
    // =========================================================================

    public void openChat(String contactUsername) {

        if (prefs.getUsername().equals(contactUsername)) {

            postAlert(
                    new SecurityAlert(
                            "System",
                            "You cannot chat with yourself.",
                            "error"
                    )
            );

            return;
        }

        chatRepo.ensureChatExists(
                prefs.getUsername(),
                contactUsername
        );

        chatRepo.resetUnreadCount(
                prefs.getUsername(),
                contactUsername
        );

        currentChat.postValue(contactUsername);

        socketManager.checkRecipient(
                contactUsername,
                (exists, online) -> {

                    Map<String, Boolean> map =
                            new HashMap<>(
                                    onlineStatusMap.getValue() != null
                                            ? onlineStatusMap.getValue()
                                            : new HashMap<>()
                            );

                    map.put(contactUsername, online);

                    onlineStatusMap.postValue(map);
                }
        );

        if (!publicKeyCache.containsKey(contactUsername)) {

            socketManager.requestPublicKey(
                    prefs.getUsername(),
                    contactUsername,
                    key -> {

                        if (key != null && !key.isEmpty()) {
                            publicKeyCache.put(
                                    contactUsername,
                                    key
                            );
                        }
                    }
            );
        }
    }

    public void closeChat() {
        currentChat.postValue(null);
    }

    public void startNewChat(String contactUsername) {
        openChat(contactUsername);
    }

    // =========================================================================
    // Send message
    // =========================================================================

    public void sendMessage(
            String recipientUsername,
            String plaintext
    ) {

        executor.execute(() -> {

            String publicKeyB64 =
                    publicKeyCache.get(recipientUsername);

            boolean canEncrypt =
                    publicKeyB64 != null &&
                            prefs.getPublicKeyBase64() != null;

            String wireContent;
            boolean encrypted;

            try {

                if (canEncrypt) {

                    wireContent =
                            CryptoManager.encrypt(
                                    plaintext,
                                    publicKeyB64
                            );

                    encrypted = true;

                } else {

                    wireContent = plaintext;
                    encrypted = false;
                }

            } catch (Exception e) {

                wireContent = plaintext;
                encrypted = false;
            }

            String msgId =
                    UUID.randomUUID().toString();

            Message msg = Message.outgoing(
                    msgId,
                    prefs.getUsername(),
                    recipientUsername,
                    plaintext,
                    myDeviceId,
                    encrypted
            );

            chatRepo.saveMessage(
                    prefs.getUsername(),
                    msg
            );

            socketManager.sendMessage(
                    recipientUsername,
                    wireContent,
                    prefs.getUsername(),
                    myDeviceId,
                    prefs.getPublicKeyBase64(),
                    encrypted
            );
        });
    }

    // =========================================================================
    // Relay message
    // =========================================================================

    public void sendRelayMessage(
            String recipientUsername,
            String plaintext
    ) {

        executor.execute(() -> {

            String publicKeyB64 =
                    publicKeyCache.get(recipientUsername);

            boolean canEncrypt =
                    publicKeyB64 != null;

            String wireContent;
            boolean encrypted;

            try {

                if (canEncrypt) {

                    wireContent =
                            CryptoManager.encrypt(
                                    plaintext,
                                    publicKeyB64
                            );

                    encrypted = true;

                } else {

                    wireContent = plaintext;
                    encrypted = false;
                }

            } catch (Exception e) {

                wireContent = plaintext;
                encrypted = false;
            }

            final String finalWireContent =
                    wireContent;

            final boolean finalEncrypted =
                    encrypted;

            socketManager.sendRelayMessage(
                    recipientUsername,
                    finalWireContent,
                    prefs.getUsername(),
                    myDeviceId,
                    prefs.getPublicKeyBase64(),
                    finalEncrypted,
                    success -> {

                        if (success) {

                            String msgId =
                                    UUID.randomUUID()
                                            .toString();

                            Message msg =
                                    Message.outgoingRelay(
                                            msgId,
                                            prefs.getUsername(),
                                            recipientUsername,
                                            plaintext,
                                            myDeviceId,
                                            finalEncrypted
                                    );

                            chatRepo.saveMessage(
                                    prefs.getUsername(),
                                    msg
                            );

                        } else {

                            postAlert(
                                    new SecurityAlert(
                                            "System",
                                            "Failed to relay message.",
                                            "error"
                                    )
                            );
                        }
                    }
            );
        });
    }

    // =========================================================================
    // Typing
    // =========================================================================

    public void sendTypingIndicator(
            String recipientUsername
    ) {

        socketManager.sendTyping(recipientUsername);
    }

    // =========================================================================
    // Clear history
    // =========================================================================

    public void clearAllHistory(
            boolean alsoKeys
    ) {

        chatRepo.clearAllChats(
                prefs.getUsername()
        );

        if (alsoKeys) {

            keyRepo.clearAllVerifiedKeys(
                    prefs.getUsername()
            );

            verificationStatuses.postValue(
                    new HashMap<>()
            );
        }

        currentChat.postValue(null);

        chatsCleared.postValue(true);
    }

    // =========================================================================
    // Theme
    // =========================================================================

    public void toggleTheme() {

        Boolean current =
                isDarkTheme.getValue();

        boolean next =
                !Boolean.TRUE.equals(current);

        isDarkTheme.postValue(next);

        prefs.setTheme(
                next ? "dark" : "light"
        );
    }

    // =========================================================================
    // Relay status
    // =========================================================================

    public void checkRelayStatus() {

        relayStatus.postValue("checking");

        statusText.postValue(
                "Checking connection status…"
        );

        if (!socketManager.isConnected()) {

            String url =
                    prefs.getRelayUrl();

            if (url == null || url.isEmpty()) {

                url =
                        "https://basenode-7bi5.onrender.com/";
            }

            socketManager.connect(url);
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    public String getMyUsername() {
        return prefs.getUsername();
    }

    public void refreshCurrentUser() {
        currentUser.setValue(prefs.getUsername());
    }

    public boolean isOnline(
            String contactUsername
    ) {

        Map<String, Boolean> map =
                onlineStatusMap.getValue();

        return map != null &&
                Boolean.TRUE.equals(
                        map.get(contactUsername)
                );
    }

    public VerificationInfo getVerification(
            String contactUsername
    ) {

        Map<String, VerificationInfo> map =
                verificationStatuses.getValue();

        return map != null
                ? map.get(contactUsername)
                : null;
    }

    public boolean isTyping(
            String contactUsername
    ) {

        Map<String, Boolean> map =
                typingUsers.getValue();

        return map != null &&
                Boolean.TRUE.equals(
                        map.get(contactUsername)
                );
    }

    public LiveData<
            List<com.whispernet.data.local.entity.MessageEntity>
            > getMessagesLive(
            String contactUsername
    ) {

        return chatRepo.getMessagesLive(
                prefs.getUsername(),
                contactUsername
        );
    }

    private void postAlert(
            SecurityAlert alert
    ) {

        securityAlert.postValue(alert);
    }

    private String getDeviceIdForContact(
            String contactUsername
    ) {

        return "";
    }

    @Override
    protected void onCleared() {

        super.onCleared();

        if (periodicRefreshRunnable != null) {
            mainHandler.removeCallbacks(
                    periodicRefreshRunnable
            );
        }

        socketManager.disconnect();
    }

    // =========================================================================
    // Security alert
    // =========================================================================

    public static class SecurityAlert {

        public final String username;
        public final String message;
        public final String type;

        public SecurityAlert(
                String username,
                String message,
                String type
        ) {

            this.username = username;
            this.message = message;
            this.type = type;
        }
    }
}
