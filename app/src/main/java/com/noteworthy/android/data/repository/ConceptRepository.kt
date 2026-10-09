package com.noteworthy.android.data.repository

import com.noteworthy.android.data.local.dao.ConceptDao
import com.noteworthy.android.data.local.entity.ConceptEntity
import com.noteworthy.android.domain.model.Concept
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

interface ConceptRepository {
    fun getConcepts(profile: String): Flow<List<Concept>>
    suspend fun saveConcept(concept: Concept)
    suspend fun deleteConcept(id: String)
}

@Singleton
class ConceptRepositoryImpl @Inject constructor(
    private val conceptDao: ConceptDao
) : ConceptRepository {
    override fun getConcepts(profile: String): Flow<List<Concept>> =
        conceptDao.getConcepts(profile).map { list -> list.map { it.toDomain() } }

    override suspend fun saveConcept(concept: Concept) {
        conceptDao.insertConcept(ConceptEntity.fromDomain(concept))
    }

    override suspend fun deleteConcept(id: String) {
        conceptDao.deleteConcept(id)
    }
}
