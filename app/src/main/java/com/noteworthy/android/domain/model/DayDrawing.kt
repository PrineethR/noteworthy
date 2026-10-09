package com.noteworthy.android.domain.model

import kotlinx.serialization.Serializable

@Serializable
data class DrawingPoint(
    val x: Float,
    val y: Float,
    val pressure: Float = 1.0f
)

@Serializable
data class DrawingStroke(
    val points: List<DrawingPoint> = emptyList(),
    val color: String = "#1D1C1A",
    val strokeWidth: Float = 3.0f
)

data class DayDrawing(
    val date: String, // "YYYY-MM-DD"
    val profile: String,
    val strokes: List<DrawingStroke> = emptyList(),
    val lineText: String? = null,
    val updatedAt: String
)
