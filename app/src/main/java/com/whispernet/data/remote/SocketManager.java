package com.whispernet.data.remote;

import android.util.Log;
import io.socket.client.IO;
import io.socket.client.Socket;
import io.socket.emitter.Emitter;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

public class SocketManager {

    private static final String TAG = "SocketManager";
    private Socket socket;

    // Listener interfaces (mirroring Socket.IO events from the web app)
    public interface MessageListener {
        void onMessage(String from, String message, long timestamp, boolean encrypted,
                       String publicKey, String fromDeviceId);
    }

    public interface UserStatusListener {
        void onUserStatusUpdate(String username, boolean online);
    }

    public interface TypingListener {
        void onTyping(String fromUsername);
    }

    public interface RelayAssignedListener {
        void onRelayAssigned(String relayUrl);
    }

    public interface OnlineUsersListener {
        void onOnlineUsersUpdate(List<String> users);
    }

    public interface PublicKeyRequestListener {
        String onPublicKeyRequested(String fromUsername);
    }

    public interface ConnectionListener {
        void onConnected();
        void onDisconnected();
        void onConnectError(String error);
    }

    private final CopyOnWriteArrayList<MessageListener> messageListeners = new CopyOnWriteArrayList<>();
    private final CopyOnWriteArrayList<UserStatusListener> statusListeners = new CopyOnWriteArrayList<>();
    private final CopyOnWriteArrayList<TypingListener> typingListeners = new CopyOnWriteArrayList<>();
    private final CopyOnWriteArrayList<OnlineUsersListener> onlineUsersListeners = new CopyOnWriteArrayList<>();
    private final CopyOnWriteArrayList<ConnectionListener> connectionListeners = new CopyOnWriteArrayList<>();

    private PublicKeyRequestListener publicKeyRequestListener;

    // Listener registration
    public void addMessageListener(MessageListener l)        { messageListeners.add(l); }
    public void addStatusListener(UserStatusListener l)      { statusListeners.add(l); }
    public void addTypingListener(TypingListener l)          { typingListeners.add(l); }
    public void addOnlineUsersListener(OnlineUsersListener l){ onlineUsersListeners.add(l); }
    public void addConnectionListener(ConnectionListener l)  { connectionListeners.add(l); }
    public void setPublicKeyRequestListener(PublicKeyRequestListener l) { publicKeyRequestListener = l; }

    public void removeMessageListener(MessageListener l)     { messageListeners.remove(l); }
    public void removeStatusListener(UserStatusListener l)   { statusListeners.remove(l); }
    public void removeTypingListener(TypingListener l)       { typingListeners.remove(l); }
    public void removeOnlineUsersListener(OnlineUsersListener l){ onlineUsersListeners.remove(l); }
    public void removeConnectionListener(ConnectionListener l){ connectionListeners.remove(l); }

    // -------------------------------------------------------------------------
    // Connect to base node URL
    // -------------------------------------------------------------------------
    public void connect(String baseNodeUrl) {
        try {
            IO.Options opts = IO.Options.builder()
                    .setTransports(new String[]{"websocket", "polling"})
                    .setReconnection(true)
                    .setReconnectionDelay(2000)
                    .setReconnectionDelayMax(10000)
                    .build();

            socket = IO.socket(URI.create(baseNodeUrl), opts);
            attachListeners();
            socket.connect();
        } catch (Exception e) {
            Log.e(TAG, "Socket connection error: " + e.getMessage());
        }
    }

