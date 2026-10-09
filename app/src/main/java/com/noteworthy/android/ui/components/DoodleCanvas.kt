package com.noteworthy.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import com.noteworthy.android.domain.model.DrawingPoint
import com.noteworthy.android.domain.model.DrawingStroke

@Composable
fun DoodleCanvas(
    strokes: List<DrawingStroke>,
    onStrokesChanged: (List<DrawingStroke>) -> Unit,
    modifier: Modifier = Modifier
) {
    var currentPoints by remember { mutableStateOf<List<DrawingPoint>>(emptyList()) }
    val strokeColor = MaterialTheme.colorScheme.onSurface

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(280.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(16.dp))
    ) {
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectDragGestures(
                        onDragStart = { offset ->
                            currentPoints = listOf(DrawingPoint(offset.x, offset.y))
                        },
                        onDrag = { change, _ ->
                            change.consume()
                            val pos = change.position
                            currentPoints = currentPoints + DrawingPoint(pos.x, pos.y)
                        },
                        onDragEnd = {
                            if (currentPoints.isNotEmpty()) {
                                val newStroke = DrawingStroke(
                                    points = currentPoints,
                                    color = "#${Integer.toHexString(strokeColor.hashCode())}",
                                    strokeWidth = 3.5f
                                )
                                onStrokesChanged(strokes + newStroke)
                                currentPoints = emptyList()
                            }
                        },
                        onDragCancel = {
                            currentPoints = emptyList()
                        }
                    )
                }
        ) {
            // Render committed strokes
            strokes.forEach { stroke ->
                if (stroke.points.size > 1) {
                    val path = Path().apply {
                        moveTo(stroke.points[0].x, stroke.points[0].y)
                        for (i in 1 until stroke.points.size) {
                            val p = stroke.points[i]
                            lineTo(p.x, p.y)
                        }
                    }
                    drawPath(
                        path = path,
                        color = strokeColor,
                        style = Stroke(
                            width = stroke.strokeWidth.dp.toPx(),
                            cap = StrokeCap.Round,
                            join = StrokeJoin.Round
                        )
                    )
                }
            }

            // Render live dragging stroke
            if (currentPoints.size > 1) {
                val path = Path().apply {
                    moveTo(currentPoints[0].x, currentPoints[0].y)
                    for (i in 1 until currentPoints.size) {
                        val p = currentPoints[i]
                        lineTo(p.x, p.y)
                    }
                }
                drawPath(
                    path = path,
                    color = strokeColor,
                    style = Stroke(
                        width = 3.5f.dp.toPx(),
                        cap = StrokeCap.Round,
                        join = StrokeJoin.Round
                    )
                )
            }
        }

        // Actions toolbar: Undo and Clear
        Row(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            IconButton(
                onClick = {
                    if (strokes.isNotEmpty()) {
                        onStrokesChanged(strokes.dropLast(1))
                    }
                },
                enabled = strokes.isNotEmpty()
            ) {
                Icon(
                    imageVector = Icons.Default.Undo,
                    contentDescription = "Undo stroke",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            IconButton(
                onClick = { onStrokesChanged(emptyList()) },
                enabled = strokes.isNotEmpty()
            ) {
                Icon(
                    imageVector = Icons.Default.Delete,
                    contentDescription = "Clear canvas",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
