package com.noteworthy.android.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.noteworthy.android.domain.model.Cluster

@Entity(tableName = "clusters")
data class ClusterEntity(
    @PrimaryKey val id: String,
    val name: String,
    val profile: String,
    val color: String,
    val emoji: String,
    val createdAt: String
) {
    fun toDomain(): Cluster = Cluster(id, name, profile, color, emoji, createdAt)

    companion object {
        fun fromDomain(c: Cluster): ClusterEntity =
            ClusterEntity(c.id, c.name, c.profile, c.color, c.emoji, c.createdAt)
    }
}
