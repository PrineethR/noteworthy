package com.noteworthy.android.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.noteworthy.android.domain.model.Concept

@Entity(tableName = "concepts")
data class ConceptEntity(
    @PrimaryKey val id: String,
    val name: String,
    val profile: String,
    val noteCount: Int,
    val createdAt: String,
    val updatedAt: String
) {
    fun toDomain(): Concept = Concept(id, name, profile, noteCount, createdAt, updatedAt)

    companion object {
        fun fromDomain(c: Concept): ConceptEntity =
            ConceptEntity(c.id, c.name, c.profile, c.noteCount, c.createdAt, c.updatedAt)
    }
}
