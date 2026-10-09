package com.noteworthy.android.ui.screens.notes

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.noteworthy.android.data.repository.ExportImportRepository
import com.noteworthy.android.data.repository.NoteRepository
import com.noteworthy.android.domain.model.Note
import com.noteworthy.android.domain.model.Persona
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class NoteDetailUiState(
    val note: Note? = null,
    val isEditing: Boolean = false,
    val editedText: String = "",
    val isReadingMode: Boolean = false,
    val isLoading: Boolean = true
)

@HiltViewModel
class NoteDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val noteRepository: NoteRepository,
    private val exportImportRepository: ExportImportRepository
) : ViewModel() {

    private val noteId: String = checkNotNull(savedStateHandle["noteId"])

    private val _uiState = MutableStateFlow(NoteDetailUiState())
    val uiState: StateFlow<NoteDetailUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            noteRepository.observeNoteById(noteId).collect { note ->
                _uiState.update {
                    it.copy(
                        note = note,
                        editedText = note?.rawText.orEmpty(),
                        isLoading = false
                    )
                }
            }
        }
    }

    fun toggleReadingMode() {
        _uiState.update { it.copy(isReadingMode = !it.isReadingMode) }
    }

    fun startEditing() {
        _uiState.update { it.copy(isEditing = true) }
    }

    fun onTextChanged(text: String) {
        _uiState.update { it.copy(editedText = text) }
    }

    fun saveEditing() {
        val current = _uiState.value.note ?: return
        viewModelScope.launch {
            val updated = current.copy(rawText = _uiState.value.editedText)
            noteRepository.updateNote(updated)
            _uiState.update { it.copy(isEditing = false) }
        }
    }

    fun cancelEditing() {
        _uiState.update { it.copy(isEditing = false, editedText = it.note?.rawText.orEmpty()) }
    }

    fun reprocessWithPersona(persona: Persona) {
        viewModelScope.launch {
            noteRepository.analyzeWithPersona(noteId, persona)
        }
    }

    fun deleteNote(onDeleted: () -> Unit) {
        viewModelScope.launch {
            noteRepository.deleteNote(noteId)
            onDeleted()
        }
    }

    fun shareNote() {
        val note = _uiState.value.note ?: return
        exportImportRepository.shareNotesText(note.title, "${note.title}\n\n${note.rawText}")
    }
}
