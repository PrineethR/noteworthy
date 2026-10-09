package com.noteworthy.android.domain.model

data class Cluster(
    val id: String,
    val name: String,
    val profile: String,
    val color: String = "violet",
    val emoji: String = "📁",
    val createdAt: String
)

enum class ClusterColor(val id: String, val hex: String) {
    AMBER("amber", "#F59E0B"),
    ROSE("rose", "#F43F5E"),
    VIOLET("violet", "#8B5CF6"),
    TEAL("teal", "#14B8A6"),
    SKY("sky", "#0EA5E9"),
    LIME("lime", "#84CC16");

    companion object {
        fun fromId(id: String?): ClusterColor = entries.firstOrNull { it.id == id } ?: VIOLET
    }
}
