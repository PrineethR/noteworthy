package com.noteworthy.android.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun MarkdownText(
    text: String,
    modifier: Modifier = Modifier
) {
    val paragraphs = text.split("\n\n")

    Column(modifier = modifier) {
        paragraphs.forEachIndexed { index, para ->
            val trimmed = para.trim()
            if (trimmed.startsWith("### ")) {
                Text(
                    text = trimmed.removePrefix("### "),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.SemiBold
                )
            } else if (trimmed.startsWith("## ")) {
                Text(
                    text = trimmed.removePrefix("## "),
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.Bold
                )
            } else if (trimmed.startsWith("> ")) {
                Text(
                    text = trimmed.removePrefix("> "),
                    style = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Serif),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                Text(
                    text = trimmed,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
            if (index < paragraphs.size - 1) {
                Spacer(modifier = Modifier.height(12.dp))
            }
        }
    }
}
