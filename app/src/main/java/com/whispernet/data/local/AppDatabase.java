package com.whispernet.data.local;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

import com.whispernet.data.local.dao.ChatDao;
import com.whispernet.data.local.dao.KeyStoreDao;
import com.whispernet.data.local.dao.MessageDao;
import com.whispernet.data.local.entity.ChatEntity;
import com.whispernet.data.local.entity.KeyStoreEntity;
import com.whispernet.data.local.entity.MessageEntity;

@Database(
        entities = {
                MessageEntity.class,
                ChatEntity.class,
                KeyStoreEntity.class
        },
        version = 3,
        exportSchema = false
)
public abstract class AppDatabase extends RoomDatabase {

    private static volatile AppDatabase INSTANCE;

    public abstract MessageDao messageDao();
    public abstract ChatDao chatDao();
    public abstract KeyStoreDao keyStoreDao();

    public static AppDatabase getInstance(Context context) {

        if (INSTANCE == null) {
            synchronized (AppDatabase.class) {

                if (INSTANCE == null) {

                    INSTANCE = Room.databaseBuilder(
                                    context.getApplicationContext(),
                                    AppDatabase.class,
                                    "whispernet_db"
                            )
                            .fallbackToDestructiveMigration()
                            .build();
                }
            }
        }

        return INSTANCE;
    }
}