package com.noteworthy.android.ui.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.noteworthy.android.data.local.datastore.UserSettingsDataStore
import com.noteworthy.android.data.repository.ExportImportRepository
import com.noteworthy.android.data.repository.NoteRepository
import com.noteworthy.android.domain.model.FontFamilyPreference
import com.noteworthy.android.domain.model.ThemeMode
import com.noteworthy.android.domain.model.UserSettings
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val userSettings: UserSettings = UserSettings(),
    val apiKeyInput: String = "",
    val totalNotes: Int = 0
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val userSettingsDataStore: UserSettingsDataStore,
    private val noteRepository: NoteRepository,
    private val exportImportRepository: ExportImportRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            userSettingsDataStore.userSettings.collect { settings ->
                _uiState.update {
                    it.copy(
                        userSettings = settings,
                        apiKeyInput = settings.geminiApiKey.orEmpty()
                    )
                }
            }
        }
        viewModelScope.launch {
            _uiState.map { it.userSettings.profile }.distinctUntilChanged().collect { profile ->
                noteRepository.getNotes(profile).collect { notes ->
                    _uiState.update { it.copy(totalNotes = notes.size) }
                }
            }
        }
    }

    fun onApiKeyChanged(key: String) {
        _uiState.update { it.copy(apiKeyInput = key) }
    }

    fun saveApiKey() {
        viewModelScope.launch {
            userSettingsDataStore.updateGeminiKey(_uiState.value.apiKeyInput.trim())
        }
    }

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch {
            userSettingsDataStore.updateTheme(mode)
        }
    }

    fun setFontFamily(font: FontFamilyPreference) {
        viewModelScope.launch {
            userSettingsDataStore.updateFontFamily(font)
        }
    }

    fun setFontSize(size: Int) {
        viewModelScope.launch {
            userSettingsDataStore.updateFontSize(size)
        }
    }

    fun toggleAudioMute(muted: Boolean) {
        viewModelScope.launch {
            userSettingsDataStore.updateAudio(muted, _uiState.value.userSettings.audioVolume)
        }
    }

    fun setAudioVolume(volume: Float) {
        viewModelScope.launch {
            userSettingsDataStore.updateAudio(_uiState.value.userSettings.audioMute, volume)
        }
    }

    fun exportAndShareNotes() {
        viewModelScope.launch {
            val notes = noteRepository.getNotes(_uiState.value.userSettings.profile).firstOrNull().orEmpty()
            val markdown = exportImportRepository.exportNotesAsMarkdown(notes)
            exportImportRepository.shareNotesText("Noteworthy Export", markdown)
        }
    }

    fun switchProfile(onSignOut: () -> Unit) {
        viewModelScope.launch {
            userSettingsDataStore.updatePin(null)
            onSignOut()
        }
    }
}
