package com.noteworthy.android

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.content.res.Configuration
import androidx.activity.ComponentActivity
import org.json.JSONObject
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null

    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (fileUploadCallback == null) return@registerForActivityResult
        val results: Array<Uri>? = when {
            result.resultCode != RESULT_OK -> null
            result.data?.data != null -> arrayOf(result.data!!.data!!)
            result.data?.clipData != null -> {
                val clipData = result.data!!.clipData!!
                Array(clipData.itemCount) { i -> clipData.getItemAt(i).uri }
            }
            else -> null
        }
        fileUploadCallback?.onReceiveValue(results)
        fileUploadCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val isNightMode = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val initialPaperColor = if (isNightMode) Color.parseColor("#141312") else Color.parseColor("#FBF7F0")
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(initialPaperColor))

        val rootLayout = FrameLayout(this).apply {
            setBackgroundColor(initialPaperColor)
        }

        // Chrome's inspector, for debug builds only.
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)

        webView = WebView(this).apply {
            setBackgroundColor(initialPaperColor)
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                useWideViewPort = true
                loadWithOverviewMode = false
                textZoom = 100
                cacheMode = WebSettings.LOAD_DEFAULT
                mediaPlaybackRequiresUserGesture = false
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                userAgentString = "${settings.userAgentString} NoteworthyAndroid/1.0"
            }

            val cookieManager = CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)
            cookieManager.setAcceptThirdPartyCookies(this, true)

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val url = request?.url ?: return false
                    val host = url.host ?: ""
                    // Keep app navigation and authentication inside the WebView
                    return if (host.contains("prineethr.com") || host.contains("firebase") || host.contains("localhost")) {
                        false
                    } else {
                        // Open external links in device browser
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, url))
                        } catch (_: Exception) {}
                        true
                    }
                }

                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)

                    // Match the bars to the page's theme. Text size is the page's own business.
                    view?.evaluateJavascript("""
                        document.documentElement.getAttribute('data-theme') || 'dark'
                    """.trimIndent()) { themeResult ->
                        val theme = themeResult?.replace("\"", "") ?: "dark"
                        val isDark = theme == "dark"
                        val currentBg = if (isDark) Color.parseColor("#141312") else Color.parseColor("#FBF7F0")
                        rootLayout.setBackgroundColor(currentBg)
                        webView.setBackgroundColor(currentBg)
                        val controller = WindowCompat.getInsetsController(window, window.decorView)
                        controller.isAppearanceLightStatusBars = !isDark
                        controller.isAppearanceLightNavigationBars = !isDark
                    }
                }

                override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                    super.onReceivedError(view, request, error)
                }
            }

            webChromeClient = object : WebChromeClient() {

                override fun onShowFileChooser(
                    webView: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    fileUploadCallback?.onReceiveValue(null)
                    fileUploadCallback = filePathCallback

                    val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        type = "*/*"
                    }
                    return try {
                        filePickerLauncher.launch(intent)
                        true
                    } catch (e: Exception) {
                        fileUploadCallback = null
                        false
                    }
                }

                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                    val level = consoleMessage?.messageLevel()?.name ?: "LOG"
                    val msg = consoleMessage?.message() ?: ""
                    val src = consoleMessage?.sourceId() ?: ""
                    val line = consoleMessage?.lineNumber() ?: 0
                    android.util.Log.d("NoteworthyWeb", "[$level] $msg ($src:$line)")
                    return super.onConsoleMessage(consoleMessage)
                }
            }

            loadUrl(urlFor(intent))
        }

        rootLayout.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        insetsController.isAppearanceLightStatusBars = !isNightMode
        insetsController.isAppearanceLightNavigationBars = !isNightMode

        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { view, insets ->
            val statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars())
            val navBars = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val bottomPadding = if (ime.bottom > 0) ime.bottom else navBars.bottom
            view.setPadding(0, statusBars.top, 0, bottomPadding)
            insets
        }

        setContentView(rootLayout)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("""
                    (function() {
                        var hasOverlay = (function() {
                            var rsplit = document.getElementById('rsplit-modal');
                            if (rsplit && rsplit.classList.contains('visible')) return true;
                            var settings = document.getElementById('settings-dialog');
                            if (settings && !settings.classList.contains('hidden')) return true;
                            var chat = document.getElementById('chat-panel') || document.querySelector('.chat-panel');
                            if (chat && !chat.classList.contains('hidden')) return true;
                            var noteDetail = document.getElementById('note-detail') || document.querySelector('.note-detail');
                            if (noteDetail && !noteDetail.classList.contains('hidden')) return true;
                            var concept = document.getElementById('concept-detail');
                            if (concept && !concept.classList.contains('hidden')) return true;
                            var synth = document.getElementById('synthesis-detail');
                            if (synth && !synth.classList.contains('hidden')) return true;
                            // Escape closes these through days.js, which also saves what it must.
                            var daysIntro = document.getElementById('days-intro');
                            if (daysIntro && !daysIntro.hidden) return true;
                            var daysWrite = document.getElementById('days-write');
                            if (daysWrite && !daysWrite.hidden) return true;
                            var disc = document.getElementById('discover-card-view');
                            if (disc && !disc.classList.contains('hidden')) return true;
                            var notesPanel = document.getElementById('notes-panel');
                            if (notesPanel && notesPanel.classList.contains('open')) return true;
                            var daysView = document.getElementById('days-view');
                            if (daysView && !daysView.classList.contains('hidden')) {
                                var capBtn = document.querySelector('[data-ch="capture"]');
                                if (capBtn) { capBtn.click(); return true; }
                            }
                            return false;
                        })();
                        if (hasOverlay) {
                            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
                            return true;
                        }
                        return false;
                    })()
                """.trimIndent()) { handledResult ->
                    val handled = handledResult?.replace("\"", "") == "true"
                    if (!handled) {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                        }
                    }
                }
            }
        })
    }

    // A share opens the app at the web app's own share target: ?title=&text=
    // on the start URL, the same shape manifest.json's share_target gives the
    // PWA. app.js stashes it, clears the URL, and fills the composer.
    private fun urlFor(intent: Intent?): String {
        if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return APP_URL
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
        val title = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty()
        if (text.isEmpty() && title.isEmpty()) return APP_URL
        return Uri.parse(APP_URL).buildUpon()
            .appendQueryParameter("title", title)
            .appendQueryParameter("text", text)
            .build()
            .toString()
    }

    // singleTask brings a running app back here rather than stacking a second
    // copy. A reload would lose whatever is half-written in the composer, so
    // when capture is up the share is added to it in place, the way app.js's
    // drainSharedNote does. Anything else (signed out, still loading) reloads.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action != Intent.ACTION_SEND || intent.type != "text/plain") return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
            .ifEmpty { intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty() }
        if (text.isEmpty()) return
        webView.evaluateJavascript("""
            (function(draft) {
                var input = document.getElementById('note-input');
                var capture = document.getElementById('capture-view');
                if (!input || input.disabled || !capture || capture.classList.contains('hidden')) return false;
                var tab = document.querySelector('[data-ch="capture"]');
                if (tab) tab.click();
                var existing = input.value.trim();
                input.value = existing ? existing + '\n\n' + draft : draft;
                input.dispatchEvent(new Event('input'));
                requestAnimationFrame(function() {
                    input.focus();
                    input.setSelectionRange(input.value.length, input.value.length);
                });
                return true;
            })(${JSONObject.quote(text)})
        """.trimIndent()) { handled ->
            if (handled != "true") webView.loadUrl(urlFor(intent))
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val APP_URL = "https://prineethr.com/noteworthy/exp/"
    }
}
