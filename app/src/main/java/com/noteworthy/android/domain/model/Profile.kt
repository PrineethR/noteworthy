package com.noteworthy.android.domain.model

enum class Profile(val id: String, val displayName: String, val defaultPin: String? = null) {
    PRINEETH("prineeth", "Prineeth", "2580"),
    PRAMODDINI("pramoddini", "Pramoddini", "1998"),
    HARINI("harini", "Harini"),
    SHREYA("shreya", "Shreya"),
    KALPESH("kalpesh", "Kalpesh"),
    COMBINED("combined", "Combined");

    companion object {
        fun fromId(id: String?): Profile = entries.firstOrNull { it.id == id } ?: PRINEETH
    }
}
