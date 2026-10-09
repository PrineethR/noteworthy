package com.noteworthy.android.data.local.dao

import androidx.room.*
import com.noteworthy.android.data.local.entity.LetterEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface LetterDao {
    @Query("SELECT * FROM letters WHERE (:profile = 'combined' OR profile = :profile) ORDER BY createdAt DESC")
    fun getLetters(profile: String): Flow<List<LetterEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLetter(letter: LetterEntity)

    @Query("UPDATE letters SET isRead = 1 WHERE id = :id")
    suspend fun markAsRead(id: String)

    @Query("DELETE FROM letters WHERE id = :id")
    suspend fun deleteLetter(id: String)
}
