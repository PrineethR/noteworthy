package com.noteworthy.android.data.local.dao

import androidx.room.*
import com.noteworthy.android.data.local.entity.ClusterEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ClusterDao {
    @Query("SELECT * FROM clusters WHERE (:profile = 'combined' OR profile = :profile) ORDER BY createdAt ASC")
    fun getClusters(profile: String): Flow<List<ClusterEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCluster(cluster: ClusterEntity)

    @Update
    suspend fun updateCluster(cluster: ClusterEntity)

    @Query("DELETE FROM clusters WHERE id = :id")
    suspend fun deleteCluster(id: String)
}
