package com.noteworthy.android.data.repository

import android.content.Context
import android.content.Intent
import com.noteworthy.android.domain.model.Note
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ExportImportRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val noteRepository: NoteRepository
) {
    private val json = Json { prettyPrint = true }

    fun exportNotesAsMarkdown(notes: List<Note>): String {
        val sb = StringBuilder()
        sb.append("# Noteworthy Export\n\n")
        notes.forEach { note ->
            sb.append("## ${note.title}\n")
            sb.append("**Date:** ${note.createdAt} | **Category:** ${note.category.value}\n")
            if (note.tags.isNotEmpty()) {
                sb.append("**Tags:** ${note.tags.joinToString(", ") { "#$it" }}\n")
            }
            if (!note.summary.isNullOrBlank()) {
                sb.append("> ${note.summary}\n\n")
            }
            sb.append("${note.rawText}\n\n")
            sb.append("---\n\n")
        }
        return sb.toString()
    }

    fun shareNotesText(title: String, content: String) {
        val sendIntent: Intent = Intent().apply {
            action = Intent.ACTION_SEND
            putExtra(Intent.EXTRA_TITLE, title)
            putExtra(Intent.EXTRA_TEXT, content)
            type = "text/plain"
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val shareIntent = Intent.createChooser(sendIntent, "Share Noteworthy Export").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(shareIntent)
    }
}
