package com.noteworthy.android.ui.screens.signin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.noteworthy.android.data.local.datastore.UserSettingsDataStore
import com.noteworthy.android.domain.model.Profile
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SignInUiState(
    val selectedProfile: Profile? = null,
    val pinInput: String = "",
    val error: String? = null,
    val isUnlocked: Boolean = false
)

@HiltViewModel
class SignInViewModel @Inject constructor(
    private val userSettingsDataStore: UserSettingsDataStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(SignInUiState())
    val uiState: StateFlow<SignInUiState> = _uiState.asStateFlow()

    fun selectProfile(profile: Profile) {
        if (profile == Profile.COMBINED || profile.defaultPin == null) {
            unlockProfile(profile)
        } else {
            _uiState.update { it.copy(selectedProfile = profile, pinInput = "", error = null) }
        }
    }

    fun onPinChanged(pin: String) {
        _uiState.update { it.copy(pinInput = pin, error = null) }
        val profile = _uiState.value.selectedProfile
        if (profile != null && profile.defaultPin != null && pin.length >= 4) {
            verifyPin(pin, profile)
        }
    }

    fun verifyPin(pin: String, profile: Profile) {
        if (pin == profile.defaultPin) {
            unlockProfile(profile)
        } else {
            _uiState.update { it.copy(error = "Incorrect PIN", pinInput = "") }
        }
    }

    fun backToProfiles() {
        _uiState.update { it.copy(selectedProfile = null, pinInput = "", error = null) }
    }

    private fun unlockProfile(profile: Profile) {
        viewModelScope.launch {
            userSettingsDataStore.updateProfile(profile.id)
            _uiState.update { it.copy(isUnlocked = true) }
        }
    }
}
