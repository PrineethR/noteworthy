package com.noteworthy.android

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import android.webkit.WebView
import org.json.JSONObject
import java.util.Locale

/**
 * Speaking a note, for walking, cooking and driving.
 *
 * Android's WebView has no speech API of its own, so the phone's recogniser
 * listens here and the words go to the page as they are heard (story.js,
 * nwVoice). They land in the composer, not in the notebook, so a misheard
 * word can be put right before Send.
 *
 * From Android 13 a recogniser can keep listening through the pauses and
 * hand over each stretch as it ends (a segmented session), so there is one
 * session, one start beep and no gap between stretches. Where it won't, it
 * hears one stretch and stops at the pause after it; each stretch's words
 * are handed over and a new recogniser takes the next one. Either way it
 * goes on until the page says stop, the activity pauses, or the session has
 * run long.
 *
 * The page hears about it through nwVoice: state(name), partial(text),
 * final(text) and level(x). Everything here runs on the main thread, which
 * SpeechRecognizer requires.
 */
class Voice(private val context: Context, private val webView: WebView) {

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null

    // Whether the recogniser running is the phone's on-device one, and
    // whether that one has already failed for this language.
    private var onDevice = false
    private var onDeviceFailed = false

    private var listening = false   // from start() until the session ends
    private var stopping = false    // asked to stop, waiting for the last words
    private var inStretch = false   // the recogniser is hearing a stretch now
    private var retried = false     // one fresh recogniser per session is allowed
    private var segments = false    // this stretch is a segmented session
    private var segmentsRefused = false  // the recogniser wouldn't run one; don't ask again

    private var heard = ""          // the words still being heard, as last shown
    private var startedAt = 0L
    private var stretchAt = 0L
    private var wordsAt = 0L
    private var quickMisses = 0
    private var levelAt = 0L

    /** Starts a session. The caller has the microphone permission already. */
    fun start() {
        if (listening) return
        val local = canListenOnDevice()
        if (!local && !SpeechRecognizer.isRecognitionAvailable(context)) {
            tell("unavailable")
            return
        }
        listening = true
        stopping = false
        retried = false
        quickMisses = 0
        startedAt = SystemClock.uptimeMillis()
        wordsAt = startedAt
        // Said before the recogniser is up, so the page answers the tap at once.
        tell("listening")
        main.postDelayed(tooLong, SESSION_MAX_MS)
        main.postDelayed(quietWatch, QUIET_CHECK_MS)
        if (!fresh(local)) end("unavailable") else hear()
    }

    /** The page's Done. The words of the stretch under way still arrive. */
    fun stop() {
        if (!listening || stopping) return
        if (!inStretch) {
            end("stopped")
            return
        }
        stopping = true
        recognizer?.stopListening()
        main.postDelayed(giveUp, STOP_WAIT_MS)
    }

    /** The activity is pausing: keep what was heard and let the microphone go. */
    fun release() {
        if (listening) {
            keepHeard()
            end("stopped")
        }
    }

    /** For the permission prompt's answer, which comes to the activity. */
    fun denied() = tell("denied")

    private val tooLong = Runnable { stop() }

    // A segmented session never pauses to be asked, so a minute of quiet is
    // looked for here instead.
    private val quietWatch: Runnable = object : Runnable {
        override fun run() {
            if (!listening || stopping) return
            if (SystemClock.uptimeMillis() - wordsAt > QUIET_MAX_MS) stop()
            else main.postDelayed(this, QUIET_CHECK_MS)
        }
    }

    // A recogniser that never answers the stop still ends the session.
    private val giveUp = Runnable {
        if (!listening) return@Runnable
        keepHeard()
        end("stopped")
    }

    // Each stretch gets a recogniser of its own, a moment after the last one
    // finished. Restarting the same one straight away left the on-device
    // recogniser answering "nothing heard" two or three times before it
    // would listen again, and the words said meanwhile were lost.
    private val again = Runnable {
        if (!listening || stopping) return@Runnable
        if (fresh(onDevice)) hear() else end("error")
    }

