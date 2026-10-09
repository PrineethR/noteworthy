package com.noteworthy.android.ui.navigation

sealed class Screen(val route: String) {
    data object SignIn : Screen("signin")
    data object Capture : Screen("capture")
    data object NotesList : Screen("notes")
    data object NoteDetail : Screen("notes/{noteId}") {
        fun createRoute(noteId: String) = "notes/$noteId"
    }
    data object Days : Screen("days")
    data object Discover : Screen("discover")
    data object Dashboard : Screen("dashboard")
    data object Threads : Screen("threads")
    data object Memory : Screen("memory")
    data object Chat : Screen("chat?noteId={noteId}") {
        fun createRoute(noteId: String? = null) = if (noteId != null) "chat?noteId=$noteId" else "chat"
    }
    data object Settings : Screen("settings")
}
