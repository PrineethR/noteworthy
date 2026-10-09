package com.noteworthy.android.data.repository

import com.noteworthy.android.data.local.dao.MemoryDao
import com.noteworthy.android.data.local.entity.MemoryItemEntity
import com.noteworthy.android.domain.model.MemoryItem
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

interface MemoryRepository {
    fun getMemoryItems(profile: String): Flow<List<MemoryItem>>
    suspend fun saveMemoryItems(items: List<MemoryItem>)
    suspend fun deleteMemoryItem(id: String)
}

@Singleton
class MemoryRepositoryImpl @Inject constructor(
    private val memoryDao: MemoryDao
) : MemoryRepository {
    override fun getMemoryItems(profile: String): Flow<List<MemoryItem>> =
        memoryDao.getMemoryItems(profile).map { list -> list.map { it.toDomain() } }

    override suspend fun saveMemoryItems(items: List<MemoryItem>) {
        memoryDao.insertMemoryItems(items.map { MemoryItemEntity.fromDomain(it) })
    }

    override suspend fun deleteMemoryItem(id: String) {
        memoryDao.deleteMemoryItem(id)
    }
}
