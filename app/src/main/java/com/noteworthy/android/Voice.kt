package com.noteworthy.android

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Base64
import android.util.Log
import android.webkit.WebView
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Speaking a note, for walking, cooking and driving.
 *
 * Noteworthy records the microphone itself, for the whole session: a pause
 * to think doesn't end it, and only Done (or the app leaving the screen, a
 * minute of quiet, or five minutes in all) does. Android's recogniser, left
 * to hold the microphone, stopped at the first pause and beeped each time it
 * started and stopped, which is why it no longer holds it.
 *
 * What is recorded goes two ways:
 *  - As it is heard, to the phone's recogniser (Android 13 and later), fed
 *    from here rather than from its own microphone, so the words appear in
 *    the note while you speak (story.js, nwVoice: partial, final).
 *  - When the session ends, the whole recording is kept for the page, which
 *    sends it to Gemini with the note so far and puts back what was said in
 *    place of the live words (NoteworthyAndroid.recording()).
 *
 * The page also hears state(name) and level(x). The microphone is read on a
 * thread of its own, and the recogniser is fed from another, so a recogniser
 * that stops reading never holds up the recording.
 */
class Voice(private val context: Context, private val webView: WebView) {

    private val main = Handler(Looper.getMainLooper())

    // The session, on the main thread.
    private var listening = false    // from start() until the session ends
    private var stopping = false     // Done: the microphone is closing, the last words are on their way
    private var micOpen = false      // the recording thread is still running
    private var startedAt = 0L

    // The recording, written on the microphone's thread.
    @Volatile private var recording = false
    @Volatile private var voiceAt = 0L   // when the microphone last heard something like speech
    private val pcm = ByteArrayOutputStream()
    private var kept: ByteArray? = null  // the last session's recording, as WAV, until the page takes it

    // The live words: a recogniser fed through a pipe from the frames below.
    private val frames = LinkedBlockingQueue<ByteArray>(FRAMES_HELD)
    @Volatile private var feedOut: OutputStream? = null
    @Volatile private var feeding = false
    private var recognizer: SpeechRecognizer? = null
    private var feedIn: ParcelFileDescriptor? = null  // the recogniser's end, until it has its own copy
    private var liveAt = 0L
    private var liveMisses = 0
    private var liveRefused = false   // this phone's recogniser won't take our audio; record only
    private var heard = ""            // the words still being heard, as last shown

    private var levelAt = 0L          // the microphone's thread only

