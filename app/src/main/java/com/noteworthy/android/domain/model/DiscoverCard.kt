package com.noteworthy.android.domain.model

enum class DiscoverCardType(val value: String, val label: String) {
    QUOTE("quote", "Quote"),
    QUESTION("question", "Question"),
    EXCERPT("excerpt", "Excerpt"),
    RECOMMENDATION("recommendation", "Recommendation"),
    OBSERVATION("observation", "Observation");

    companion object {
        fun fromValue(value: String?): DiscoverCardType = entries.firstOrNull { it.value.equals(value, ignoreCase = true) } ?: OBSERVATION
    }
}

enum class DiscoverCardStatus(val value: String) {
    UNSEEN("unseen"),
    ACCEPTED("accepted"),
    DISMISSED("dismissed");

    companion object {
        fun fromValue(value: String?): DiscoverCardStatus = entries.firstOrNull { it.value == value } ?: UNSEEN
    }
}

data class DiscoverCard(
    val id: String,
    val profile: String,
    val cardType: DiscoverCardType,
    val content: String,
    val source: String? = null,
    val status: DiscoverCardStatus = DiscoverCardStatus.UNSEEN,
    val createdAt: String
)
