package run.gost.wisper

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.view.Gravity
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : AppCompatActivity() {

    companion object {
        private const val REQUEST_NOTIFICATIONS = 1
        private const val BACKEND_URL = "http://127.0.0.1:8900"
    }

    // ── Views ──────────────────────────────────────────────────────────
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var errorView: View
    private lateinit var rootLayout: FrameLayout

    // ── Service binding ────────────────────────────────────────────────
    private var boundService: WisperService? = null

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val localBinder = binder as WisperService.LocalBinder
            boundService = localBinder.service

            if (boundService?.isBackendReady == true) {
                webView.loadUrl(BACKEND_URL)
            } else {
                showError("Backend failed to start")
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            boundService = null
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // ── Build view hierarchy ───────────────────────────────────
        // FrameLayout stacks: WebView (base) + ProgressBar (loading)
        //                     + errorView (hidden until error)
        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true

            // Dark content algorithmic darkening (API 33+) — helps
            // with pages that don't natively support dark mode.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                settings.isAlgorithmicDarkeningAllowed = true
            }

            webViewClient = WisperWebViewClient()
        }

        progressBar = ProgressBar(this).apply {
            isIndeterminate = true
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.CENTER
            }
        }

        errorView = createErrorView()

        rootLayout = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            addView(webView)
            addView(progressBar)
            addView(errorView)
        }
        setContentView(rootLayout)

        // ── Edge-to-edge insets ────────────────────────────────────
        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { view, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(
                systemBars.left,
                systemBars.top,
                systemBars.right,
                systemBars.bottom
            )
            insets
        }

        // ── Request notification permission (Android 13+) ──────────
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    REQUEST_NOTIFICATIONS
                )
                return // onRequestPermissionsResult will start the service
            }
        }

        startWisperService()
    }

    override fun onDestroy() {
        unbindService(serviceConnection)
        boundService = null
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_NOTIFICATIONS) {
            startWisperService()
        }
    }

    // ── Back button: WebView history first ─────────────────────────────
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    // ── Menu ───────────────────────────────────────────────────────────
    override fun onCreateOptionsMenu(menu: Menu?): Boolean {
        menu?.add(0, 1, 0, "Stop Service")
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == 1) {
            boundService?.let {
                unbindService(serviceConnection)
                boundService = null
            }
            stopService(Intent(this, WisperService::class.java))
            Toast.makeText(this, "Service stopped", Toast.LENGTH_SHORT).show()
            finish()
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    // ── Service launcher ───────────────────────────────────────────────
    private fun startWisperService() {
        val intent = Intent(this, WisperService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    // ── Error UI ───────────────────────────────────────────────────────
    private fun createErrorView(): View {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(
                if (isSystemDarkTheme())
                    Color.parseColor("#1A1A2E")
                else
                    Color.parseColor("#FAFAFA")
            )
            visibility = View.GONE
        }

        val icon = TextView(this).apply {
            text = "⚠"
            textSize = 48f
            gravity = Gravity.CENTER
        }
        container.addView(icon)

        val message = TextView(this).apply {
            text = "Unable to connect to Wisper service.\nPlease try again."
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(
                if (isSystemDarkTheme())
                    Color.parseColor("#E8E8F0")
                else
                    Color.parseColor("#111827")
            )
            setPadding(48, 16, 48, 24)
        }
        container.addView(message)

        val retryButton = Button(this).apply {
            text = "Retry"
            setOnClickListener {
                errorView.visibility = View.GONE
                progressBar.visibility = View.VISIBLE
                startWisperService()
            }
        }
        container.addView(retryButton)

        return container
    }

    private fun showError(message: String) {
        progressBar.visibility = View.GONE
        errorView.visibility = View.VISIBLE
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    // ── System dark theme detection ────────────────────────────────────
    private fun isSystemDarkTheme(): Boolean {
        val nightMode = resources.configuration.uiMode and
                Configuration.UI_MODE_NIGHT_MASK
        return nightMode == Configuration.UI_MODE_NIGHT_YES
    }

    // ── WebViewClient ──────────────────────────────────────────────────
    private inner class WisperWebViewClient : WebViewClient() {

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            progressBar.visibility = View.GONE

            // Inject dark theme class if system is in dark mode.
            // The Lit web app uses :root.dark selector for dark theme.
            if (isSystemDarkTheme()) {
                view?.evaluateJavascript(
                    "document.documentElement.classList.add('dark')",
                    null
                )
            }
        }

        override fun onReceivedError(
            view: WebView?,
            request: WebResourceRequest?,
            error: WebResourceError?
        ) {
            // Only show error for the main page (ignore subresource errors).
            if (request?.isForMainFrame != true) return

            val errorCode = error?.errorCode
            if (errorCode == WebViewClient.ERROR_CONNECT ||
                errorCode == WebViewClient.ERROR_TIMEOUT ||
                errorCode == WebViewClient.ERROR_HOST_LOOKUP
            ) {
                showError("Connection refused — wait for backend or tap Retry")
            }
        }
    }
}
