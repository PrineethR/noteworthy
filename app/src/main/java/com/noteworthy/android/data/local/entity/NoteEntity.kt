package com.noteworthy.android.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.noteworthy.android.domain.model.Insights
import com.noteworthy.android.domain.model.Note
import com.noteworthy.android.domain.model.NoteCategory
import com.noteworthy.android.domain.model.NoteImage
import com.noteworthy.android.domain.model.NoteStatus
import com.noteworthy.android.domain.model.PersonaReading

@Entity(tableName = "notes")
data class NoteEntity(
    @PrimaryKey val id: String,
    val profile: String,
    val rawText: String,
    val summary: String? = null,
    val tags: List<String> = emptyList(),
    val category: String = "other",
    val sentiment: String? = null,
    val status: String = "pending",
    val persona: String? = null,
    val clusterId: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val processedAt: String? = null,
    val insights: Insights? = null,
    val personaReadings: Map<String, PersonaReading> = emptyMap(),
    val images: List<NoteImage> = emptyList(),
    val concepts: List<String> = emptyList(),
    val discoverCardId: String? = null
) {
    fun toDomain(): Note = Note(
        id = id,
        profile = profile,
        rawText = rawText,
        summary = summary,
        tags = tags,
        category = NoteCategory.fromValue(category),
        sentiment = sentiment,
        status = NoteStatus.fromValue(status),
        persona = persona,
        clusterId = clusterId,
        createdAt = createdAt,
        updatedAt = updatedAt,
        processedAt = processedAt,
        insights = insights,
        personaReadings = personaReadings,
        images = images,
        concepts = concepts,
        discoverCardId = discoverCardId
    )

    companion object {
        fun fromDomain(note: Note): NoteEntity = NoteEntity(
            id = note.id,
            profile = note.profile,
            rawText = note.rawText,
            summary = note.summary,
            tags = note.tags,
            category = note.category.value,
            sentiment = note.sentiment,
            status = note.status.value,
            persona = note.persona,
            clusterId = note.clusterId,
            createdAt = note.createdAt,
            updatedAt = note.updatedAt,
            processedAt = note.processedAt,
            insights = note.insights,
            personaReadings = note.personaReadings,
            images = note.images,
            concepts = note.concepts,
            discoverCardId = note.discoverCardId
        )
    }
}
