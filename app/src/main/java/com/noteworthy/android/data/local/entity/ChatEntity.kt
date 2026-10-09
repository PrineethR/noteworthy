package com.noteworthy.android.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.noteworthy.android.domain.model.Chat
import com.noteworthy.android.domain.model.ChatMessage

@Entity(tableName = "chats")
data class ChatEntity(
    @PrimaryKey val id: String,
    val profile: String,
    val noteId: String? = null,
    val title: String,
    val messages: List<ChatMessage> = emptyList(),
    val createdAt: String,
    val updatedAt: String
) {
    fun toDomain(): Chat = Chat(id, profile, noteId, title, messages, createdAt, updatedAt)

    companion object {
        fun fromDomain(c: Chat): ChatEntity =
            ChatEntity(c.id, c.profile, c.noteId, c.title, c.messages, c.createdAt, c.updatedAt)
    }
}
