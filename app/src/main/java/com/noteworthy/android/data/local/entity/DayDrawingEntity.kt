package com.noteworthy.android.data.local.entity

import androidx.room.Entity
import com.noteworthy.android.domain.model.DayDrawing
import com.noteworthy.android.domain.model.DrawingStroke

@Entity(tableName = "day_drawings", primaryKeys = ["date", "profile"])
data class DayDrawingEntity(
    val date: String,
    val profile: String,
    val strokes: List<DrawingStroke> = emptyList(),
    val lineText: String? = null,
    val updatedAt: String
) {
    fun toDomain(): DayDrawing = DayDrawing(date, profile, strokes, lineText, updatedAt)

    companion object {
        fun fromDomain(d: DayDrawing): DayDrawingEntity =
            DayDrawingEntity(d.date, d.profile, d.strokes, d.lineText, d.updatedAt)
    }
}
