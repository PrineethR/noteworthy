package com.noteworthy.android.data.repository

import com.noteworthy.android.data.local.dao.ClusterDao
import com.noteworthy.android.data.local.entity.ClusterEntity
import com.noteworthy.android.domain.model.Cluster
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

interface ClusterRepository {
    fun getClusters(profile: String): Flow<List<Cluster>>
    suspend fun createCluster(name: String, profile: String, color: String = "violet", emoji: String = "📁"): Cluster
    suspend fun updateCluster(cluster: Cluster)
    suspend fun deleteCluster(id: String)
}

@Singleton
class ClusterRepositoryImpl @Inject constructor(
    private val clusterDao: ClusterDao
) : ClusterRepository {
    override fun getClusters(profile: String): Flow<List<Cluster>> =
        clusterDao.getClusters(profile).map { list -> list.map { it.toDomain() } }

    override suspend fun createCluster(name: String, profile: String, color: String, emoji: String): Cluster {
        val now = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())

        val cluster = Cluster(
            id = UUID.randomUUID().toString(),
            name = name,
            profile = profile,
            color = color,
            emoji = emoji,
            createdAt = now
        )
        clusterDao.insertCluster(ClusterEntity.fromDomain(cluster))
        return cluster
    }

    override suspend fun updateCluster(cluster: Cluster) {
        clusterDao.updateCluster(ClusterEntity.fromDomain(cluster))
    }

    override suspend fun deleteCluster(id: String) {
        clusterDao.deleteCluster(id)
    }
}
