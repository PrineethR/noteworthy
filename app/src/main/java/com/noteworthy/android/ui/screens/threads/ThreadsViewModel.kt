package com.noteworthy.android.ui.screens.threads

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.noteworthy.android.data.local.datastore.UserSettingsDataStore
import com.noteworthy.android.data.repository.ClusterRepository
import com.noteworthy.android.data.repository.ConceptRepository
import com.noteworthy.android.domain.model.Cluster
import com.noteworthy.android.domain.model.Concept
import com.noteworthy.android.domain.model.Profile
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ThreadsUiState(
    val selectedTab: Int = 0, // 0 = Concepts, 1 = Clusters
    val concepts: List<Concept> = emptyList(),
    val clusters: List<Cluster> = emptyList(),
    val profile: Profile = Profile.PRINEETH
)

@HiltViewModel
class ThreadsViewModel @Inject constructor(
    private val conceptRepository: ConceptRepository,
    private val clusterRepository: ClusterRepository,
    private val userSettingsDataStore: UserSettingsDataStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(ThreadsUiState())
    val uiState: StateFlow<ThreadsUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            userSettingsDataStore.userSettings.collect { settings ->
                val profile = Profile.fromId(settings.profile)
                _uiState.update { it.copy(profile = profile) }
                conceptRepository.getConcepts(profile.id).collect { concepts ->
                    _uiState.update { it.copy(concepts = concepts) }
                }
            }
        }
        viewModelScope.launch {
            _uiState.map { it.profile }.distinctUntilChanged().collect { profile ->
                clusterRepository.getClusters(profile.id).collect { clusters ->
                    _uiState.update { it.copy(clusters = clusters) }
                }
            }
        }
    }

    fun selectTab(tab: Int) {
        _uiState.update { it.copy(selectedTab = tab) }
    }

    fun createCluster(name: String, emoji: String, color: String) {
        viewModelScope.launch {
            clusterRepository.createCluster(name, _uiState.value.profile.id, color, emoji)
        }
    }
}
