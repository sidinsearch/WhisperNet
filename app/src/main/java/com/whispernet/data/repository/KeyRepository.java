package com.whispernet.data.repository;

import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import com.whispernet.data.local.AppDatabase;
import com.whispernet.data.local.dao.KeyStoreDao;
import com.whispernet.data.local.entity.KeyStoreEntity;
import com.whispernet.domain.crypto.CryptoManager;
import com.whispernet.domain.crypto.KeyVerification;
import com.whispernet.domain.model.VerificationInfo;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * KeyRepository — single source of truth for contact key storage and verification.
 *
 * Mirrors all of keyVerification.js:
 *   storeVerifiedKey / getVerifiedKey / hasVerifiedKey / verifyKey /
 *   removeVerifiedKey / clearAllVerifiedKeys
 *
 * All DB writes run on a background executor. Verification results are delivered
 * via a lightweight callback interface so callers (ViewModels) can post to LiveData.
 */
public class KeyRepository {

    private final KeyStoreDao keyStoreDao;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    public KeyRepository(AppDatabase db) {
        this.keyStoreDao = db.keyStoreDao();
    }

    // =========================================================================
    // STORE — mirrors storeVerifiedKey()
    // =========================================================================

    /**
     * Persist a trusted public key for a contact.
     * Generates and stores the fingerprint automatically.
     *
     * @param ownerUsername   the currently logged-in user
     * @param contactUsername the contact whose key we're trusting
     * @param publicKeyBase64 the contact's RSA public key (Base64)
     * @param deviceId        the device ID reported by the contact
     */
    public void storeVerifiedKey(String ownerUsername, String contactUsername,
                                 String publicKeyBase64, String deviceId) {
        executor.execute(() -> {
            String fingerprint = CryptoManager.generateFingerprint(publicKeyBase64);
            String id = KeyStoreEntity.buildId(ownerUsername, contactUsername);
            KeyStoreEntity entity = new KeyStoreEntity(
                    id,
                    ownerUsername,
                    contactUsername,
                    publicKeyBase64,
                    deviceId,
                    fingerprint,
                    System.currentTimeMillis()
            );
            keyStoreDao.insertKey(entity);
        });
    }

    // =========================================================================
    // GET — mirrors getVerifiedKey()
    // =========================================================================

    /**
     * Fetch the stored key info for a contact (blocking — call off main thread).
     * Returns null if no key has been stored yet (mirrors returning null in JS).
     */
    public KeyStoreEntity getVerifiedKey(String ownerUsername, String contactUsername) {
        String id = KeyStoreEntity.buildId(ownerUsername, contactUsername);
        return keyStoreDao.getKey(id);
    }

    /**
     * Non-blocking version that posts the result to a LiveData.
     */
    public LiveData<KeyStoreEntity> getVerifiedKeyLive(String ownerUsername, String contactUsername) {
        MutableLiveData<KeyStoreEntity> result = new MutableLiveData<>();
        executor.execute(() -> result.postValue(getVerifiedKey(ownerUsername, contactUsername)));
        return result;
    }

    // =========================================================================
    // HAS — mirrors hasVerifiedKey()
    // =========================================================================

    /**
     * Returns true if a verified key exists for this contact.
     * Non-blocking — delivers result via callback.
     */
    public void hasVerifiedKey(String ownerUsername, String contactUsername,
                               BooleanCallback callback) {
        executor.execute(() -> {
            boolean has = getVerifiedKey(ownerUsername, contactUsername) != null;
            callback.onResult(has);
        });
    }

    // =========================================================================
    // VERIFY — mirrors verifyKey()
    // =========================================================================

    /**
     * Compare a received public key against the stored trusted key.
     * Delivers a {@link VerificationInfo} via callback — never blocks the caller.
     *
     * Maps exactly to the logic in keyVerification.js::verifyKey():
     *   - no stored key      → status = "new_contact"
     *   - fingerprint differs → status = "key_mismatch"
     *   - device ID differs  → status = "device_changed"
     *   - everything matches → status = "verified"
     *
     * @param ownerUsername         logged-in user
     * @param contactUsername       contact we're verifying
     * @param receivedPublicKeyB64  the key we just received over the socket
     * @param receivedDeviceId      device ID reported by the contact in this session
     * @param callback              result delivered on a background thread
     */
    public void verifyKey(String ownerUsername, String contactUsername,
                          String receivedPublicKeyB64, String receivedDeviceId,
                          VerificationCallback callback) {
        executor.execute(() -> {
            KeyStoreEntity stored = getVerifiedKey(ownerUsername, contactUsername);
            KeyVerification.VerificationResult result =
                    KeyVerification.verifyKey(stored, receivedPublicKeyB64, receivedDeviceId);

            // Map to the domain VerificationInfo object that the UI layer consumes
            VerificationInfo info = new VerificationInfo();
            info.status              = result.status;
            info.message             = result.message;
            info.contactUsername     = contactUsername;
            info.fingerprint         = result.fingerprint;
            info.previousFingerprint = result.previousFingerprint;
            info.verifiedAt          = result.verifiedAt;

            callback.onResult(info);
        });
    }

    // =========================================================================
    // REMOVE — mirrors removeVerifiedKey()
    // =========================================================================

    /**
     * Remove the trusted key for a single contact.
     */
    public void removeVerifiedKey(String ownerUsername, String contactUsername) {
        executor.execute(() -> {
            String id = KeyStoreEntity.buildId(ownerUsername, contactUsername);
            keyStoreDao.deleteKey(id);
        });
    }

    // =========================================================================
    // CLEAR ALL — mirrors clearAllVerifiedKeys()
    // =========================================================================

    /**
     * Remove ALL verified keys for the logged-in user.
     * Called from handleClearAllHistory when the user also wants to clear keys.
     */
    public void clearAllVerifiedKeys(String ownerUsername) {
        executor.execute(() -> keyStoreDao.deleteAllForUser(ownerUsername));
    }

    // =========================================================================
    // PUBLIC KEY CACHE — in-memory cache of received public keys
    // (mirrors the publicKeys state map in App.js)
    // =========================================================================

    /**
     * Look up the stored Base64 public key for a contact (null if not trusted yet).
     * We re-use the KeyStore table — it is the ground truth for public keys too.
     */
    public void getPublicKey(String ownerUsername, String contactUsername,
                             StringCallback callback) {
        executor.execute(() -> {
            KeyStoreEntity entity = getVerifiedKey(ownerUsername, contactUsername);
            callback.onResult(entity != null ? entity.publicKeyBase64 : null);
        });
    }

    // =========================================================================
    // CALLBACK INTERFACES
    // =========================================================================

    public interface VerificationCallback {
        void onResult(VerificationInfo info);
    }

    public interface BooleanCallback {
        void onResult(boolean value);
    }

    public interface StringCallback {
        void onResult(String value);
    }
}