package com.noteworthy.android.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.noteworthy.android.domain.model.MemoryItem

@Entity(tableName = "memory_items")
data class MemoryItemEntity(
    @PrimaryKey val id: String,
    val profile: String,
    val noteId: String? = null,
    val type: String,
    val content: String,
    val confidence: Float = 0.5f,
    val createdAt: String
) {
    fun toDomain(): MemoryItem = MemoryItem(id, profile, noteId, type, content, confidence, createdAt)

    companion object {
        fun fromDomain(m: MemoryItem): MemoryItemEntity =
            MemoryItemEntity(m.id, m.profile, m.noteId, m.type, m.content, m.confidence, m.createdAt)
    }
}
