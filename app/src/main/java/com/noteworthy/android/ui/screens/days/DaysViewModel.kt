package com.noteworthy.android.ui.screens.days

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.noteworthy.android.data.local.datastore.UserSettingsDataStore
import com.noteworthy.android.data.repository.DrawingRepository
import com.noteworthy.android.data.repository.NoteRepository
import com.noteworthy.android.domain.model.DayDrawing
import com.noteworthy.android.domain.model.DrawingStroke
import com.noteworthy.android.domain.model.Note
import com.noteworthy.android.domain.model.Profile
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject

data class DaysUiState(
    val selectedDate: String = "", // "YYYY-MM-DD"
    val displayDate: String = "",
    val profile: Profile = Profile.PRINEETH,
    val dayNotes: List<Note> = emptyList(),
    val dayDrawing: DayDrawing? = null
)

@HiltViewModel
class DaysViewModel @Inject constructor(
    private val noteRepository: NoteRepository,
    private val drawingRepository: DrawingRepository,
    private val userSettingsDataStore: UserSettingsDataStore
) : ViewModel() {

    private val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    private val displayFormat = SimpleDateFormat("EEEE, MMMM d", Locale.US)

    private val _uiState = MutableStateFlow(
        DaysUiState(
            selectedDate = dateFormat.format(Date()),
            displayDate = displayFormat.format(Date())
        )
    )
    val uiState: StateFlow<DaysUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            userSettingsDataStore.userSettings.collect { settings ->
                val profile = Profile.fromId(settings.profile)
                _uiState.update { it.copy(profile = profile) }
                loadDateData(_uiState.value.selectedDate, profile.id)
            }
        }
    }

    fun changeDay(offsetDays: Int) {
        val current = dateFormat.parse(_uiState.value.selectedDate) ?: Date()
        val calendar = Calendar.getInstance().apply {
            time = current
            add(Calendar.DAY_OF_YEAR, offsetDays)
        }
        val newDate = dateFormat.format(calendar.time)
        val newDisplay = displayFormat.format(calendar.time)
        _uiState.update { it.copy(selectedDate = newDate, displayDate = newDisplay) }
        loadDateData(newDate, _uiState.value.profile.id)
    }

    private fun loadDateData(dateStr: String, profileId: String) {
        viewModelScope.launch {
            noteRepository.getNotes(profileId).collect { allNotes ->
                val filtered = allNotes.filter { it.createdAt.startsWith(dateStr) }
                _uiState.update { it.copy(dayNotes = filtered) }
            }
        }
        viewModelScope.launch {
            drawingRepository.observeDrawing(dateStr, profileId).collect { drawing ->
                _uiState.update { it.copy(dayDrawing = drawing) }
            }
        }
    }

    fun onStrokesChanged(strokes: List<DrawingStroke>) {
        viewModelScope.launch {
            drawingRepository.saveDrawing(_uiState.value.selectedDate, _uiState.value.profile.id, strokes)
        }
    }
}
