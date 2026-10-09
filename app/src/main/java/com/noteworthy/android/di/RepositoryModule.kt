package com.noteworthy.android.di

import com.noteworthy.android.data.repository.*
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindNoteRepository(impl: NoteRepositoryImpl): NoteRepository

    @Binds
    @Singleton
    abstract fun bindClusterRepository(impl: ClusterRepositoryImpl): ClusterRepository

    @Binds
    @Singleton
    abstract fun bindConceptRepository(impl: ConceptRepositoryImpl): ConceptRepository

    @Binds
    @Singleton
    abstract fun bindDiscoverRepository(impl: DiscoverRepositoryImpl): DiscoverRepository

    @Binds
    @Singleton
    abstract fun bindMemoryRepository(impl: MemoryRepositoryImpl): MemoryRepository

    @Binds
    @Singleton
    abstract fun bindLetterRepository(impl: LetterRepositoryImpl): LetterRepository

    @Binds
    @Singleton
    abstract fun bindChatRepository(impl: ChatRepositoryImpl): ChatRepository

    @Binds
    @Singleton
    abstract fun bindDrawingRepository(impl: DrawingRepositoryImpl): DrawingRepository
}
