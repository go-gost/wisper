package run.gost.wisper

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

class WisperService : Service() {

    companion object {
        private const val TAG = "WisperService"
        private const val CHANNEL_ID = "wisper_foreground"
        private const val NOTIFICATION_ID = 1
        private const val POLL_INTERVAL_MS = 2000L
    }

    // ---------------------------------------------------------------
    // Stats polling (background thread to avoid NetworkOnMainThreadException)
    // ---------------------------------------------------------------
    private val pollThread = HandlerThread("StatsPoller").apply { start() }
    private val pollHandler = Handler(pollThread.looper)
    private val pollRunnable = object : Runnable {
        override fun run() {
            fetchAndUpdateNotification()
            pollHandler.postDelayed(this, POLL_INTERVAL_MS)
        }
    }

    // ---------------------------------------------------------------
    // Binder — exposes service state to bound activities
    // ---------------------------------------------------------------
    inner class LocalBinder : Binder() {
        val service: WisperService get() = this@WisperService
    }

    /** Volatile so the Activity can read it after binding. */
    @Volatile
    var isBackendReady: Boolean = false
        private set

    // ---------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------
    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate")

        createNotificationChannel()

        // Start Go backend. The listen() call happens synchronously inside
        // wisperStartGo, so by the time it returns the port is open.
        val err = WisperJNI.start(filesDir.absolutePath, "127.0.0.1:8900")
        if (err != 0) {
            Log.e(TAG, "wisper start failed: $err")
            stopSelf()
            return
        }
        isBackendReady = true

        try {
            val notification = buildNotification(
                getString(R.string.app_name),
                getString(R.string.notification_running)
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID, notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            Log.i(TAG, "startForeground succeeded")
        } catch (e: Exception) {
            Log.e(TAG, "startForeground failed", e)
        }

        // Start periodic stats polling on background thread
        pollHandler.postDelayed(pollRunnable, POLL_INTERVAL_MS)
    }

    override fun onBind(intent: Intent?): IBinder = LocalBinder()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "onDestroy")
        pollHandler.removeCallbacks(pollRunnable)
        pollThread.quitSafely()
        WisperJNI.stop()
        super.onDestroy()
    }

    // ---------------------------------------------------------------
    // Notification
    // ---------------------------------------------------------------
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notification_channel_description)
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
            Log.i(TAG, "Notification channel created: importance=${channel.importance}")
        }
    }

    private fun buildNotification(rateText: String, totalText: String): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
        }
        val launchPendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(rateText)
            .setContentText(totalText)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(launchPendingIntent)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setColor(getColor(android.R.color.holo_blue_dark))
            .build()
    }

    private fun updateNotification(rateText: String, totalText: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(rateText, totalText))
    }

    // ---------------------------------------------------------------
    // Stats fetching
    // ---------------------------------------------------------------
    private fun fetchAndUpdateNotification() {
        try {
            val url = URL("http://127.0.0.1:8900/api/stats")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 1500
            conn.readTimeout = 1500
            conn.requestMethod = "GET"
            conn.setRequestProperty("Accept", "application/json")

            val code = conn.responseCode
            if (code != 200) {
                Log.w(TAG, "stats HTTP $code")
                return
            }

            val body = BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
            conn.disconnect()

            val json = JSONObject(body)
            val (totalInRate, totalOutRate) = sumRates(json.optJSONArray("tunnels"))
            val (epInRate, epOutRate) = sumRates(json.optJSONArray("entrypoints"))
            val (totalInBytes, totalOutBytes) = sumBytes(json.optJSONArray("tunnels"))
            val (epInBytes, epOutBytes) = sumBytes(json.optJSONArray("entrypoints"))

            val combinedInRate = totalInRate + epInRate
            val combinedOutRate = totalOutRate + epOutRate
            val combinedInBytes = totalInBytes + epInBytes
            val combinedOutBytes = totalOutBytes + epOutBytes

            val rateText = String.format(
                "↑ %s/s  ↓ %s/s",
                formatBytes(combinedInRate),
                formatBytes(combinedOutRate)
            )
            val totalText = String.format(
                "↑ %s  ↓ %s",
                formatBytes(combinedInBytes),
                formatBytes(combinedOutBytes)
            )

            updateNotification(rateText, totalText)
        } catch (e: Exception) {
            Log.w(TAG, "stats poll failed", e)
        }
    }

    private fun sumRates(arr: org.json.JSONArray?): Pair<Long, Long> {
        if (arr == null) return Pair(0L, 0L)
        var inRate = 0L
        var outRate = 0L
        for (i in 0 until arr.length()) {
            val stats = arr.getJSONObject(i).optJSONObject("stats") ?: continue
            inRate += stats.optLong("input_rate_bytes", 0)
            outRate += stats.optLong("output_rate_bytes", 0)
        }
        return Pair(inRate, outRate)
    }

    private fun sumBytes(arr: org.json.JSONArray?): Pair<Long, Long> {
        if (arr == null) return Pair(0L, 0L)
        var inBytes = 0L
        var outBytes = 0L
        for (i in 0 until arr.length()) {
            val stats = arr.getJSONObject(i).optJSONObject("stats") ?: continue
            inBytes += stats.optLong("input_bytes", 0)
            outBytes += stats.optLong("output_bytes", 0)
        }
        return Pair(inBytes, outBytes)
    }

    // ---------------------------------------------------------------
    // Formatting
    // ---------------------------------------------------------------
    private fun formatBytes(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        val units = arrayOf("KB", "MB", "GB", "TB")
        var value = bytes.toDouble()
        var unitIdx = -1
        while (value >= 1024.0 && unitIdx < units.size - 1) {
            value /= 1024.0
            unitIdx++
        }
        return if (unitIdx < 0) {
            "$bytes B"
        } else if (value >= 100.0) {
            String.format("%.0f %s", value, units[unitIdx])
        } else if (value >= 10.0) {
            String.format("%.1f %s", value, units[unitIdx])
        } else {
            String.format("%.2f %s", value, units[unitIdx])
        }
    }
}
