package com.noteworthy.android.data.repository

import com.noteworthy.android.domain.model.Note
import com.noteworthy.android.domain.model.Persona
import kotlinx.coroutines.flow.Flow

interface NoteRepository {
    fun getNotes(profile: String): Flow<List<Note>>
    fun observeNoteById(id: String): Flow<Note?>
    suspend fun getNoteById(id: String): Note?
    suspend fun captureNote(
        rawText: String,
        profile: String,
        tags: List<String> = emptyList(),
        persona: String? = null
    ): Note
    suspend fun updateNote(note: Note)
    suspend fun deleteNote(id: String)
    suspend fun deleteNotes(ids: List<String>)
    suspend fun assignCluster(noteIds: List<String>, clusterId: String?)
    suspend fun reprocessNote(noteId: String, personaOverride: String? = null)
    suspend fun analyzeWithPersona(noteId: String, persona: Persona)
}
