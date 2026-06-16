package run.gost.wisper

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.view.Menu
import android.view.MenuItem
import android.webkit.WebView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    companion object {
        private const val REQUEST_NOTIFICATIONS = 1
    }

    private lateinit var webView: WebView
    private var boundService: WisperService? = null

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val localBinder = binder as WisperService.LocalBinder
            boundService = localBinder.service

            if (boundService?.isBackendReady == true) {
                webView.loadUrl("http://127.0.0.1:8900")
            } else {
                Toast.makeText(this@MainActivity, "Backend failed to start", Toast.LENGTH_LONG).show()
                finish()
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            boundService = null
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
        }
        setContentView(webView)

        // Request POST_NOTIFICATIONS on Android 13+ so foreground service
        // notification can be shown.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    REQUEST_NOTIFICATIONS
                )
                return  // onRequestPermissionsResult will start the service
            }
        }

        startWisperService()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_NOTIFICATIONS) {
            // Always start the service — foreground service notification is
            // technically exempt from POST_NOTIFICATIONS, but requesting it
            // ensures the notification can be posted through normal channels.
            startWisperService()
        }
    }

    private fun startWisperService() {
        val intent = Intent(this, WisperService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    override fun onDestroy() {
        unbindService(serviceConnection)
        boundService = null
        super.onDestroy()
    }

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
}
