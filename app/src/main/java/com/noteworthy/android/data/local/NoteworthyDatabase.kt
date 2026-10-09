package com.noteworthy.android.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.noteworthy.android.data.local.dao.ChatDao
import com.noteworthy.android.data.local.dao.ClusterDao
import com.noteworthy.android.data.local.dao.ConceptDao
import com.noteworthy.android.data.local.dao.DayDrawingDao
import com.noteworthy.android.data.local.dao.DiscoverCardDao
import com.noteworthy.android.data.local.dao.LetterDao
import com.noteworthy.android.data.local.dao.MemoryDao
import com.noteworthy.android.data.local.dao.NoteDao
import com.noteworthy.android.data.local.entity.ChatEntity
import com.noteworthy.android.data.local.entity.ClusterEntity
import com.noteworthy.android.data.local.entity.ConceptEntity
import com.noteworthy.android.data.local.entity.DayDrawingEntity
import com.noteworthy.android.data.local.entity.DiscoverCardEntity
import com.noteworthy.android.data.local.entity.LetterEntity
import com.noteworthy.android.data.local.entity.MemoryItemEntity
import com.noteworthy.android.data.local.entity.NoteEntity

@Database(
    entities = [
        NoteEntity::class,
        ClusterEntity::class,
        ConceptEntity::class,
        DiscoverCardEntity::class,
        MemoryItemEntity::class,
        LetterEntity::class,
        ChatEntity::class,
        DayDrawingEntity::class
    ],
    version = 1,
    exportSchema = true
)
@TypeConverters(Converters::class)
abstract class NoteworthyDatabase : RoomDatabase() {
    abstract fun noteDao(): NoteDao
    abstract fun clusterDao(): ClusterDao
    abstract fun conceptDao(): ConceptDao
    abstract fun discoverCardDao(): DiscoverCardDao
    abstract fun memoryDao(): MemoryDao
    abstract fun letterDao(): LetterDao
    abstract fun chatDao(): ChatDao
    abstract fun dayDrawingDao(): DayDrawingDao
}
