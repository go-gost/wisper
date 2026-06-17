package run.gost.wisper

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

class WisperService : Service() {

    companion object {
        private const val TAG = "WisperService"
        private const val CHANNEL_ID = "wisper_foreground"
        private const val NOTIFICATION_ID = 1
    }

    // ---------------------------------------------------------------
    // WakeLock
    // ---------------------------------------------------------------
    private var wakeLock: PowerManager.WakeLock? = null

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

        acquireWakeLock()

        try {
            val notification = buildNotification()
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
    }

    override fun onBind(intent: Intent?): IBinder = LocalBinder()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "onDestroy")
        releaseWakeLock()
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
                NotificationManager.IMPORTANCE_DEFAULT  // must be DEFAULT or higher for FG service visibility
            ).apply {
                description = getString(R.string.notification_channel_description)
                setShowBadge(false)
                // No sound, no vibration — this is a persistent status indicator
                setSound(null, null)
                enableVibration(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
            Log.i(TAG, "Notification channel created: importance=${channel.importance}")
        }
    }

    private fun buildNotification(): Notification {
        // Tap notification → bring Activity to foreground
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
        }
        val launchPendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_running))
            .setContentText(getString(R.string.app_name))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(launchPendingIntent)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setColor(getColor(android.R.color.holo_blue_dark))
            .build()
    }

    // ---------------------------------------------------------------
    // WakeLock
    // ---------------------------------------------------------------
    private fun acquireWakeLock() {
        val pm = getSystemService(PowerManager::class.java)
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "run.gost.wisper:WakeLock"
        ).apply {
            acquire(10 * 60 * 1000L)
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
    }
}
