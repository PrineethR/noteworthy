package com.noteworthy.android.data.local.dao

import androidx.room.*
import com.noteworthy.android.data.local.entity.MemoryItemEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface MemoryDao {
    @Query("SELECT * FROM memory_items WHERE (:profile = 'combined' OR profile = :profile) ORDER BY confidence DESC, createdAt DESC")
    fun getMemoryItems(profile: String): Flow<List<MemoryItemEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMemoryItems(items: List<MemoryItemEntity>)

    @Query("DELETE FROM memory_items WHERE id = :id")
    suspend fun deleteMemoryItem(id: String)
}
