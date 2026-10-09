package com.noteworthy.android.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.noteworthy.android.domain.model.DiscoverCard
import com.noteworthy.android.domain.model.DiscoverCardStatus
import com.noteworthy.android.domain.model.DiscoverCardType

@Entity(tableName = "discover_cards")
data class DiscoverCardEntity(
    @PrimaryKey val id: String,
    val profile: String,
    val cardType: String,
    val content: String,
    val source: String? = null,
    val status: String = "unseen",
    val createdAt: String
) {
    fun toDomain(): DiscoverCard = DiscoverCard(
        id = id,
        profile = profile,
        cardType = DiscoverCardType.fromValue(cardType),
        content = content,
        source = source,
        status = DiscoverCardStatus.fromValue(status),
        createdAt = createdAt
    )

    companion object {
        fun fromDomain(c: DiscoverCard): DiscoverCardEntity = DiscoverCardEntity(
            id = c.id,
            profile = c.profile,
            cardType = c.cardType.value,
            content = c.content,
            source = c.source,
            status = c.status.value,
            createdAt = c.createdAt
        )
    }
}
