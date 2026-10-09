package com.noteworthy.android.domain.model

data class Concept(
    val id: String,
    val name: String,
    val profile: String,
    val noteCount: Int = 1,
    val createdAt: String,
    val updatedAt: String
)
