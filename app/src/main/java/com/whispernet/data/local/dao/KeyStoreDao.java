package com.whispernet.data.local.dao;

import androidx.room.*;
import com.whispernet.data.local.entity.KeyStoreEntity;

@Dao
public interface KeyStoreDao {

    @Query("SELECT * FROM key_store WHERE id = :id LIMIT 1")
    KeyStoreEntity getKey(String id);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insertKey(KeyStoreEntity key);

    @Query("DELETE FROM key_store WHERE id = :id")
    void deleteKey(String id);

    @Query("DELETE FROM key_store WHERE ownerUsername = :owner")
    void deleteAllForUser(String owner);
}