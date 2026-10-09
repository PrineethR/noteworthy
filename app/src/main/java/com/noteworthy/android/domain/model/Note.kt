package com.noteworthy.android.domain.model

import kotlinx.serialization.Serializable

@Serializable
enum class NoteStatus(val value: String) {
    PENDING("pending"),
    PROCESSING("processing"),
    PROCESSED("processed"),
    ERROR("error");

    companion object {
        fun fromValue(value: String?): NoteStatus = entries.firstOrNull { it.value == value } ?: PENDING
    }
}

@Serializable
enum class NoteCategory(val value: String) {
    IDEA("idea"),
    TASK("task"),
    JOURNAL("journal"),
    REFERENCE("reference"),
    BRAINSTORM("brainstorm"),
    OTHER("other");

    companion object {
        fun fromValue(value: String?): NoteCategory = entries.firstOrNull { it.value.equals(value, ignoreCase = true) } ?: OTHER
    }
}

@Serializable
data class Insights(
    val themes: List<String> = emptyList(),
    val references: List<String> = emptyList(),
    val books: List<String> = emptyList(),
    val followUps: List<String> = emptyList()
)

@Serializable
data class NoteImage(
    val filename: String,
    val url: String,
    val type: String = "image/jpeg",
    val createdAt: String
)

@Serializable
data class PersonaReading(
    val summary: String = "",
    val insights: Insights? = null
)

data class Note(
    val id: String,
    val profile: String,
    val rawText: String,
    val summary: String? = null,
    val tags: List<String> = emptyList(),
    val category: NoteCategory = NoteCategory.OTHER,
    val sentiment: String? = null,
    val status: NoteStatus = NoteStatus.PENDING,
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
    val title: String
        get() {
            val firstLine = rawText.lineSequence().firstOrNull()?.trim().orEmpty()
            return if (firstLine.isNotBlank()) {
                if (firstLine.length > 60) firstLine.take(60) + "…" else firstLine
            } else "Untitled thought"
        }

    val isRingVoiceNote: Boolean
        get() = tags.contains("ring")

    val isReadingMode: Boolean
        get() = tags.contains("reading")
}
