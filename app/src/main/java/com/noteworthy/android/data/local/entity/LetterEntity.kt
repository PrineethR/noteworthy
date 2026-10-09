package com.noteworthy.android.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.noteworthy.android.domain.model.Letter

@Entity(tableName = "letters")
data class LetterEntity(
    @PrimaryKey val id: String,
    val profile: String,
    val title: String,
    val body: String,
    val themes: List<String> = emptyList(),
    val isRead: Boolean = false,
    val createdAt: String
) {
    fun toDomain(): Letter = Letter(id, profile, title, body, themes, isRead, createdAt)

    companion object {
        fun fromDomain(l: Letter): LetterEntity =
            LetterEntity(l.id, l.profile, l.title, l.body, l.themes, l.isRead, l.createdAt)
    }
}
