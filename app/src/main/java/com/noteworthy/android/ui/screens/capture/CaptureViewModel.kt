package com.noteworthy.android.ui.screens.capture

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.noteworthy.android.data.local.datastore.UserSettingsDataStore
import com.noteworthy.android.data.repository.DiscoverRepository
import com.noteworthy.android.data.repository.NoteRepository
import com.noteworthy.android.domain.model.Persona
import com.noteworthy.android.domain.model.Profile
import com.noteworthy.android.domain.model.ThemeMode
import com.noteworthy.android.domain.model.UserSettings
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CaptureUiState(
    val currentProfile: Profile = Profile.PRINEETH,
    val inputText: String = "",
    val charCount: Int = 0,
    val selectedPersona: Persona? = null,
    val isReadingMode: Boolean = false,
    val isSending: Boolean = false,
    val unseenDiscoverCount: Int = 0,
    val userSettings: UserSettings = UserSettings()
)

@HiltViewModel
class CaptureViewModel @Inject constructor(
    private val noteRepository: NoteRepository,
    private val discoverRepository: DiscoverRepository,
    private val userSettingsDataStore: UserSettingsDataStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(CaptureUiState())
    val uiState: StateFlow<CaptureUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            userSettingsDataStore.userSettings.collect { settings ->
                _uiState.update {
                    it.copy(
                        currentProfile = Profile.fromId(settings.profile),
                        userSettings = settings
                    )
                }
            }
        }

        viewModelScope.launch {
            _uiState.map { it.currentProfile }
                .distinctUntilChanged()
                .flatMapLatest { profile ->
                    discoverRepository.observeUnseenCount(profile.id)
                }
                .collect { count ->
                    _uiState.update { it.copy(unseenDiscoverCount = count) }
                }
        }
    }

    fun onInputTextChanged(text: String) {
        _uiState.update { it.copy(inputText = text, charCount = text.length) }
    }

    fun onPersonaSelected(persona: Persona?) {
        _uiState.update { it.copy(selectedPersona = persona) }
    }

    fun toggleReadingMode() {
        _uiState.update { it.copy(isReadingMode = !it.isReadingMode) }
    }

    fun toggleTheme() {
        viewModelScope.launch {
            val nextTheme = when (_uiState.value.userSettings.themeMode) {
                ThemeMode.DARK -> ThemeMode.LIGHT
                ThemeMode.LIGHT -> ThemeMode.DARK
                ThemeMode.SYSTEM -> ThemeMode.DARK
            }
            userSettingsDataStore.updateTheme(nextTheme)
        }
    }

    fun sendNote(onComplete: () -> Unit) {
        val text = _uiState.value.inputText.trim()
        if (text.isBlank()) return

        val profile = _uiState.value.currentProfile
        val persona = _uiState.value.selectedPersona?.key
        val tags = if (_uiState.value.isReadingMode) listOf("reading") else emptyList()

        viewModelScope.launch {
            _uiState.update { it.copy(isSending = true) }
            noteRepository.captureNote(
                rawText = text,
                profile = profile.id,
                tags = tags,
                persona = persona
            )
            _uiState.update {
                it.copy(
                    inputText = "",
                    charCount = 0,
                    selectedPersona = null,
                    isSending = false
                )
            }
            onComplete()
        }
    }
}
