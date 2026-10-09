package com.noteworthy.android.ui.screens.capture

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.noteworthy.android.ui.components.CharMeter
import com.noteworthy.android.ui.components.PersonaSelector
import com.noteworthy.android.ui.components.ProfileBadge
import com.noteworthy.android.ui.theme.SpectrumCobalt
import com.noteworthy.android.ui.theme.SpectrumSun

@Composable
fun CaptureScreen(
    viewModel: CaptureViewModel,
    onNavigateToNotes: () -> Unit,
    onNavigateToDiscover: () -> Unit,
    onNavigateToDays: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onSwitchProfile: () -> Unit,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                ProfileBadge(
                    profile = state.currentProfile,
                    onClick = onSwitchProfile
                )

                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = viewModel::toggleTheme) {
                        Icon(
                            imageVector = Icons.Default.BrightnessMedium,
                            contentDescription = "Toggle theme",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    IconButton(onClick = onNavigateToDays) {
                        Icon(
                            imageVector = Icons.Default.CalendarToday,
                            contentDescription = "Days calendar",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    // Discover button with badge
                    Box {
                        IconButton(onClick = onNavigateToDiscover) {
                            Icon(
                                imageVector = Icons.Default.AutoAwesome,
                                contentDescription = "Discover",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        if (state.unseenDiscoverCount > 0) {
                            Box(
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(top = 6.dp, end = 6.dp)
                                    .size(16.dp)
                                    .clip(CircleShape)
                                    .background(SpectrumSun),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = state.unseenDiscoverCount.toString(),
                                    color = Color.Black,
                                    fontSize = 9.sp,
                                    style = MaterialTheme.typography.labelSmall
                                )
                            }
                        }
                    }

                    IconButton(onClick = onNavigateToNotes) {
                        Icon(
                            imageVector = Icons.Default.Description,
                            contentDescription = "Notes",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    IconButton(onClick = onNavigateToSettings) {
                        Icon(
                            imageVector = Icons.Default.Settings,
                            contentDescription = "Settings",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        },
        bottomBar = {
            // Capture footer
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(16.dp)
            ) {
                // Persona Selector bar
                PersonaSelector(
                    selectedPersona = state.selectedPersona,
                    onSelect = viewModel::onPersonaSelected,
                    modifier = Modifier.padding(bottom = 12.dp)
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        CharMeter(charCount = state.charCount)

                        FilterChip(
                            selected = state.isReadingMode,
                            onClick = viewModel::toggleReadingMode,
                            label = { Text("Reading", fontSize = 12.sp) },
                            shape = RoundedCornerShape(999.dp)
                        )
                    }

                    // Send Button
                    Button(
                        onClick = { viewModel.sendNote {} },
                        enabled = state.inputText.isNotBlank() && !state.isSending,
                        shape = RoundedCornerShape(999.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary
                        )
                    ) {
                        Text("Send", style = MaterialTheme.typography.labelLarge)
                        Spacer(modifier = Modifier.width(6.dp))
                        Icon(
                            imageVector = Icons.Default.ArrowUpward,
                            contentDescription = "Send note",
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }
        },
        modifier = modifier
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 20.dp, vertical = 8.dp)
        ) {
            OutlinedTextField(
                value = state.inputText,
                onValueChange = viewModel::onInputTextChanged,
                placeholder = {
                    Text(
                        text = if (state.isReadingMode) "Note thoughts from what you are reading…" else "Paste or type anything…",
                        style = MaterialTheme.typography.bodyLarge.copy(
                            fontSize = 18.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                        )
                    )
                },
                modifier = Modifier
                    .fillMaxSize()
                    .border(0.dp, Color.Transparent),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color.Transparent,
                    unfocusedBorderColor = Color.Transparent,
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent
                ),
                textStyle = MaterialTheme.typography.bodyLarge.copy(
                    fontSize = 18.sp,
                    lineHeight = 28.sp,
                    fontFamily = if (state.isReadingMode) FontFamily.Serif else FontFamily.SansSerif
                )
            )
        }
    }
}
