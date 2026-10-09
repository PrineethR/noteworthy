package com.noteworthy.android.data.repository

import com.noteworthy.android.data.local.dao.LetterDao
import com.noteworthy.android.data.local.entity.LetterEntity
import com.noteworthy.android.domain.model.Letter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

interface LetterRepository {
    fun getLetters(profile: String): Flow<List<Letter>>
    suspend fun saveLetter(letter: Letter)
    suspend fun markLetterRead(id: String)
    suspend fun deleteLetter(id: String)
}

@Singleton
class LetterRepositoryImpl @Inject constructor(
    private val letterDao: LetterDao
) : LetterRepository {
    override fun getLetters(profile: String): Flow<List<Letter>> =
        letterDao.getLetters(profile).map { list -> list.map { it.toDomain() } }

    override suspend fun saveLetter(letter: Letter) {
        letterDao.insertLetter(LetterEntity.fromDomain(letter))
    }

    override suspend fun markLetterRead(id: String) {
        letterDao.markAsRead(id)
    }

    override suspend fun deleteLetter(id: String) {
        letterDao.deleteLetter(id)
    }
}
