package com.noteworthy.android.data.local.dao

import androidx.room.*
import com.noteworthy.android.data.local.entity.DayDrawingEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface DayDrawingDao {
    @Query("SELECT * FROM day_drawings WHERE date = :date AND profile = :profile LIMIT 1")
    fun observeDrawing(date: String, profile: String): Flow<DayDrawingEntity?>

    @Query("SELECT * FROM day_drawings WHERE date = :date AND profile = :profile LIMIT 1")
    suspend fun getDrawing(date: String, profile: String): DayDrawingEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveDrawing(drawing: DayDrawingEntity)
}
