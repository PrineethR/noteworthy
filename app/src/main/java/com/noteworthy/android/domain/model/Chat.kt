package com.noteworthy.android.domain.model

import kotlinx.serialization.Serializable

@Serializable
data class ChatMessage(
    val role: String, // "user" or "assistant"
    val content: String,
    val timestamp: Long = System.currentTimeMillis()
)

data class Chat(
    val id: String,
    val profile: String,
    val noteId: String? = null, // null for notebook/memory chat
    val title: String,
    val messages: List<ChatMessage> = emptyList(),
    val createdAt: String,
    val updatedAt: String
)
