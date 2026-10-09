package com.noteworthy.android.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.noteworthy.android.ui.screens.capture.CaptureScreen
import com.noteworthy.android.ui.screens.chat.ChatScreen
import com.noteworthy.android.ui.screens.dashboard.DashboardScreen
import com.noteworthy.android.ui.screens.days.DaysScreen
import com.noteworthy.android.ui.screens.discover.DiscoverScreen
import com.noteworthy.android.ui.screens.memory.MemoryScreen
import com.noteworthy.android.ui.screens.notes.NoteDetailScreen
import com.noteworthy.android.ui.screens.notes.NotesListScreen
import com.noteworthy.android.ui.screens.settings.SettingsScreen
import com.noteworthy.android.ui.screens.signin.SignInScreen

@Composable
fun NoteworthyNavGraph(
    navController: NavHostController,
    startDestination: String = Screen.Capture.route,
    modifier: Modifier = Modifier
) {
    NavHost(
        navController = navController,
        startDestination = startDestination,
        modifier = modifier
    ) {
        composable(Screen.SignIn.route) {
            SignInScreen(
                viewModel = hiltViewModel(),
                onUnlocked = {
                    navController.navigate(Screen.Capture.route) {
                        popUpTo(Screen.SignIn.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Capture.route) {
            CaptureScreen(
                viewModel = hiltViewModel(),
                onNavigateToNotes = { navController.navigate(Screen.NotesList.route) },
                onNavigateToDiscover = { navController.navigate(Screen.Discover.route) },
                onNavigateToDays = { navController.navigate(Screen.Days.route) },
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) },
                onSwitchProfile = { navController.navigate(Screen.SignIn.route) }
            )
        }

        composable(Screen.NotesList.route) {
            NotesListScreen(
                viewModel = hiltViewModel(),
                onNavigateBack = { navController.popBackStack() },
                onNoteClick = { noteId ->
                    navController.navigate(Screen.NoteDetail.createRoute(noteId))
                }
            )
        }

        composable(
            route = Screen.NoteDetail.route,
            arguments = listOf(navArgument("noteId") { type = NavType.StringType })
        ) {
            NoteDetailScreen(
                viewModel = hiltViewModel(),
                onNavigateBack = { navController.popBackStack() },
                onChatWithNote = { noteId ->
                    navController.navigate(Screen.Chat.createRoute(noteId))
                }
            )
        }

        composable(Screen.Days.route) {
            DaysScreen(
                viewModel = hiltViewModel(),
                onNavigateBack = { navController.popBackStack() },
                onNoteClick = { noteId ->
                    navController.navigate(Screen.NoteDetail.createRoute(noteId))
                }
            )
        }

        composable(Screen.Discover.route) {
            DiscoverScreen(
                viewModel = hiltViewModel(),
                onNavigateBack = { navController.popBackStack() }
            )
        }

        composable(Screen.Dashboard.route) {
            DashboardScreen(
                viewModel = hiltViewModel(),
                onNavigateBack = { navController.popBackStack() }
            )
        }

        composable(Screen.Threads.route) {
            com.noteworthy.android.ui.screens.threads.ThreadsScreen(
                viewModel = hiltViewModel(),
                onNavigateBack = { navController.popBackStack() }
            )
        }

        composable(Screen.Memory.route) {
            MemoryScreen(
                viewModel = hiltViewModel(),
                onNavigateBack = { navController.popBackStack() },
                onAskMemoryClick = {
                    navController.navigate(Screen.Chat.createRoute(null))
                }
            )
        }

        composable(
            route = Screen.Chat.route,
            arguments = listOf(navArgument("noteId") {
                type = NavType.StringType
                nullable = true
                defaultValue = null
            })
        ) {
            ChatScreen(
                viewModel = hiltViewModel(),
                onNavigateBack = { navController.popBackStack() }
            )
        }

        composable(Screen.Settings.route) {
            SettingsScreen(
                viewModel = hiltViewModel(),
                onNavigateBack = { navController.popBackStack() },
                onSignOut = {
                    navController.navigate(Screen.SignIn.route) {
                        popUpTo(Screen.Capture.route) { inclusive = true }
                    }
                }
            )
        }
    }
}
