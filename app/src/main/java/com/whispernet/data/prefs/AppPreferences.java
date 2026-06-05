package com.whispernet.data.prefs;

import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

public class AppPreferences {

    private static final String PREF_NAME = "whispernet_prefs";
    private static final String PREF_SECURE = "whispernet_secure";

    private static final String KEY_USERNAME       = "username";
    private static final String KEY_THEME          = "theme";
    private static final String KEY_DEVICE_ID      = "device_id";
    private static final String KEY_PUBLIC_KEY     = "public_key";
    private static final String KEY_PRIVATE_KEY    = "private_key";  // stored in encrypted prefs
    private static final String KEY_RELAY_URL      = "relay_url";

    private final SharedPreferences prefs;
    private final SharedPreferences securePrefs;
    private final Context context;

    public AppPreferences(Context context) {
        this.context = context;
        prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);

        SharedPreferences temp;
        try {
            MasterKey masterKey = new MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
            temp = EncryptedSharedPreferences.create(
                    context, PREF_SECURE, masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Exception e) {
            temp = context.getSharedPreferences(PREF_SECURE, Context.MODE_PRIVATE);
        }
        securePrefs = temp;
    }

    // Theme
    public String getTheme() { return prefs.getString(KEY_THEME, "dark"); }
    public void setTheme(String theme) { prefs.edit().putString(KEY_THEME, theme).apply(); }
    public boolean isDarkTheme() { return "dark".equals(getTheme()); }

    // Username
    public String getUsername() { return prefs.getString(KEY_USERNAME, null); }
    public void setUsername(String username) { prefs.edit().putString(KEY_USERNAME, username).apply(); }

    // Device ID — generated once, backed by ANDROID_ID
    public String getDeviceId() {
        String id = prefs.getString(KEY_DEVICE_ID, null);
        if (id == null) {
            id = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
            if (id == null) id = java.util.UUID.randomUUID().toString();
            prefs.edit().putString(KEY_DEVICE_ID, id).apply();
        }
        return id;
    }

    // Public key (non-sensitive, regular prefs)
    public String getPublicKeyBase64() { return prefs.getString(KEY_PUBLIC_KEY, null); }
    public void setPublicKeyBase64(String key) { prefs.edit().putString(KEY_PUBLIC_KEY, key).apply(); }

    // Private key (sensitive — encrypted prefs)
    public String getPrivateKeyBase64() { return securePrefs.getString(KEY_PRIVATE_KEY, null); }
    public void setPrivateKeyBase64(String key) { securePrefs.edit().putString(KEY_PRIVATE_KEY, key).apply(); }

    // Relay URL
    public String getRelayUrl() { return prefs.getString(KEY_RELAY_URL, null); }
    public void setRelayUrl(String url) { prefs.edit().putString(KEY_RELAY_URL, url).apply(); }

    public boolean hasKeys() {
        return getPublicKeyBase64() != null && getPrivateKeyBase64() != null;
    }

    public void clearAll() {
        prefs.edit().clear().apply();
        securePrefs.edit().clear().apply();
    }
}