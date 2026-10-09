package com.noteworthy.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.noteworthy.android.ui.theme.*

@Composable
fun TagChip(
    text: String,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    onClick: (() -> Unit)? = null
) {
    val (bg, fg) = when (text.lowercase()) {
        "idea" -> SpectrumSkySoft to SpectrumSky
        "task" -> SpectrumMintSoft to SpectrumMint
        "journal" -> SpectrumVioletSoft to SpectrumViolet
        "brainstorm" -> SpectrumTangerineSoft to SpectrumTangerine
        "ring" -> SpectrumBerrySoft to SpectrumBerry
        "discover" -> SpectrumSunSoft to SpectrumSun
        else -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }

    val finalBg = if (selected) MaterialTheme.colorScheme.primary else bg
    val finalFg = if (selected) MaterialTheme.colorScheme.onPrimary else fg

    Text(
        text = if (text.startsWith("#")) text else "#$text",
        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
        color = finalFg,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(finalBg)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 9.dp, vertical = 4.dp)
    )
}
