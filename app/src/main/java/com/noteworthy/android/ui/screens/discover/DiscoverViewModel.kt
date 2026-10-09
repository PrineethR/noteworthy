package com.noteworthy.android.ui.screens.discover

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.noteworthy.android.data.local.datastore.UserSettingsDataStore
import com.noteworthy.android.data.repository.DiscoverRepository
import com.noteworthy.android.data.repository.NoteRepository
import com.noteworthy.android.domain.model.DiscoverCard
import com.noteworthy.android.domain.model.Profile
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DiscoverUiState(
    val unseenCards: List<DiscoverCard> = emptyList(),
    val acceptedCards: List<DiscoverCard> = emptyList(),
    val isShowingAccepted: Boolean = false,
    val profile: Profile = Profile.PRINEETH
)

@HiltViewModel
class DiscoverViewModel @Inject constructor(
    private val discoverRepository: DiscoverRepository,
    private val noteRepository: NoteRepository,
    private val userSettingsDataStore: UserSettingsDataStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(DiscoverUiState())
    val uiState: StateFlow<DiscoverUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            userSettingsDataStore.userSettings.collect { settings ->
                val profile = Profile.fromId(settings.profile)
                _uiState.update { it.copy(profile = profile) }
                observeCards(profile.id)
            }
        }
    }

    private fun observeCards(profileId: String) {
        viewModelScope.launch {
            discoverRepository.getUnseenCards(profileId).collect { cards ->
                _uiState.update { it.copy(unseenCards = cards) }
            }
        }
        viewModelScope.launch {
            discoverRepository.getAcceptedCards(profileId).collect { cards ->
                _uiState.update { it.copy(acceptedCards = cards) }
            }
        }
    }

    fun toggleAcceptedTab(showAccepted: Boolean) {
        _uiState.update { it.copy(isShowingAccepted = showAccepted) }
    }

    fun acceptCard(card: DiscoverCard) {
        viewModelScope.launch {
            discoverRepository.acceptCard(card.id)
            // Convert to note with #discover tag
            val noteText = if (!card.source.isNullOrBlank()) {
                "${card.content}\n\n— ${card.source}"
            } else {
                card.content
            }
            noteRepository.captureNote(
                rawText = noteText,
                profile = card.profile,
                tags = listOf("discover", card.cardType.value)
            )
        }
    }

    fun dismissCard(cardId: String) {
        viewModelScope.launch {
            discoverRepository.dismissCard(cardId)
        }
    }
}
