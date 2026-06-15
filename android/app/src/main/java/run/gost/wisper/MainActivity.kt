package run.gost.wisper

import android.os.Bundle
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Start the Go backend in-process via JNI.
        // filesDir = /data/data/run.gost.wisper/files (app sandbox).
        // Listen on loopback only — no external access to the API.
        val err = WisperJNI.start(filesDir.absolutePath, "127.0.0.1:8900")
        if (err != 0) {
            throw RuntimeException("wisper start failed: $err")
        }

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            loadUrl("http://127.0.0.1:8900")
        }
        setContentView(webView)
    }

    override fun onDestroy() {
        WisperJNI.stop()
        super.onDestroy()
    }
}
