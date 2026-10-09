package com.noteworthy.android.data.repository

import com.noteworthy.android.data.local.dao.DiscoverCardDao
import com.noteworthy.android.data.local.entity.DiscoverCardEntity
import com.noteworthy.android.domain.model.DiscoverCard
import com.noteworthy.android.domain.model.DiscoverCardStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

interface DiscoverRepository {
    fun getUnseenCards(profile: String): Flow<List<DiscoverCard>>
    fun getAcceptedCards(profile: String): Flow<List<DiscoverCard>>
    fun observeUnseenCount(profile: String): Flow<Int>
    suspend fun acceptCard(id: String)
    suspend fun dismissCard(id: String)
    suspend fun insertCards(cards: List<DiscoverCard>)
}

@Singleton
class DiscoverRepositoryImpl @Inject constructor(
    private val cardDao: DiscoverCardDao
) : DiscoverRepository {
    override fun getUnseenCards(profile: String): Flow<List<DiscoverCard>> =
        cardDao.getUnseenCards(profile).map { list -> list.map { it.toDomain() } }

    override fun getAcceptedCards(profile: String): Flow<List<DiscoverCard>> =
        cardDao.getAcceptedCards(profile).map { list -> list.map { it.toDomain() } }

    override fun observeUnseenCount(profile: String): Flow<Int> =
        cardDao.observeUnseenCount(profile)

    override suspend fun acceptCard(id: String) {
        cardDao.updateStatus(id, DiscoverCardStatus.ACCEPTED.value)
    }

    override suspend fun dismissCard(id: String) {
        cardDao.updateStatus(id, DiscoverCardStatus.DISMISSED.value)
    }

    override suspend fun insertCards(cards: List<DiscoverCard>) {
        cardDao.insertCards(cards.map { DiscoverCardEntity.fromDomain(it) })
    }
}
