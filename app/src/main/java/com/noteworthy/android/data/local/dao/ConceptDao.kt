package com.noteworthy.android.data.local.dao

import androidx.room.*
import com.noteworthy.android.data.local.entity.ConceptEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ConceptDao {
    @Query("SELECT * FROM concepts WHERE (:profile = 'combined' OR profile = :profile) ORDER BY noteCount DESC")
    fun getConcepts(profile: String): Flow<List<ConceptEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertConcept(concept: ConceptEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertConcepts(concepts: List<ConceptEntity>)

    @Update
    suspend fun updateConcept(concept: ConceptEntity)

    @Query("DELETE FROM concepts WHERE id = :id")
    suspend fun deleteConcept(id: String)
}
