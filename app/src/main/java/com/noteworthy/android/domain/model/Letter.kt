package com.noteworthy.android.domain.model

data class Letter(
    val id: String,
    val profile: String,
    val title: String,
    val body: String,
    val themes: List<String> = emptyList(),
    val isRead: Boolean = false,
    val createdAt: String
)
