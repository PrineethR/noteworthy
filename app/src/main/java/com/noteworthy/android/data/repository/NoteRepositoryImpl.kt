package com.noteworthy.android.data.repository

import com.noteworthy.android.data.local.dao.NoteDao
import com.noteworthy.android.data.local.datastore.UserSettingsDataStore
import com.noteworthy.android.data.local.entity.NoteEntity
import com.noteworthy.android.data.remote.GeminiApiService
import com.noteworthy.android.data.remote.GeminiContent
import com.noteworthy.android.data.remote.GeminiGenerationConfig
import com.noteworthy.android.data.remote.GeminiPart
import com.noteworthy.android.data.remote.GeminiRequest
import com.noteworthy.android.domain.model.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class NoteRepositoryImpl @Inject constructor(
    private val noteDao: NoteDao,
    private val geminiApiService: GeminiApiService,
    private val userSettingsDataStore: UserSettingsDataStore
) : NoteRepository {

    private val scope = CoroutineScope(Dispatchers.IO)
    private val json = Json { ignoreUnknownKeys = true }

    override fun getNotes(profile: String): Flow<List<Note>> {
        return noteDao.getNotes(profile).map { list -> list.map { it.toDomain() } }
    }

    override fun observeNoteById(id: String): Flow<Note?> {
        return noteDao.observeNoteById(id).map { it?.toDomain() }
    }

    override suspend fun getNoteById(id: String): Note? {
        return noteDao.getNoteById(id)?.toDomain()
    }

    override suspend fun captureNote(
        rawText: String,
        profile: String,
        tags: List<String>,
        persona: String?
    ): Note {
        val now = isoNow()
        val id = UUID.randomUUID().toString()

        // Detect @persona prefix if present
        var cleanPersona = persona
        var cleanText = rawText.trim()
        val personaNames = Persona.entries.map { it.key }
        for (p in personaNames) {
            val prefix = "@$p"
            if (cleanText.startsWith(prefix, ignoreCase = true)) {
                cleanPersona = p
                cleanText = cleanText.substring(prefix.length).trim()
                break
            }
        }

        val initialNote = Note(
            id = id,
            profile = profile,
            rawText = cleanText,
            tags = tags,
            status = NoteStatus.PENDING,
            persona = cleanPersona,
            createdAt = now,
            updatedAt = now
        )

        noteDao.insertNote(NoteEntity.fromDomain(initialNote))

        // Trigger background AI enrichment
        scope.launch {
            processNoteEnrichment(id, cleanText, profile, cleanPersona)
        }

        return initialNote
    }

    override suspend fun updateNote(note: Note) {
        val updated = note.copy(updatedAt = isoNow())
        noteDao.updateNote(NoteEntity.fromDomain(updated))
    }

    override suspend fun deleteNote(id: String) {
        noteDao.deleteNote(id)
    }

    override suspend fun deleteNotes(ids: List<String>) {
        noteDao.deleteNotes(ids)
    }

    override suspend fun assignCluster(noteIds: List<String>, clusterId: String?) {
        noteDao.assignCluster(noteIds, clusterId)
    }

    override suspend fun reprocessNote(noteId: String, personaOverride: String?) {
        val note = getNoteById(noteId) ?: return
        val persona = personaOverride ?: note.persona
        noteDao.updateNote(
            NoteEntity.fromDomain(
                note.copy(status = NoteStatus.PROCESSING, persona = persona, updatedAt = isoNow())
            )
        )
        scope.launch {
            processNoteEnrichment(noteId, note.rawText, note.profile, persona)
        }
    }

    override suspend fun analyzeWithPersona(noteId: String, persona: Persona) {
        reprocessNote(noteId, persona.key)
    }

    private suspend fun processNoteEnrichment(
        noteId: String,
        rawText: String,
        profile: String,
        personaKey: String?
    ) {
        try {
            val apiKey = userSettingsDataStore.userSettings.firstOrNull()?.geminiApiKey
            if (apiKey.isNullOrBlank()) {
                // If offline or no API key, mark processed gracefully
                val note = noteDao.getNoteById(noteId)?.toDomain() ?: return
                noteDao.updateNote(
                    NoteEntity.fromDomain(
                        note.copy(
                            status = NoteStatus.PROCESSED,
                            processedAt = isoNow(),
                            summary = note.rawText.take(120)
                        )
                    )
                )
                return
            }

            val systemPrompt = """
                You are a thoughtful intellectual partner for Noteworthy.
                Analyze this note and return a JSON object with:
                {
                  "summary": "1-2 sentence distillation capturing the core intent",
                  "tags": ["tag1", "tag2"],
                  "category": "idea, task, journal, reference, brainstorm, or other",
                  "sentiment": "positive, negative, neutral, or mixed",
                  "insights": {
                    "themes": ["core theme"],
                    "references": ["intellectual reference or framework"],
                    "books": ["Relevant Book by Author"],
                    "follow_ups": ["Deep exploratory question?"]
                  }
                }
                Return ONLY valid JSON.
            """.trimIndent()

            val request = GeminiRequest(
                contents = listOf(GeminiContent(parts = listOf(GeminiPart(text = rawText)))) ,
                system_instruction = GeminiContent(parts = listOf(GeminiPart(text = systemPrompt))),
                generationConfig = GeminiGenerationConfig(responseMimeType = "application/json")
            )

            val response = geminiApiService.generateContent("gemini-2.5-flash", apiKey, request)
            if (response.isSuccessful) {
                val body = response.body()
                val jsonText = body?.text.orEmpty()
                parseAndUpdateNote(noteId, jsonText)
            } else {
                markProcessedFallback(noteId)
            }
        } catch (e: Exception) {
            markProcessedFallback(noteId)
        }
    }

    private suspend fun parseAndUpdateNote(noteId: String, responseJson: String) {
        val existing = noteDao.getNoteById(noteId)?.toDomain() ?: return
        try {
            val element = json.parseToJsonElement(responseJson).jsonObject
            val summary = element["summary"]?.jsonPrimitive?.contentOrNull
            val category = NoteCategory.fromValue(element["category"]?.jsonPrimitive?.contentOrNull)
            val sentiment = element["sentiment"]?.jsonPrimitive?.contentOrNull

            val parsedTags = element["tags"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
            val mergedTags = (existing.tags + parsedTags).distinct()

            val insightsObj = element["insights"]?.jsonObject
            val themes = insightsObj?.get("themes")?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
            val references = insightsObj?.get("references")?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
            val books = insightsObj?.get("books")?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
            val followUps = insightsObj?.get("follow_ups")?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()

            val insights = Insights(themes = themes, references = references, books = books, followUps = followUps)

            val updated = existing.copy(
                summary = summary ?: existing.summary,
                tags = mergedTags,
                category = category,
                sentiment = sentiment,
                insights = insights,
                status = NoteStatus.PROCESSED,
                processedAt = isoNow(),
                updatedAt = isoNow()
            )
            noteDao.updateNote(NoteEntity.fromDomain(updated))
        } catch (_: Exception) {
            markProcessedFallback(noteId)
        }
    }

    private suspend fun markProcessedFallback(noteId: String) {
        val existing = noteDao.getNoteById(noteId)?.toDomain() ?: return
        noteDao.updateNote(
            NoteEntity.fromDomain(
                existing.copy(
                    status = NoteStatus.PROCESSED,
                    processedAt = isoNow(),
                    summary = existing.summary ?: existing.rawText.take(120)
                )
            )
        )
    }

    private fun isoNow(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())
}
