package com.noteworthy.android.ui.screens.notes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.noteworthy.android.data.local.datastore.UserSettingsDataStore
import com.noteworthy.android.data.repository.ClusterRepository
import com.noteworthy.android.data.repository.NoteRepository
import com.noteworthy.android.domain.model.Cluster
import com.noteworthy.android.domain.model.Note
import com.noteworthy.android.domain.model.Profile
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class NotesListUiState(
    val profile: Profile = Profile.PRINEETH,
    val notes: List<Note> = emptyList(),
    val clusters: List<Cluster> = emptyList(),
    val selectedClusterId: String? = null,
    val searchQuery: String = "",
    val selectedNoteIds: Set<String> = emptySet(),
    val isSelectionMode: Boolean = false,
    val isLoading: Boolean = false
)

@HiltViewModel
class NotesListViewModel @Inject constructor(
    private val noteRepository: NoteRepository,
    private val clusterRepository: ClusterRepository,
    private val userSettingsDataStore: UserSettingsDataStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(NotesListUiState())
    val uiState: StateFlow<NotesListUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            userSettingsDataStore.userSettings.collect { settings ->
                val profile = Profile.fromId(settings.profile)
                _uiState.update { it.copy(profile = profile) }
                observeNotes(profile.id)
                observeClusters(profile.id)
            }
        }
    }

    private fun observeNotes(profileId: String) {
        viewModelScope.launch {
            noteRepository.getNotes(profileId).collect { notes ->
                _uiState.update { it.copy(notes = notes) }
            }
        }
    }

    private fun observeClusters(profileId: String) {
        viewModelScope.launch {
            clusterRepository.getClusters(profileId).collect { clusters ->
                _uiState.update { it.copy(clusters = clusters) }
            }
        }
    }

    fun onSearchQueryChanged(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    fun onSelectCluster(clusterId: String?) {
        _uiState.update { it.copy(selectedClusterId = clusterId) }
    }

    fun toggleNoteSelection(noteId: String) {
        _uiState.update { state ->
            val newSelected = if (state.selectedNoteIds.contains(noteId)) {
                state.selectedNoteIds - noteId
            } else {
                state.selectedNoteIds + noteId
            }
            state.copy(
                selectedNoteIds = newSelected,
                isSelectionMode = newSelected.isNotEmpty()
            )
        }
    }

    fun clearSelection() {
        _uiState.update { it.copy(selectedNoteIds = emptySet(), isSelectionMode = false) }
    }

    fun deleteSelectedNotes() {
        viewModelScope.launch {
            noteRepository.deleteNotes(_uiState.value.selectedNoteIds.toList())
            clearSelection()
        }
    }

    fun assignSelectedToCluster(clusterId: String?) {
        viewModelScope.launch {
            noteRepository.assignCluster(_uiState.value.selectedNoteIds.toList(), clusterId)
            clearSelection()
        }
    }
}
