package com.whispernet;

import android.app.Application;
import com.whispernet.data.local.AppDatabase;
import com.whispernet.data.prefs.AppPreferences;
import com.whispernet.data.remote.SocketManager;
import com.whispernet.data.repository.ChatRepository;

public class WhisperNetApp extends Application {

    private static WhisperNetApp instance;
    private AppDatabase database;
    private AppPreferences preferences;
    private SocketManager socketManager;
    private ChatRepository chatRepository;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        database = AppDatabase.getInstance(this);
        preferences = new AppPreferences(this);
        socketManager = new SocketManager();
        chatRepository = new ChatRepository(database);
    }

    public static WhisperNetApp getInstance() { return instance; }
    public AppDatabase getDatabase() { return database; }
    public AppPreferences getPreferences() { return preferences; }
    public SocketManager getSocketManager() { return socketManager; }

    public ChatRepository getChatRepository() {
        return chatRepository;
    }
}