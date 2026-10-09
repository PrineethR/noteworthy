package com.noteworthy.android.data.local.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import com.noteworthy.android.domain.model.FontFamilyPreference
import com.noteworthy.android.domain.model.Profile
import com.noteworthy.android.domain.model.ThemeMode
import com.noteworthy.android.domain.model.UserSettings
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "user_settings")

@Singleton
class UserSettingsDataStore @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private object PreferencesKeys {
        val PROFILE = stringPreferencesKey("profile")
        val THEME = stringPreferencesKey("theme")
        val FONT_FAMILY = stringPreferencesKey("font_family")
        val FONT_SIZE = intPreferencesKey("font_size")
        val LETTER_SPACING = floatPreferencesKey("letter_spacing")
        val AUDIO_MUTE = booleanPreferencesKey("audio_mute")
        val AUDIO_VOLUME = floatPreferencesKey("audio_volume")
        val GEMINI_KEY = stringPreferencesKey("gemini_key")
        val GOOGLE_TASKS_LIST_ID = stringPreferencesKey("google_tasks_list_id")
        val PIN = stringPreferencesKey("pin")
    }

    val userSettings: Flow<UserSettings> = context.dataStore.data
        .catch { exception ->
            if (exception is IOException) {
                emit(emptyPreferences())
            } else {
                throw exception
            }
        }
        .map { preferences ->
            val profile = preferences[PreferencesKeys.PROFILE] ?: Profile.PRINEETH.id
            val themeStr = preferences[PreferencesKeys.THEME] ?: ThemeMode.DARK.name
            val themeMode = try { ThemeMode.valueOf(themeStr) } catch (_: Exception) { ThemeMode.DARK }

            val fontStr = preferences[PreferencesKeys.FONT_FAMILY] ?: FontFamilyPreference.NUNITO.name
            val fontFamily = try { FontFamilyPreference.valueOf(fontStr) } catch (_: Exception) { FontFamilyPreference.NUNITO }

            UserSettings(
                profile = profile,
                themeMode = themeMode,
                fontFamily = fontFamily,
                fontSize = preferences[PreferencesKeys.FONT_SIZE] ?: 18,
                letterSpacing = preferences[PreferencesKeys.LETTER_SPACING] ?: 0f,
                audioMute = preferences[PreferencesKeys.AUDIO_MUTE] ?: false,
                audioVolume = preferences[PreferencesKeys.AUDIO_VOLUME] ?: 0.5f,
                geminiApiKey = preferences[PreferencesKeys.GEMINI_KEY],
                googleTasksListId = preferences[PreferencesKeys.GOOGLE_TASKS_LIST_ID],
                pin = preferences[PreferencesKeys.PIN]
            )
        }

    suspend fun updateProfile(profile: String) {
        context.dataStore.edit { it[PreferencesKeys.PROFILE] = profile }
    }

    suspend fun updateTheme(themeMode: ThemeMode) {
        context.dataStore.edit { it[PreferencesKeys.THEME] = themeMode.name }
    }

    suspend fun updateFontFamily(fontFamily: FontFamilyPreference) {
        context.dataStore.edit { it[PreferencesKeys.FONT_FAMILY] = fontFamily.name }
    }

    suspend fun updateFontSize(fontSize: Int) {
        context.dataStore.edit { it[PreferencesKeys.FONT_SIZE] = fontSize }
    }

    suspend fun updateLetterSpacing(spacing: Float) {
        context.dataStore.edit { it[PreferencesKeys.LETTER_SPACING] = spacing }
    }

    suspend fun updateAudio(mute: Boolean, volume: Float) {
        context.dataStore.edit {
            it[PreferencesKeys.AUDIO_MUTE] = mute
            it[PreferencesKeys.AUDIO_VOLUME] = volume
        }
    }

    suspend fun updateGeminiKey(key: String) {
        context.dataStore.edit { it[PreferencesKeys.GEMINI_KEY] = key }
    }

    suspend fun updatePin(pin: String?) {
        context.dataStore.edit {
            if (pin != null) it[PreferencesKeys.PIN] = pin else it.remove(PreferencesKeys.PIN)
        }
    }
}
