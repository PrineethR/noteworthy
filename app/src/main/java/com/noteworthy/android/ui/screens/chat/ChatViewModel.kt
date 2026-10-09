package com.noteworthy.android.ui.screens.chat

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.noteworthy.android.data.local.datastore.UserSettingsDataStore
import com.noteworthy.android.data.repository.ChatRepository
import com.noteworthy.android.data.repository.NoteRepository
import com.noteworthy.android.domain.model.Chat
import com.noteworthy.android.domain.model.ChatMessage
import com.noteworthy.android.domain.model.Note
import com.noteworthy.android.domain.model.Profile
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ChatUiState(
    val currentChat: Chat? = null,
    val contextNote: Note? = null,
    val inputMessage: String = "",
    val isSending: Boolean = false,
    val profile: Profile = Profile.PRINEETH
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val chatRepository: ChatRepository,
    private val noteRepository: NoteRepository,
    private val userSettingsDataStore: UserSettingsDataStore
) : ViewModel() {

    val noteId: String? = savedStateHandle["noteId"]

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            userSettingsDataStore.userSettings.collect { settings ->
                val profile = Profile.fromId(settings.profile)
                _uiState.update { it.copy(profile = profile) }
                loadChat(profile.id)
            }
        }

        if (noteId != null) {
            viewModelScope.launch {
                val note = noteRepository.getNoteById(noteId)
                _uiState.update { it.copy(contextNote = note) }
            }
        }
    }

    private fun loadChat(profileId: String) {
        viewModelScope.launch {
            chatRepository.getChats(profileId, noteId).collect { chats ->
                _uiState.update { it.copy(currentChat = chats.firstOrNull()) }
            }
        }
    }

    fun onInputMessageChanged(text: String) {
        _uiState.update { it.copy(inputMessage = text) }
    }

    fun sendMessage() {
        val text = _uiState.value.inputMessage.trim()
        if (text.isBlank() || _uiState.value.isSending) return

        val profile = _uiState.value.profile.id
        val chatId = _uiState.value.currentChat?.id
        val contextNote = _uiState.value.contextNote

        val contextPrompt = if (contextNote != null) {
            "You are a thought partner discussing this note: '${contextNote.rawText}'. Be concise, curious, and collaborative."
        } else {
            "You are a thought partner with full memory of the user's notebook. Discuss ideas conversationally."
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSending = true, inputMessage = "") }
            chatRepository.sendMessage(profile, noteId, chatId, text, contextPrompt)
            _uiState.update { it.copy(isSending = false) }
        }
    }
}
