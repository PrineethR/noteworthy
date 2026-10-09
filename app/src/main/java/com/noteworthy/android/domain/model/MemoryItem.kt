package com.noteworthy.android.domain.model

data class MemoryItem(
    val id: String,
    val profile: String,
    val noteId: String? = null,
    val type: String, // interest, value, trait, goal
    val content: String,
    val confidence: Float = 0.5f,
    val createdAt: String
)
