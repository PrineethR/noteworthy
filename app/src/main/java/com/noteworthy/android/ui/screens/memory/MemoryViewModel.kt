package com.noteworthy.android.ui.screens.memory

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.noteworthy.android.data.local.datastore.UserSettingsDataStore
import com.noteworthy.android.data.repository.LetterRepository
import com.noteworthy.android.data.repository.MemoryRepository
import com.noteworthy.android.domain.model.Letter
import com.noteworthy.android.domain.model.MemoryItem
import com.noteworthy.android.domain.model.Profile
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MemoryUiState(
    val letters: List<Letter> = emptyList(),
    val signals: List<MemoryItem> = emptyList(),
    val selectedTab: Int = 0,
    val profile: Profile = Profile.PRINEETH
)

@HiltViewModel
class MemoryViewModel @Inject constructor(
    private val letterRepository: LetterRepository,
    private val memoryRepository: MemoryRepository,
    private val userSettingsDataStore: UserSettingsDataStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(MemoryUiState())
    val uiState: StateFlow<MemoryUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            userSettingsDataStore.userSettings.collect { settings ->
                val profile = Profile.fromId(settings.profile)
                _uiState.update { it.copy(profile = profile) }
                observeData(profile.id)
            }
        }
    }

    private fun observeData(profileId: String) {
        viewModelScope.launch {
            letterRepository.getLetters(profileId).collect { letters ->
                _uiState.update { it.copy(letters = letters) }
            }
        }
        viewModelScope.launch {
            memoryRepository.getMemoryItems(profileId).collect { signals ->
                _uiState.update { it.copy(signals = signals) }
            }
        }
    }

    fun selectTab(tab: Int) {
        _uiState.update { it.copy(selectedTab = tab) }
    }

    fun markLetterRead(letterId: String) {
        viewModelScope.launch {
            letterRepository.markLetterRead(letterId)
        }
    }
}
