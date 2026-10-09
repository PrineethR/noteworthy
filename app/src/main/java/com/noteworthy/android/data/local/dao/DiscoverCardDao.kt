package com.noteworthy.android.data.local.dao

import androidx.room.*
import com.noteworthy.android.data.local.entity.DiscoverCardEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface DiscoverCardDao {
    @Query("SELECT * FROM discover_cards WHERE (:profile = 'combined' OR profile = :profile) AND status = 'unseen' ORDER BY createdAt DESC")
    fun getUnseenCards(profile: String): Flow<List<DiscoverCardEntity>>

    @Query("SELECT * FROM discover_cards WHERE (:profile = 'combined' OR profile = :profile) AND status = 'accepted' ORDER BY createdAt DESC")
    fun getAcceptedCards(profile: String): Flow<List<DiscoverCardEntity>>

    @Query("SELECT COUNT(*) FROM discover_cards WHERE (:profile = 'combined' OR profile = :profile) AND status = 'unseen'")
    fun observeUnseenCount(profile: String): Flow<Int>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCards(cards: List<DiscoverCardEntity>)

    @Query("UPDATE discover_cards SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: String, status: String)
}