    private fun canListenOnDevice() =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !onDeviceFailed &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    /** A new recogniser, on-device when asked for. False if none could be made. */
    private fun fresh(local: Boolean): Boolean {
        recognizer?.destroy()
        recognizer = null
        return try {
            val made = if (local && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            } else {
                SpeechRecognizer.createSpeechRecognizer(context)
            }
            made.setRecognitionListener(listener)
            recognizer = made
            onDevice = local
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun hear() {
        val r = recognizer ?: return end("error")
        stretchAt = SystemClock.uptimeMillis()
        inStretch = true
        segments = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !segmentsRefused
        Log.d(TAG, "listening: ${if (onDevice) "on-device" else "usual"} recogniser, ${if (segments) "one session" else "one stretch"}")
        r.startListening(request())
    }

    private fun request() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        // The on-device recogniser can punctuate and capitalise what it hears
        // (Android 13 and later). Only asked of it, where it is documented.
        if (onDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY)
            putExtra(RecognizerIntent.EXTRA_HIDE_PARTIAL_TRAILING_PUNCTUATION, true)
        }
        // One session for the whole note: it runs at least as long as a
        // session may, so only Done (or the limits) ends it, and each
        // stretch comes back through onSegmentResults.
        if (segments && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, SESSION_MAX_MS)
        }
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onRmsChanged(rmsdB: Float) = level(rmsdB)

        override fun onPartialResults(partialResults: Bundle?) {
            if (!listening) return
            val words = wordsIn(partialResults, withUnstable = true)
            if (words.isBlank() || words == heard) return
            heard = words
            wordsAt = SystemClock.uptimeMillis()
            quickMisses = 0
            page("partial", words)
        }

        override fun onResults(results: Bundle?) {
            if (!listening) return
            inStretch = false
            val words = wordsIn(results, withUnstable = false)
            if (words.isNotBlank()) {
                wordsAt = SystemClock.uptimeMillis()
                quickMisses = 0
                retried = false
                heard = ""
                page("final", words)
            } else {
                clearHeard()
            }
            if (stopping) end("stopped") else next()
        }

        override fun onError(error: Int) {
            if (!listening) return
            inStretch = false
            failed(error)
        }

        // A stretch of a segmented session: handed over, and listening goes on.
        override fun onSegmentResults(segmentResults: Bundle) {
            if (!listening) return
            val words = wordsIn(segmentResults, withUnstable = false)
            Log.d(TAG, "stretch heard in one session")
            if (words.isBlank()) {
                clearHeard()
                return
            }
            wordsAt = SystemClock.uptimeMillis()
            quickMisses = 0
            retried = false
            heard = ""
            page("final", words)
        }