    // -------------------------------------------------------------------------
    // Attach all socket event listeners
    // -------------------------------------------------------------------------
    private void attachListeners() {
        socket.on(Socket.EVENT_CONNECT, args -> {
            Log.d(TAG, "Socket connected");
            for (ConnectionListener l : connectionListeners) l.onConnected();
        });

        socket.on(Socket.EVENT_DISCONNECT, args -> {
            Log.d(TAG, "Socket disconnected");
            for (ConnectionListener l : connectionListeners) l.onDisconnected();
        });

        socket.on(Socket.EVENT_CONNECT_ERROR, args -> {
            String err = args.length > 0 ? args[0].toString() : "Unknown error";
            Log.e(TAG, "Connect error: " + err);
            for (ConnectionListener l : connectionListeners) l.onConnectError(err);
        });

        // FIX 1: "receiveMessage" is the actual event the base node fires when
        // delivering a direct message (server__1_.js line 289 / 406).
        // Your original code only listened for "message" — missed all direct deliveries.
        socket.on("receiveMessage", args -> parseAndDispatchMessage(args));

        // "message" — kept for relay-path / web-app compatibility
        socket.on("message", args -> parseAndDispatchMessage(args));

        // "relayMessage" — bounced / queued message arriving from relay
        socket.on("relayMessage", args -> parseAndDispatchMessage(args));

        socket.on("userStatusUpdate", args -> {
            try {
                JSONObject data = (JSONObject) args[0];
                String username = data.getString("username");
                boolean online  = data.getBoolean("online");
                for (UserStatusListener l : statusListeners) l.onUserStatusUpdate(username, online);
            } catch (Exception e) { Log.e(TAG, "Error parsing status update: " + e.getMessage()); }
        });

        // FIX 2: server fires "userTyping" (not "typing") from the relay server.
        // Listen for BOTH so we work whether the user is on a relay or base node.
        socket.on("userTyping", args -> {
            try {
                JSONObject data = (JSONObject) args[0];
                // relay server sends { username: "..." }, base node sends { from: "..." }
                String from = data.has("username") ? data.getString("username")
                        : data.getString("from");
                for (TypingListener l : typingListeners) l.onTyping(from);
            } catch (Exception e) { Log.e(TAG, "Error parsing userTyping: " + e.getMessage()); }
        });

        socket.on("typing", args -> {
            try {
                JSONObject data = (JSONObject) args[0];
                String from = data.has("from") ? data.getString("from")
                        : data.getString("username");
                for (TypingListener l : typingListeners) l.onTyping(from);
            } catch (Exception e) { Log.e(TAG, "Error parsing typing: " + e.getMessage()); }
        });

        socket.on("onlineUsersUpdate", args -> {
            try {
                JSONObject data = (JSONObject) args[0];
                JSONArray usersArray = data.getJSONArray("users");
                List<String> users = new ArrayList<>();
                for (int i = 0; i < usersArray.length(); i++) users.add(usersArray.getString(i));
                for (OnlineUsersListener l : onlineUsersListeners) l.onOnlineUsersUpdate(users);
            } catch (Exception e) { Log.e(TAG, "Error parsing online users: " + e.getMessage()); }
        });

        socket.on("publicKeyRequest", args -> {
            try {
                JSONObject data = (JSONObject) args[0];
                io.socket.client.Ack ack = (io.socket.client.Ack) args[1];
                String from = data.optString("from");
                String publicKey = publicKeyRequestListener != null
                        ? publicKeyRequestListener.onPublicKeyRequested(from) : null;
                JSONObject response = new JSONObject();
                if (publicKey != null) {
                    response.put("success", true);
                    response.put("publicKey", publicKey);
                } else {
                    response.put("success", false);
                    response.put("reason", "Public key not available");
                }
                if (ack != null) ack.call(response);
            } catch (Exception e) { Log.e(TAG, "Error handling publicKeyRequest: " + e.getMessage()); }
        });
    }

