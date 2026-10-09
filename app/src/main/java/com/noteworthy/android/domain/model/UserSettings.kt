package com.noteworthy.android.domain.model

enum class ThemeMode {
    LIGHT,
    DARK,
    SYSTEM
}

enum class FontFamilyPreference(val label: String) {
    NUNITO("Nunito (Soft Sans)"),
    INTER("Inter (Neutral Sans)"),
    SERIF("Editorial (Voice Serif)"),
    MONOSPACE("JetBrains Mono")
}

data class UserSettings(
    val profile: String = Profile.PRINEETH.id,
    val themeMode: ThemeMode = ThemeMode.DARK,
    val fontFamily: FontFamilyPreference = FontFamilyPreference.NUNITO,
    val fontSize: Int = 16,
    val letterSpacing: Float = 0f,
    val audioMute: Boolean = false,
    val audioVolume: Float = 0.5f,
    val geminiApiKey: String? = null,
    val googleTasksListId: String? = null,
    val pin: String? = null
)
