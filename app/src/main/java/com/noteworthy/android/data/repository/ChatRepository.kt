package com.noteworthy.android.data.repository

import com.noteworthy.android.data.local.dao.ChatDao
import com.noteworthy.android.data.local.datastore.UserSettingsDataStore
import com.noteworthy.android.data.local.entity.ChatEntity
import com.noteworthy.android.data.remote.GeminiApiService
import com.noteworthy.android.data.remote.GeminiContent
import com.noteworthy.android.data.remote.GeminiPart
import com.noteworthy.android.data.remote.GeminiRequest
import com.noteworthy.android.domain.model.Chat
import com.noteworthy.android.domain.model.ChatMessage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.map
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

interface ChatRepository {
    fun getChats(profile: String, noteId: String? = null): Flow<List<Chat>>
    fun observeChatById(id: String): Flow<Chat?>
    suspend fun getChatById(id: String): Chat?
    suspend fun sendMessage(
        profile: String,
        noteId: String?,
        chatId: String?,
        message: String,
        contextPrompt: String? = null
    ): String
}

@Singleton
class ChatRepositoryImpl @Inject constructor(
    private val chatDao: ChatDao,
    private val geminiApiService: GeminiApiService,
    private val userSettingsDataStore: UserSettingsDataStore
) : ChatRepository {

    override fun getChats(profile: String, noteId: String?): Flow<List<Chat>> =
        chatDao.getChats(profile, noteId).map { list -> list.map { it.toDomain() } }

    override fun observeChatById(id: String): Flow<Chat?> =
        chatDao.observeChatById(id).map { it?.toDomain() }

    override suspend fun getChatById(id: String): Chat? =
        chatDao.getChatById(id)?.toDomain()

    override suspend fun sendMessage(
        profile: String,
        noteId: String?,
        chatId: String?,
        message: String,
        contextPrompt: String?
    ): String {
        val now = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())

        val userMessage = ChatMessage(role = "user", content = message)

        val targetChat = if (chatId != null) {
            getChatById(chatId) ?: createNewChat(profile, noteId, message, now)
        } else {
            createNewChat(profile, noteId, message, now)
        }

        val updatedMessages = targetChat.messages + userMessage
        chatDao.updateChat(ChatEntity.fromDomain(targetChat.copy(messages = updatedMessages, updatedAt = now)))

        // Query Gemini API
        val apiKey = userSettingsDataStore.userSettings.firstOrNull()?.geminiApiKey
        val assistantReply = if (!apiKey.isNullOrBlank()) {
            try {
                val systemPrompt = contextPrompt ?: "You are a thoughtful intellectual partner for Noteworthy. Respond conversationally with empathy and depth."
                val history = updatedMessages.map {
                    GeminiContent(
                        parts = listOf(GeminiPart(it.content)),
                        role = if (it.role == "assistant") "model" else "user"
                    )
                }
                val req = GeminiRequest(
                    contents = history,
                    system_instruction = GeminiContent(parts = listOf(GeminiPart(systemPrompt)))
                )
                val resp = geminiApiService.generateContent("gemini-2.5-flash", apiKey, req)
                resp.body()?.text ?: "I am here with you. What would you like to explore next?"
            } catch (e: Exception) {
                "Thinking alongside you: what makes this thought salient to you right now?"
            }
        } else {
            "Offline response: What questions emerge for you when looking at this idea?"
        }

        val finalMessages = updatedMessages + ChatMessage(role = "assistant", content = assistantReply)
        chatDao.updateChat(ChatEntity.fromDomain(targetChat.copy(messages = finalMessages, updatedAt = now)))

        return assistantReply
    }

    private suspend fun createNewChat(profile: String, noteId: String?, firstMessage: String, now: String): Chat {
        val title = if (firstMessage.length > 30) firstMessage.take(30) + "…" else firstMessage
        val chat = Chat(
            id = UUID.randomUUID().toString(),
            profile = profile,
            noteId = noteId,
            title = title,
            messages = emptyList(),
            createdAt = now,
            updatedAt = now
        )
        chatDao.insertChat(ChatEntity.fromDomain(chat))
        return chat
    }
}