    // -------------------------------------------------------------------------
    // FIX 3: shared helper — parse any incoming message event and dispatch
    // Eliminates the duplicated parse block that existed for "message" and
    // "relayMessage", and now also covers "receiveMessage".
    // -------------------------------------------------------------------------
    private void parseAndDispatchMessage(Object[] args) {
        try {
            JSONObject data   = (JSONObject) args[0];
            String  from      = data.optString("from");
            String  message   = data.optString("message");
            long    timestamp = data.optLong("timestamp", System.currentTimeMillis());
            boolean encrypted = data.optBoolean("encrypted", false);
            // publicKey may come as a JSON object (JWK from web) or a Base64 string
            // (Android sender). Store the raw string — CryptoManager handles both.
            String  publicKey = data.isNull("publicKey") ? null : data.optString("publicKey", null);
            String  deviceId  = data.optString("fromDeviceId", null);
            for (MessageListener l : messageListeners)
                l.onMessage(from, message, timestamp, encrypted, publicKey, deviceId);
        } catch (Exception e) {
            Log.e(TAG, "Error parsing message: " + e.getMessage());
        }
    }

    // =========================================================================
    // Emit methods
    // =========================================================================

    /**
     * Register this user with the base node.
     *
     * FIX 4: After a successful ACK we immediately call getOnlineUsers().
     * The server's getOnlineUsers handler (server__1_.js line 629) responds AND
     * broadcasts  io.emit('onlineUsersUpdate', { users })  to EVERY connected
     * socket — so other already-logged-in users immediately learn about us.
     * Without this call, nobody knows we are online until the next natural event.
     */
    public void registerUser(String username, String deviceId, String publicKey,
                             RegisterCallback callback) {
        if (socket == null) return;
        try {
            JSONObject data = new JSONObject();
            data.put("username", username);
            data.put("deviceId", deviceId);
            data.put("publicKey", publicKey);

            socket.emit("registerUser", new Object[]{data}, (Object... response) -> {
                try {
                    JSONObject res  = (JSONObject) response[0];
                    boolean success = res.getBoolean("success");
                    String  relayUrl = res.optString("relayUrl", null);
                    String  reason   = res.optString("reason", null);

                    if (success) {
                        // Trigger server broadcast so all other clients refresh their
                        // online-user list and show us as online immediately.
                        getOnlineUsers(null);
                    }

                    callback.onResult(success, relayUrl, reason);
                } catch (Exception e) {
                    callback.onResult(false, null, e.getMessage());
                }
            });
        } catch (Exception e) {
            callback.onResult(false, null, e.getMessage());
        }
    }

    public void sendMessage(String to, String message, String from,
                            String deviceId, String publicKey, boolean encrypted) {
        if (socket == null) return;

        try {
            JSONObject data = new JSONObject();
            data.put("to", to);
            data.put("message", message);
            data.put("from", from);
            data.put("deviceId", deviceId); // server expects deviceId
            data.put("encrypted", encrypted);

            if (publicKey != null) {
                data.put("publicKey", publicKey);
            }

            socket.emit(
                    "sendMessage",
                    new Object[]{data},
                    (Object... response) -> {
                        Log.d(TAG, "sendMessage ACK: " +
                                (response.length > 0 ? response[0].toString() : "no response"));
                    }
            );

        } catch (Exception e) {
            Log.e(TAG, "sendMessage error: " + e.getMessage());
        }
    }

    public void sendRelayMessage(String to, String message, String from,
                                 String deviceId, String publicKey,
                                 boolean encrypted,
                                 RelayCallback callback) {
        if (socket == null) return;
        try {
            JSONObject data = new JSONObject();
            data.put("to",           to);
            data.put("message",      message);
            data.put("from",         from);
            data.put("fromDeviceId", deviceId);
            data.put("timestamp",    System.currentTimeMillis());
            data.put("publicKey",    publicKey);
            data.put("encrypted",    encrypted);
            // FIX 5: "bounce: true" tells the base node to queue this message
            // for later delivery (server__1_.js line 363 / 387).
            data.put("bounce",       true);

            socket.emit("relayMessage", new Object[]{data}, (Object... response) -> {
                try {
                    JSONObject res = (JSONObject) response[0];
                    // Server may ack with {success} or {bounced} — accept either.
                    boolean ok = res.optBoolean("success", false)
                            || res.optBoolean("bounced", false);
                    callback.onResult(ok);
                } catch (Exception e) {
                    callback.onResult(false);
                }
            });
        } catch (Exception e) {
            callback.onResult(false);
        }
    }

