package com.noteworthy.android.data.local.dao

import androidx.room.*
import com.noteworthy.android.data.local.entity.NoteEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface NoteDao {
    @Query("SELECT * FROM notes WHERE (:profile = 'combined' OR profile = :profile) ORDER BY createdAt DESC")
    fun getNotes(profile: String): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE id = :id LIMIT 1")
    suspend fun getNoteById(id: String): NoteEntity?

    @Query("SELECT * FROM notes WHERE id = :id")
    fun observeNoteById(id: String): Flow<NoteEntity?>

    @Query("SELECT * FROM notes WHERE status = 'pending' AND (:profile = 'combined' OR profile = :profile)")
    suspend fun getPendingNotes(profile: String): List<NoteEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertNote(note: NoteEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertNotes(notes: List<NoteEntity>)

    @Update
    suspend fun updateNote(note: NoteEntity)

    @Query("DELETE FROM notes WHERE id = :id")
    suspend fun deleteNote(id: String)

    @Query("DELETE FROM notes WHERE id IN (:ids)")
    suspend fun deleteNotes(ids: List<String>)

    @Query("UPDATE notes SET clusterId = :clusterId WHERE id IN (:ids)")
    suspend fun assignCluster(ids: List<String>, clusterId: String?)

    @Query("SELECT * FROM notes WHERE rawText LIKE '%' || :query || '%' OR summary LIKE '%' || :query || '%'")
    fun searchNotes(query: String): Flow<List<NoteEntity>>
}
