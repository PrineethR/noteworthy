package com.noteworthy.android.data.repository

import com.noteworthy.android.data.local.dao.DayDrawingDao
import com.noteworthy.android.data.local.entity.DayDrawingEntity
import com.noteworthy.android.domain.model.DayDrawing
import com.noteworthy.android.domain.model.DrawingStroke
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

interface DrawingRepository {
    fun observeDrawing(date: String, profile: String): Flow<DayDrawing?>
    suspend fun getDrawing(date: String, profile: String): DayDrawing?
    suspend fun saveDrawing(date: String, profile: String, strokes: List<DrawingStroke>, lineText: String? = null)
}

@Singleton
class DrawingRepositoryImpl @Inject constructor(
    private val dayDrawingDao: DayDrawingDao
) : DrawingRepository {

    override fun observeDrawing(date: String, profile: String): Flow<DayDrawing?> =
        dayDrawingDao.observeDrawing(date, profile).map { it?.toDomain() }

    override suspend fun getDrawing(date: String, profile: String): DayDrawing? =
        dayDrawingDao.getDrawing(date, profile)?.toDomain()

    override suspend fun saveDrawing(
        date: String,
        profile: String,
        strokes: List<DrawingStroke>,
        lineText: String?
    ) {
        val now = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())

        val entity = DayDrawingEntity(
            date = date,
            profile = profile,
            strokes = strokes,
            lineText = lineText,
            updatedAt = now
        )
        dayDrawingDao.saveDrawing(entity)
    }
}