        // The session ended: asked to by Done, or of its own accord, in
        // which case the next one starts as a stretch would.
        override fun onEndOfSegmentedSession() {
            if (!listening) return
            inStretch = false
            Log.d(TAG, "one session ended${if (stopping) "" else " by itself"}")
            if (stopping) {
                keepHeard()
                end("stopped")
            } else {
                next()
            }
        }
    }

    /** The next stretch, unless this one was the last worth waiting for. */
    private fun next() {
        val now = SystemClock.uptimeMillis()
        if (now - wordsAt > QUIET_MAX_MS) {
            end("stopped")
            return
        }
        main.postDelayed(again, RESTART_MS)
    }

    @SuppressLint("InlinedApi") // The newer error codes are plain ints; older phones never send them.
    private fun failed(error: Int) {
        if (stopping) {
            keepHeard()
            end("stopped")
            return
        }
        // A recogniser that can't run one session fails it at once. Ask for
        // stretches from then on.
        val quick = SystemClock.uptimeMillis() - stretchAt < QUICK_MISS_MS
        if (segments && quick && error != SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
            Log.d(TAG, "one session refused (error $error); listening a stretch at a time")
            segmentsRefused = true
            keepHeard()
            next()
            return
        }
        when (error) {
            // Nothing said, or nothing it could make out: listen again quietly.
            SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> {
                clearHeard()
                // A recogniser that gives up the moment it starts would spin here.
                quickMisses = if (quick) quickMisses + 1 else 0
                if (quickMisses >= QUICK_MISS_LIMIT) end("error") else next()
            }
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> end("denied")
            // The on-device recogniser doesn't have this language (or has
            // not downloaded it): the phone's usual one may.
            SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> {
                if (onDevice && SpeechRecognizer.isRecognitionAvailable(context)) {
                    onDeviceFailed = true
                    keepHeard()
                    // The next stretch's recogniser is the usual one.
                    onDevice = false
                    next()
                } else {
                    keepHeard()
                    end("unavailable")
                }
            }
            // A recogniser that got into a muddle, often from being restarted
            // quickly. One fresh one is worth a try; the usual one, if the
            // on-device one has not heard a word yet.
            SpeechRecognizer.ERROR_CLIENT, SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
            SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> {
                keepHeard()
                if (retried) {
                    end("error")
                    return
                }
                retried = true
                val silentSoFar = wordsAt == startedAt
                onDevice = onDevice && !(silentSoFar && SpeechRecognizer.isRecognitionAvailable(context))
                main.postDelayed(again, RETRY_MS)
            }
            // The network, the server, the microphone: say so and stop.
            else -> {
                keepHeard()
                end("error")
            }
        }
    }

    private fun end(state: String) {
        listening = false
        stopping = false
        inStretch = false
        main.removeCallbacks(again)
        main.removeCallbacks(giveUp)
        main.removeCallbacks(tooLong)
        main.removeCallbacks(quietWatch)
        recognizer?.destroy()
        recognizer = null
        heard = ""
        tell(state)
    }

    /** The words still being heard become the page's, rather than being lost. */
    private fun keepHeard() {
        if (heard.isBlank()) return
        page("final", heard)
        heard = ""
    }

    private fun clearHeard() {
        if (heard.isEmpty()) return
        heard = ""
        page("partial", "")
    }

    // The loudness, as 0 to 1, at most about thirty times a second.
    private fun level(rmsdB: Float) {
        if (!listening || stopping) return
        val now = SystemClock.uptimeMillis()
        if (now - levelAt < LEVEL_EVERY_MS) return
        levelAt = now
        val x = ((rmsdB - RMS_QUIET) / (RMS_LOUD - RMS_QUIET)).coerceIn(0f, 1f)
        webView.evaluateJavascript(
            "window.nwVoice && nwVoice.level(${String.format(Locale.US, "%.2f", x)})", null
        )
    }

    private fun tell(state: String) = page("state", state)

    private fun page(call: String, text: String) {
        webView.evaluateJavascript("window.nwVoice && nwVoice.$call(${JSONObject.quote(text)})", null)
    }

    private fun wordsIn(results: Bundle?, withUnstable: Boolean): String {
        val stable = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
        if (!withUnstable) return stable.trim()
        // Google's recogniser splits a partial into the words it is sure of
        // and the ones still settling; the page shows both.
        val settling = results?.getStringArrayList(UNSTABLE_TEXT)?.firstOrNull().orEmpty()
        return "$stable $settling".trim()
    }

    private companion object {
        const val TAG = "NoteworthyVoice"
        const val UNSTABLE_TEXT = "android.speech.extra.UNSTABLE_TEXT"
        const val QUIET_CHECK_MS = 5_000L
        const val SESSION_MAX_MS = 5 * 60_000L   // a long note, not a meeting
        const val QUIET_MAX_MS = 60_000L         // a minute with nothing said ends it
        const val STOP_WAIT_MS = 1_500L
        // Long enough for the last recogniser to let go of the microphone,
        // short enough to fall inside the pause that ended the stretch.
        const val RESTART_MS = 250L
        const val RETRY_MS = 250L
        const val QUICK_MISS_MS = 400L
        const val QUICK_MISS_LIMIT = 5
        const val LEVEL_EVERY_MS = 33L
        // Recognisers report loudness in dB, roughly -2 in a quiet room to
        // 10 for a raised voice.
        const val RMS_QUIET = -2f
        const val RMS_LOUD = 10f
    }
}
