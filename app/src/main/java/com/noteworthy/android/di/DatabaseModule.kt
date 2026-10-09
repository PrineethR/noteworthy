package com.noteworthy.android.di

import android.content.Context
import androidx.room.Room
import com.noteworthy.android.data.local.NoteworthyDatabase
import com.noteworthy.android.data.local.dao.*
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideNoteworthyDatabase(
        @ApplicationContext context: Context
    ): NoteworthyDatabase {
        return Room.databaseBuilder(
            context,
            NoteworthyDatabase::class.java,
            "noteworthy.db"
        )
        .fallbackToDestructiveMigration()
        .build()
    }

    @Provides
    fun provideNoteDao(db: NoteworthyDatabase): NoteDao = db.noteDao()

    @Provides
    fun provideClusterDao(db: NoteworthyDatabase): ClusterDao = db.clusterDao()

    @Provides
    fun provideConceptDao(db: NoteworthyDatabase): ConceptDao = db.conceptDao()

    @Provides
    fun provideDiscoverCardDao(db: NoteworthyDatabase): DiscoverCardDao = db.discoverCardDao()

    @Provides
    fun provideMemoryDao(db: NoteworthyDatabase): MemoryDao = db.memoryDao()

    @Provides
    fun provideLetterDao(db: NoteworthyDatabase): LetterDao = db.letterDao()

    @Provides
    fun provideChatDao(db: NoteworthyDatabase): ChatDao = db.chatDao()

    @Provides
    fun provideDayDrawingDao(db: NoteworthyDatabase): DayDrawingDao = db.dayDrawingDao()
}
