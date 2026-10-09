package com.noteworthy.android.ui.screens.notes

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.noteworthy.android.domain.model.Persona
import com.noteworthy.android.ui.components.MarkdownText
import com.noteworthy.android.ui.components.PersonaSelector
import com.noteworthy.android.ui.components.TagChip
import com.noteworthy.android.ui.theme.SpectrumCobalt
import com.noteworthy.android.ui.theme.SpectrumVioletSoft

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteDetailScreen(
    viewModel: NoteDetailViewModel,
    onNavigateBack: () -> Unit,
    onChatWithNote: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()
    val note = state.note

    Scaffold(
        topBar = {
            TopAppBar(
                title = { },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = viewModel::toggleReadingMode) {
                        Icon(
                            imageVector = if (state.isReadingMode) Icons.Default.MenuBook else Icons.Default.AutoStories,
                            contentDescription = "Reading mode"
                        )
                    }
                    IconButton(onClick = viewModel::shareNote) {
                        Icon(Icons.Default.Share, contentDescription = "Share")
                    }
                    IconButton(onClick = { viewModel.deleteNote(onNavigateBack) }) {
                        Icon(Icons.Default.Delete, contentDescription = "Delete note")
                    }
                }
            )
        },
        floatingActionButton = {
            if (note != null) {
                ExtendedFloatingActionButton(
                    onClick = { onChatWithNote(note.id) },
                    icon = { Icon(Icons.Default.ChatBubbleOutline, contentDescription = null) },
                    text = { Text("Ask this note") },
                    containerColor = MaterialTheme.colorScheme.primary
                )
            }
        },
        modifier = modifier
    ) { innerPadding ->
        if (state.isLoading || note == null) {
            Box(
                modifier = Modifier.fillMaxSize().padding(innerPadding),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 12.dp)
            ) {
                // Header tags & status
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TagChip(text = note.category.value)
                    note.tags.forEach { tag ->
                        TagChip(text = tag)
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Note Body
                if (state.isEditing) {
                    OutlinedTextField(
                        value = state.editedText,
                        onValueChange = viewModel::onTextChanged,
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 6
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        horizontalArrangement = Arrangement.End,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        TextButton(onClick = viewModel::cancelEditing) {
                            Text("Cancel")
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Button(onClick = viewModel::saveEditing) {
                            Text("Save")
                        }
                    }
                } else {
                    MarkdownText(
                        text = note.rawText,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(modifier = Modifier.height(8.dp))
                    TextButton(
                        onClick = viewModel::startEditing,
                        modifier = Modifier.align(Alignment.End)
                    ) {
                        Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Edit note")
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // AI Summary Card
                if (!note.summary.isNullOrBlank()) {
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("💡", fontSize = 16.sp)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    "Distillation",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = note.summary,
                                style = MaterialTheme.typography.bodyLarge.copy(
                                    fontFamily = FontFamily.Serif,
                                    lineHeight = 24.sp
                                ),
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(20.dp))
                }

                // Insights section (Themes, References, Books, Follow-up Questions)
                note.insights?.let { ins ->
                    if (ins.themes.isNotEmpty() || ins.references.isNotEmpty() || ins.books.isNotEmpty() || ins.followUps.isNotEmpty()) {
                        Text(
                            text = "Insights & Connections",
                            style = MaterialTheme.typography.titleLarge.copy(fontFamily = FontFamily.Serif),
                            color = MaterialTheme.colorScheme.onBackground
                        )
                        Spacer(modifier = Modifier.height(12.dp))

                        if (ins.themes.isNotEmpty()) {
                            InsightCategory("Themes", ins.themes)
                        }
                        if (ins.references.isNotEmpty()) {
                            InsightCategory("Intellectual References", ins.references)
                        }
                        if (ins.books.isNotEmpty()) {
                            InsightCategory("Recommended Books", ins.books)
                        }
                        if (ins.followUps.isNotEmpty()) {
                            InsightCategory("Questions to Sit With", ins.followUps)
                        }
                        Spacer(modifier = Modifier.height(20.dp))
                    }
                }

                // Re-read with persona
                Text(
                    text = "Re-read through a lens",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onBackground
                )
                Spacer(modifier = Modifier.height(10.dp))
                PersonaSelector(
                    selectedPersona = Persona.fromKey(note.persona),
                    onSelect = { persona ->
                        if (persona != null) {
                            viewModel.reprocessWithPersona(persona)
                        }
                    }
                )

                Spacer(modifier = Modifier.height(80.dp))
            }
        }
    }
}

@Composable
private fun InsightCategory(
    title: String,
    items: List<String>
) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelLarge,
                color = SpectrumCobalt
            )
            Spacer(modifier = Modifier.height(6.dp))
            items.forEach { item ->
                Row(
                    modifier = Modifier.padding(vertical = 3.dp),
                    verticalAlignment = Alignment.Top
                ) {
                    Text("• ", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        text = item,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }
    }
}
