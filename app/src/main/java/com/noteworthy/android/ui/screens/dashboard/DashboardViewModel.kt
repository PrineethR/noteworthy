package com.noteworthy.android.ui.screens.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.noteworthy.android.data.local.datastore.UserSettingsDataStore
import com.noteworthy.android.data.repository.NoteRepository
import com.noteworthy.android.domain.model.Note
import com.noteworthy.android.domain.model.Profile
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject

data class DashboardUiState(
    val totalNotesCount: Int = 0,
    val todayNotesCount: Int = 0,
    val categoryCounts: Map<String, Int> = emptyMap(),
    val topTags: List<Pair<String, Int>> = emptyList(),
    val profile: Profile = Profile.PRINEETH
)

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val noteRepository: NoteRepository,
    private val userSettingsDataStore: UserSettingsDataStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(DashboardUiState())
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    init {
        val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

        viewModelScope.launch {
            userSettingsDataStore.userSettings.collect { settings ->
                val profile = Profile.fromId(settings.profile)
                _uiState.update { it.copy(profile = profile) }
                noteRepository.getNotes(profile.id).collect { notes ->
                    computeStats(notes, todayStr)
                }
            }
        }
    }

    private fun computeStats(notes: List<Note>, todayStr: String) {
        val todayNotes = notes.filter { it.createdAt.startsWith(todayStr) }
        val catCounts = notes.groupBy { it.category.value }.mapValues { it.value.size }
        val tagsFrequency = notes.flatMap { it.tags }
            .groupingBy { it }
            .eachCount()
            .toList()
            .sortedByDescending { it.second }
            .take(6)

        _uiState.update {
            it.copy(
                totalNotesCount = notes.size,
                todayNotesCount = todayNotes.size,
                categoryCounts = catCounts,
                topTags = tagsFrequency
            )
        }
    }
}
