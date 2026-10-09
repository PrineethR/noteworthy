package com.noteworthy.android.data.remote

import kotlinx.serialization.Serializable

@Serializable
data class GeminiPart(val text: String)

@Serializable
data class GeminiContent(
    val parts: List<GeminiPart>,
    val role: String? = null
)

@Serializable
data class GeminiGenerationConfig(
    val temperature: Float? = 0.3f,
    val maxOutputTokens: Int? = 8192,
    val responseMimeType: String? = null
)

@Serializable
data class GeminiRequest(
    val contents: List<GeminiContent>,
    val system_instruction: GeminiContent? = null,
    val generationConfig: GeminiGenerationConfig? = null
)

@Serializable
data class GeminiCandidate(
    val content: GeminiContent? = null,
    val finishReason: String? = null
)

@Serializable
data class GeminiResponse(
    val candidates: List<GeminiCandidate>? = null
) {
    val text: String?
        get() = candidates?.firstOrNull()?.content?.parts?.firstOrNull()?.text
}
