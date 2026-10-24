package com.noteworthy.android

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.SystemClock
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.VibrationEffect.Composition
import android.os.Vibrator
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import android.view.View

/**
 * The page's haptic score, played on the phone's motor.
 *
 * app.js names a feel for each moment (the tab bar's pip landing, a note
 * saved, a letter opening) and calls NoteworthyAndroid.haptic(name). Where the
 * motor can play composed effects (Android 11 and later, on phones that have
 * them, the Pixel 8 among them), each feel is shaped from its primitives.
 * Anywhere else it falls back to the nearest system click. Both follow the
 * phone's own touch feedback setting.
 */
class Haptics(context: Context, private val view: View) {

    private class Step(val primitive: Int, val scale: Float, val delayMs: Int = 0)

    private val vibrator: Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Vibrator::class.java)
        }

    // Whether the motor has every primitive a feel needs, asked once per feel.
    private val playable = HashMap<String, Boolean>()

    private var lastFeel = ""
    private var lastAt = 0L

    /** Called from the page's thread; one call at a time. */
    fun play(feel: String) {
        val now = SystemClock.uptimeMillis()
        // A new vibration cuts off the one playing. The page often follows a
        // richer feel with a plain tap from the same click, which would cut
        // the roll or the fall short and add nothing, so that tap is dropped.
        if (feel == "tap" && lastFeel != "tap" && now - lastAt < TAP_SHADOW_MS) return
        lastFeel = feel
        lastAt = now

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && compose(feel)) return
        val constant = fallback(feel) ?: return
        view.post { view.performHapticFeedback(constant) }
    }

    // Step.primitive holds the platform's own PRIMITIVE_ constants.
    @SuppressLint("WrongConstant")
    private fun compose(feel: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
        val steps = SCORE[feel] ?: return false
        val motor = vibrator ?: return false
        val ok = playable.getOrPut(feel) {
            motor.hasVibrator() &&
                motor.areAllPrimitivesSupported(*steps.map { it.primitive }.toIntArray())
        }
        if (!ok) return false
        val effect = VibrationEffect.startComposition().apply {
            steps.forEach { addPrimitive(it.primitive, it.scale, it.delayMs) }
        }.compose()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            motor.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH))
        } else {
            @Suppress("DEPRECATION")
            motor.vibrate(effect, TOUCH_AUDIO)
        }
        return true
    }

    private fun fallback(feel: String): Int? {
        val r = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        return when (feel) {
            "tap" -> HapticFeedbackConstants.KEYBOARD_TAP
            "tick" -> HapticFeedbackConstants.CLOCK_TICK
            "draw" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) HapticFeedbackConstants.TEXT_HANDLE_MOVE else null
            "success" -> if (r) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.CONTEXT_CLICK
            "fall" -> if (r) HapticFeedbackConstants.GESTURE_END else HapticFeedbackConstants.CONTEXT_CLICK
            "reject" -> if (r) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
            "pop", "swoosh", "spin" -> HapticFeedbackConstants.CONTEXT_CLICK
            else -> null
        }
    }

    private companion object {
        const val TAP_SHADOW_MS = 150L

        @Suppress("DEPRECATION")
        val TOUCH_AUDIO: AudioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        // Reject has no entry: the system's own REJECT is already the right
        // two taps, and it is what other apps play for the same thing.
        // Read only on Android 11 and later, after asking the motor for each.
        @SuppressLint("InlinedApi")
        val SCORE: Map<String, List<Step>> = mapOf(
            "tap" to listOf(Step(Composition.PRIMITIVE_CLICK, 0.5f)),
            "pop" to listOf(Step(Composition.PRIMITIVE_CLICK, 0.6f), Step(Composition.PRIMITIVE_CLICK, 0.4f, 60)),
            "swoosh" to listOf(Step(Composition.PRIMITIVE_QUICK_FALL, 0.5f)),
            "success" to listOf(Step(Composition.PRIMITIVE_QUICK_RISE, 0.6f), Step(Composition.PRIMITIVE_CLICK, 1f, 40)),
            "tick" to listOf(Step(Composition.PRIMITIVE_TICK, 0.6f)),
            "spin" to listOf(Step(Composition.PRIMITIVE_SPIN, 0.5f)),
            "draw" to listOf(Step(Composition.PRIMITIVE_LOW_TICK, 0.6f)),
            "fall" to listOf(Step(Composition.PRIMITIVE_QUICK_FALL, 0.8f)),
        )
    }
}
