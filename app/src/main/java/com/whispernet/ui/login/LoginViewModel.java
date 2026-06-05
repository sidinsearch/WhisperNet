package com.whispernet.ui.login;

import android.app.Application;
import androidx.annotation.NonNull;
import androidx.lifecycle.AndroidViewModel;
import androidx.lifecycle.MutableLiveData;
import com.whispernet.WhisperNetApp;
import com.whispernet.data.prefs.AppPreferences;
import com.whispernet.data.remote.SocketManager;
import com.whispernet.data.repository.ChatRepository;
import com.whispernet.domain.crypto.CryptoManager;
import java.security.KeyPair;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LoginViewModel extends AndroidViewModel {

    public final MutableLiveData<String> username = new MutableLiveData<>("");
    public final MutableLiveData<Boolean> isLoading = new MutableLiveData<>(false);
    public final MutableLiveData<String> statusMessage = new MutableLiveData<>("");
    public final MutableLiveData<Boolean> isError = new MutableLiveData<>(false);
    public final MutableLiveData<Boolean> usernameAvailable = new MutableLiveData<>(true);
    public final MutableLiveData<Boolean> isCheckingUsername = new MutableLiveData<>(false);
    public final MutableLiveData<Boolean> navigateToMain = new MutableLiveData<>(false);

    private final AppPreferences prefs;
    private final SocketManager socketManager;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private Runnable usernameCheckRunnable;

    private final ChatRepository chatRepository;

    public LoginViewModel(@NonNull Application application) {
        super(application);
        WhisperNetApp app = (WhisperNetApp) application;
        prefs = app.getPreferences();
        socketManager = app.getSocketManager();
        chatRepository = app.getChatRepository();
    }

    public void onUsernameChanged(String text) {
        username.setValue(text);
        // Debounce username check
        if (mainHandler != null && usernameCheckRunnable != null)
            mainHandler.removeCallbacks(usernameCheckRunnable);
        usernameCheckRunnable = () -> checkUsernameAvailability(text.trim());
        mainHandler.postDelayed(usernameCheckRunnable, 500);
    }

    private void checkUsernameAvailability(String name) {
        if (name.isEmpty()) return;
        isCheckingUsername.postValue(true);
        socketManager.checkUser(name, (exists, online) -> {
            isCheckingUsername.postValue(false);
            // Available if doesn't exist or exists but offline
            usernameAvailable.postValue(!exists || !online);
        });
    }

    public void connect() {
        String name = username.getValue();
        if (name == null || name.trim().isEmpty()) {
            statusMessage.postValue("Please enter a username");
            isError.postValue(true);
            return;
        }
        name = name.trim();
        isLoading.postValue(true);
        statusMessage.postValue("Generating encryption keys...");
        isError.postValue(false);

        final String finalName = name;
        executor.execute(() -> {
            try {
                // Generate or reuse RSA key pair
                String publicKeyB64, privateKeyB64;
                if (prefs.hasKeys() && finalName.equals(prefs.getUsername())) {
                    publicKeyB64 = prefs.getPublicKeyBase64();
                    privateKeyB64 = prefs.getPrivateKeyBase64();
                } else {
                    KeyPair pair = CryptoManager.generateKeyPair();
                    publicKeyB64 = CryptoManager.publicKeyToBase64(pair.getPublic());
                    privateKeyB64 = CryptoManager.privateKeyToBase64(pair.getPrivate());
                    prefs.setPublicKeyBase64(publicKeyB64);
                    prefs.setPrivateKeyBase64(privateKeyB64);
                    prefs.setUsername(finalName);
                }

                mainHandler.post(() -> statusMessage.setValue("Connecting to relay..."));

                String deviceId = prefs.getDeviceId();
                String finalPublicKey = publicKeyB64;

                socketManager.registerUser(finalName, deviceId, finalPublicKey, (success, relayUrl, reason) -> {
                    if (success) {

                        if (relayUrl != null && !relayUrl.isEmpty()) {
                            prefs.setRelayUrl(relayUrl);
                        }


                        // Notify everyone about updated online state
                        socketManager.getOnlineUsers(null);

                        prefs.setUsername(finalName);

                        isLoading.postValue(false);
                        navigateToMain.postValue(true);

                    } else {
                        isLoading.postValue(false);
                        statusMessage.postValue(reason != null ? reason : "Registration failed");
                        isError.postValue(true);
                    }
                });

            } catch (Exception e) {
                isLoading.postValue(false);
                statusMessage.postValue("Error: " + e.getMessage());
                isError.postValue(true);
            }
        });
    }
}