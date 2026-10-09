package com.noteworthy.android.domain.model

enum class Persona(
    val key: String,
    val emoji: String,
    val displayName: String,
    val description: String
) {
    PHILOSOPHER("philosopher", "🏛", "Philosopher", "Ontological, ethical & existential angles"),
    SCIENTIST("scientist", "🔬", "Scientist", "Empirical rigor & hypothesis testing"),
    DESIGNER("designer", "🎨", "Designer", "Form, function & user empathy"),
    STRATEGIST("strategist", "♟", "Strategist", "First-principles & tradeoffs"),
    THERAPIST("therapist", "🧠", "Therapist", "Emotional subtext & cognitive patterns"),
    HISTORIAN("historian", "📜", "Historian", "Historical context & long arcs"),
    POET("poet", "✍️", "Poet", "Metaphor, rhythm & language as feeling"),
    ECONOMIST("economist", "📊", "Economist", "Incentives, systems & second-order effects");

    companion object {
        fun fromKey(key: String?): Persona? = entries.firstOrNull { it.key.equals(key, ignoreCase = true) }
    }
}