    /** Starts a session. The caller has the microphone permission already. */
    @SuppressLint("MissingPermission") // MainActivity asks for RECORD_AUDIO before calling this.
    fun start() {
        if (listening) return
        val size = AudioRecord.getMinBufferSize(RATE, CHANNEL, ENCODING)
        val mic = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, CHANNEL, ENCODING, max(size, FRAME_BYTES * 8))
        } catch (e: Exception) {
            null
        }
        if (mic == null || mic.state != AudioRecord.STATE_INITIALIZED) {
            mic?.release()
            tell("unavailable")
            return
        }
        listening = true
        stopping = false
        micOpen = true
        kept = null
        heard = ""
        liveMisses = 0
        synchronized(pcm) { pcm.reset() }
        frames.clear()
        startedAt = SystemClock.uptimeMillis()
        voiceAt = startedAt
        // Said before anything is up, so the page answers the tap at once.
        tell("listening")
        try {
            mic.startRecording()
        } catch (e: IllegalStateException) {
            mic.release()
            finish("error")
            return
        }
        recording = true
        feeding = true
        thread(name = "noteworthy-mic") { readMic(mic) }
        thread(name = "noteworthy-feed") { feedRecogniser() }
        main.postDelayed(tooLong, SESSION_MAX_MS)
        main.postDelayed(quietWatch, QUIET_CHECK_MS)
        startLive()
    }

    /** The page's Done. The words of the last stretch still arrive. */
    fun stop() {
        if (!listening || stopping) return
        stopping = true
        main.removeCallbacks(liveAgain)
        recording = false
        // A recogniser that never finishes still lets the session end.
        main.postDelayed(giveUp, STOP_WAIT_MS)
    }

    /** The activity is pausing: keep what was recorded and let the microphone go. */
    fun release() {
        if (!listening) return
        recording = false
        finish("stopped")
    }

    /** For the permission prompt's answer, which comes to the activity. */
    fun denied() = tell("denied")

    /**
     * The last session's recording, as base64 WAV, once: the page asks for
     * it when the session has ended. Empty if there is none. Called on the
     * page's thread.
     */
    fun takeRecording(): String {
        val audio = synchronized(this) { kept.also { kept = null } } ?: return ""
        return Base64.encodeToString(audio, Base64.NO_WRAP)
    }

    private val tooLong = Runnable { stop() }

    private val giveUp = Runnable { finish("stopped") }

    // A minute without anything like speech ends the session.
    private val quietWatch: Runnable = object : Runnable {
        override fun run() {
            if (!listening || stopping) return
            if (SystemClock.uptimeMillis() - voiceAt > QUIET_MAX_MS) stop()
            else main.postDelayed(this, QUIET_CHECK_MS)
        }
    }

    // ── The microphone ─────────────────────────────────────────────────

    private fun readMic(mic: AudioRecord) {
        val frame = ByteArray(FRAME_BYTES)
        var failed = false
        while (recording) {
            val n = mic.read(frame, 0, frame.size)
            if (n < 0) {
                failed = true
                break
            }
            if (n == 0) continue
            synchronized(pcm) { if (pcm.size() < MAX_BYTES) pcm.write(frame, 0, n) }
            val chunk = frame.copyOf(n)
            // The recogniser may be between sessions: hold a couple of
            // seconds for the next one, dropping the oldest beyond that.
            while (!frames.offer(chunk)) frames.poll()
            hearLevel(chunk)
        }
        try { mic.stop() } catch (_: IllegalStateException) { }
        mic.release()
        while (!frames.offer(END)) frames.poll()
        main.post { micClosed(failed) }
    }

    private fun micClosed(failed: Boolean) {
        micOpen = false
        if (!listening) return
        if (failed) {
            finish("error")
            return
        }
        // With no recogniser to wait for, the session ends with the microphone.
        if (stopping && recognizer == null) finish("stopped")
    }

    // Loudness for the page's bars, and whether it was speech, for the quiet
    // watch. At most about thirty times a second.
    private fun hearLevel(chunk: ByteArray) {
        val samples = ByteBuffer.wrap(chunk).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        var sum = 0.0
        val count = samples.remaining()
        if (count == 0) return
        while (samples.hasRemaining()) {
            val s = samples.get().toDouble()
            sum += s * s
        }
        val dbfs = 20 * log10(max(sqrt(sum / count), 1.0) / 32768.0)
        val now = SystemClock.uptimeMillis()
        if (dbfs > SPEECH_DBFS) voiceAt = now
        if (now - levelAt < LEVEL_EVERY_MS) return
        levelAt = now
        val x = ((dbfs - QUIET_DBFS) / (LOUD_DBFS - QUIET_DBFS)).coerceIn(0.0, 1.0)
        main.post {
            if (listening && !stopping) {
                webView.evaluateJavascript("window.nwVoice && nwVoice.level(${String.format(Locale.US, "%.2f", x)})", null)
            }
        }
    }

    // Writes the frames to whichever recogniser is listening. Between
    // recognisers they wait in the queue, so the next one hears them too.
    private fun feedRecogniser() {
        while (feeding) {
            val out = feedOut
            if (out == null) {
                SystemClock.sleep(FRAME_MS)
                continue
            }
            val chunk = frames.poll(200, TimeUnit.MILLISECONDS) ?: continue
            if (chunk === END) {
                // The end of the recording is the end of the recogniser's audio.
                closeFeed()
                break
            }
            try {
                out.write(chunk)
            } catch (e: IOException) {
                if (feedOut === out) feedOut = null
            }
        }
    }

    // ── The live words ─────────────────────────────────────────────────

    private val liveAgain = Runnable { startLive() }

    private fun startLive() {
        if (!listening || stopping || liveRefused || recognizer != null) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            refuseLive("Android ${Build.VERSION.RELEASE} can't feed a recogniser")
            return
        }
        val local = SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        if (!local && !SpeechRecognizer.isRecognitionAvailable(context)) {
            refuseLive("no recogniser")
            return
        }
        val pipe = try {
            ParcelFileDescriptor.createPipe()
        } catch (e: IOException) {
            refuseLive("no pipe")
            return
        }
        val r = try {
            if (local) SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            else SpeechRecognizer.createSpeechRecognizer(context)
        } catch (e: Exception) {
            pipe.forEach { closeQuietly(it) }
            refuseLive("no recogniser made")
            return
        }
        r.setRecognitionListener(listener)
        recognizer = r
        feedIn = pipe[0]
        liveAt = SystemClock.uptimeMillis()
        feedOut = ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])
        r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, pipe[0])
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, ENCODING)
            putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, RATE)
            // One session for as long as the audio lasts: each stretch comes
            // back through onSegmentResults, and closing the pipe ends it.
            putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE)
            if (local) {
                putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY)
                putExtra(RecognizerIntent.EXTRA_HIDE_PARTIAL_TRAILING_PUNCTUATION, true)
            }
        })
        Log.d(TAG, "live words: ${if (local) "on-device" else "usual"} recogniser, fed from Noteworthy's microphone")
    }

    private fun refuseLive(why: String) {
        liveRefused = true
        Log.d(TAG, "no live words ($why); recording only")
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            // The recogniser has its own copy of the pipe now.
            closeQuietly(feedIn)
            feedIn = null
            Log.d(TAG, "recogniser ready")
        }
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onPartialResults(partialResults: Bundle?) {
            if (!listening) return
            val words = wordsIn(partialResults, withUnstable = true)
            if (words.isBlank() || words == heard) return
            heard = words
            page("partial", words)
        }

        override fun onSegmentResults(segmentResults: Bundle) {
            if (!listening) return
            settle(wordsIn(segmentResults, withUnstable = false))
        }

        override fun onResults(results: Bundle?) {
            if (!listening) return
            settle(wordsIn(results, withUnstable = false))
            Log.d(TAG, "recogniser finished a stretch")
            liveEnded(null)
        }

        override fun onEndOfSegmentedSession() {
            Log.d(TAG, "recogniser's session ended")
            liveEnded(null)
        }

        override fun onError(error: Int) {
            Log.d(TAG, "recogniser error $error")
            liveEnded(error)
        }
    }

    private fun settle(words: String) {
        if (words.isBlank()) {
            if (heard.isNotEmpty()) page("partial", "")
        } else {
            page("final", words)
        }
        heard = ""
    }

    /**
     * The recogniser stopped: asked to by the end of the recording, or by
     * itself. While the microphone is still open a fresh one picks up where
     * it left off, from the frames waiting in the queue. A recogniser that
     * fails as soon as it starts, twice, can't take our audio, and the
     * session carries on recording without live words.
     */
    private fun liveEnded(error: Int?) {
        val r = recognizer ?: return
        recognizer = null
        r.destroy()
        closeFeed()
        closeQuietly(feedIn)
        feedIn = null
        if (!listening) return
        keepHeard()
        if (stopping) {
            if (!micOpen) finish("stopped")
            return
        }
        val quick = SystemClock.uptimeMillis() - liveAt < QUICK_MS
        if (error != null && quick && ++liveMisses >= LIVE_MISS_LIMIT) {
            refuseLive("recogniser error $error")
            return
        }
        if (error != null && !quick) liveMisses = 0
        main.postDelayed(liveAgain, RESTART_MS)
    }

    // ── The end ────────────────────────────────────────────────────────

    private fun finish(state: String) {
        if (!listening) return
        listening = false
        stopping = false
        recording = false
        feeding = false
        main.removeCallbacks(tooLong)
        main.removeCallbacks(quietWatch)
        main.removeCallbacks(giveUp)
        main.removeCallbacks(liveAgain)
        recognizer?.destroy()
        recognizer = null
        closeFeed()
        closeQuietly(feedIn)
        feedIn = null
        keepHeard()
        val audio = synchronized(pcm) { pcm.toByteArray().also { pcm.reset() } }
        synchronized(this) { kept = if (state == "stopped" && audio.size >= MIN_BYTES) wav(audio) else null }
        Log.d(TAG, "session ended ($state), ${audio.size / BYTES_PER_SECOND} s recorded")
        tell(state)
    }

    /** The words still being heard become the page's, rather than being lost. */
    private fun keepHeard() {
        if (heard.isBlank()) return
        page("final", heard)
        heard = ""
    }

    private fun closeFeed() {
        val out = feedOut ?: return
        feedOut = null
        try { out.close() } catch (_: IOException) { }
    }

    private fun closeQuietly(fd: ParcelFileDescriptor?) {
        try { fd?.close() } catch (_: IOException) { }
    }

    // 16-bit mono PCM with the 44-byte header a WAV file needs.
    private fun wav(pcm: ByteArray): ByteArray {
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + pcm.size); put("WAVE".toByteArray())
            put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
            putInt(RATE); putInt(BYTES_PER_SECOND); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(pcm.size)
        }
        return header.array() + pcm
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
        // 16 kHz mono 16-bit: what recognisers expect, and small enough to send.
        const val RATE = 16_000
        const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
        const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
        const val BYTES_PER_SECOND = RATE * 2
        const val FRAME_MS = 20L
        const val FRAME_BYTES = (BYTES_PER_SECOND * FRAME_MS / 1000).toInt()
        const val FRAMES_HELD = 150            // three seconds, for a recogniser starting again
        const val SESSION_MAX_MS = 5 * 60_000L // a long note, not a meeting
        const val MAX_BYTES = 5 * 60 * BYTES_PER_SECOND
        const val MIN_BYTES = BYTES_PER_SECOND / 2  // half a second: anything shorter was a tap
        const val QUIET_MAX_MS = 60_000L       // a minute with nothing said ends it
        const val QUIET_CHECK_MS = 5_000L
        const val STOP_WAIT_MS = 2_000L
        const val RESTART_MS = 250L
        const val QUICK_MS = 600L
        const val LIVE_MISS_LIMIT = 2
        const val LEVEL_EVERY_MS = 33L
        // Loudness in dB below full scale: about -50 in a quiet room, -15
        // for a raised voice, and speech above about -45.
        const val QUIET_DBFS = -50.0
        const val LOUD_DBFS = -15.0
        const val SPEECH_DBFS = -45.0
        val END = ByteArray(0)
    }
}
