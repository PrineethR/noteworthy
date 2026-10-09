package com.noteworthy.android.data.local

import androidx.room.TypeConverter
import com.noteworthy.android.domain.model.ChatMessage
import com.noteworthy.android.domain.model.DrawingStroke
import com.noteworthy.android.domain.model.Insights
import com.noteworthy.android.domain.model.NoteImage
import com.noteworthy.android.domain.model.PersonaReading
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class Converters {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @TypeConverter
    fun fromStringList(value: List<String>?): String {
        return json.encodeToString(value ?: emptyList())
    }

    @TypeConverter
    fun toStringList(value: String?): List<String> {
        return if (value.isNullOrBlank()) emptyList() else json.decodeFromString(value)
    }

    @TypeConverter
    fun fromInsights(value: Insights?): String? {
        return value?.let { json.encodeToString(it) }
    }

    @TypeConverter
    fun toInsights(value: String?): Insights? {
        return if (value.isNullOrBlank()) null else json.decodeFromString(value)
    }

    @TypeConverter
    fun fromPersonaReadings(value: Map<String, PersonaReading>?): String {
        return json.encodeToString(value ?: emptyMap())
    }

    @TypeConverter
    fun toPersonaReadings(value: String?): Map<String, PersonaReading> {
        return if (value.isNullOrBlank()) emptyMap() else json.decodeFromString(value)
    }

    @TypeConverter
    fun fromNoteImages(value: List<NoteImage>?): String {
        return json.encodeToString(value ?: emptyList())
    }

    @TypeConverter
    fun toNoteImages(value: String?): List<NoteImage> {
        return if (value.isNullOrBlank()) emptyList() else json.decodeFromString(value)
    }

    @TypeConverter
    fun fromChatMessages(value: List<ChatMessage>?): String {
        return json.encodeToString(value ?: emptyList())
    }

    @TypeConverter
    fun toChatMessages(value: String?): List<ChatMessage> {
        return if (value.isNullOrBlank()) emptyList() else json.decodeFromString(value)
    }

    @TypeConverter
    fun fromDrawingStrokes(value: List<DrawingStroke>?): String {
        return json.encodeToString(value ?: emptyList())
    }

    @TypeConverter
    fun toDrawingStrokes(value: String?): List<DrawingStroke> {
        return if (value.isNullOrBlank()) emptyList() else json.decodeFromString(value)
    }
}