    public void sendTyping(String to) {
        if (socket == null || !socket.connected()) return;
        try {
            JSONObject data = new JSONObject();
            data.put("to", to);
            socket.emit("typing", data);
        } catch (Exception e) { Log.e(TAG, "sendTyping error: " + e.getMessage()); }
    }

    public void checkUser(String username, CheckUserCallback callback) {
        if (socket == null) return;
        try {
            JSONObject data = new JSONObject();
            data.put("username", username);

            socket.emit("checkUser", new Object[]{data}, (Object... response) -> {
                try {
                    JSONObject res = (JSONObject) response[0];
                    callback.onResult(res.getBoolean("exists"), res.getBoolean("online"));
                } catch (Exception e) {
                    callback.onResult(false, false);
                }
            });
        } catch (Exception e) {
            callback.onResult(false, false);
        }
    }

    /**
     * FIX 6: New method — check a single recipient's live online status.
     * Called by MainViewModel.openChat() so the chat header shows the correct
     * status the moment the user taps a contact.
     * Internally re-uses the same "checkUser" socket event — just an alias
     * with a clearer name for call-site readability.
     */
    public void checkRecipient(String username, CheckUserCallback callback) {
        checkUser(username, callback);
    }

    public void requestPublicKey(String from, String targetUsername,
                                 PublicKeyCallback callback) {
        if (socket == null) return;
        try {
            JSONObject data = new JSONObject();
            data.put("from",     from);
            data.put("username", targetUsername);

            socket.emit("requestPublicKey", new Object[]{data}, (Object... response) -> {
                try {
                    JSONObject res = (JSONObject) response[0];
                    if (res.getBoolean("success")) {
                        callback.onResult(res.getString("publicKey"));
                    } else {
                        callback.onResult(null);
                    }
                } catch (Exception e) {
                    callback.onResult(null);
                }
            });
        } catch (Exception e) {
            callback.onResult(null);
        }
    }

    /**
     * Ask the server for the full list of currently online users.
     *
     * Side-effect: the server's handler (server__1_.js line 637) also calls
     *   io.emit('onlineUsersUpdate', { users })
     * which broadcasts the list to ALL connected clients — so calling this
     * after registration makes every other user refresh their contacts list.
     *
     * Pass null for callback when you only want that broadcast side-effect
     * and don't need the result locally.
     */
    public void getOnlineUsers(OnlineUsersCallback callback) {
        if (socket == null || !socket.connected()) return;

        socket.emit("getOnlineUsers", new Object[]{}, (Object... response) -> {
            try {
                JSONArray arr = (JSONArray) response[0];
                List<String> users = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) users.add(arr.getString(i));

                // Notify local listeners as well (mirrors the broadcast path)
                for (OnlineUsersListener l : onlineUsersListeners) l.onOnlineUsersUpdate(users);

                if (callback != null) callback.onResult(users);
            } catch (Exception e) {
                Log.e(TAG, "getOnlineUsers error: " + e.getMessage());
                if (callback != null) callback.onResult(new ArrayList<>());
            }
        });
    }

    public void disconnect() {
        if (socket != null) { socket.disconnect(); socket = null; }
    }

    public boolean isConnected() { return socket != null && socket.connected(); }

    // -------------------------------------------------------------------------
    // Callback interfaces
    // -------------------------------------------------------------------------
    public interface RegisterCallback   { void onResult(boolean success, String relayUrl, String reason); }
    public interface RelayCallback      { void onResult(boolean success); }
    public interface CheckUserCallback  { void onResult(boolean exists, boolean online); }
    public interface PublicKeyCallback  { void onResult(String publicKeyBase64); }
    public interface OnlineUsersCallback{ void onResult(List<String> users); }
}