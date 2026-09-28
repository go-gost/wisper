package run.gost.wisper

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Hosts the Go backend in the foreground, and decides whether the app needs a
 * VPN device: a tun entrypoint is the only thing that wants one, so this
 * service polls for a running one and asks [TunVpnService] for the device (or
 * for its release).
 *
 * The device itself lives in that other service because only a *stopped*
 * VpnService clears a VPN — see the note there.
 */
class WisperService : Service() {

    companion object {
        private const val TAG = "WisperService"
        private const val CHANNEL_ID = "wisper_foreground"
        private const val NOTIFICATION_ID = 1
        private const val VPN_NOTIFICATION_ID = 2
        private const val POLL_INTERVAL_MS = 2000L
        private const val BACKEND_URL = "http://127.0.0.1:8900"
    }

    // ---------------------------------------------------------------
    // Stats polling (background thread to avoid NetworkOnMainThreadException)
    // ---------------------------------------------------------------
    private val pollThread = HandlerThread("StatsPoller").apply { start() }
    private val pollHandler = Handler(pollThread.looper)
    private val pollRunnable = object : Runnable {
        override fun run() {
            fetchAndUpdateNotification()
            ensureVpn()
            pollHandler.postDelayed(this, POLL_INTERVAL_MS)
        }
    }

    // ---------------------------------------------------------------
    // VPN
    // ---------------------------------------------------------------
    /**
     * A tun device config the UI handed over before creating or updating its
     * entrypoint. The entrypoint cannot be created before its device exists, and
     * the device can only come from VpnService, so the form arms the VPN with
     * its own values. Dropped once the entrypoint carrying those values is
     * running: from then on the running entrypoint, not the form, decides
     * whether the VPN is needed.
     */
    @Volatile
    private var armedOptions: JSONObject? = null

    /** Whether the foreground promotion for a VPN has already been done; the
     *  service type cannot be taken back, and asking for it twice is noise. */
    @Volatile
    private var vpnPromoted = false

    /**
     * Remembers the tun device config the UI is about to create, so the next
     * poll can bring the device up for it. Called from the web UI (through the
     * Activity's bridge) before it posts a tun entrypoint.
     */
    fun armVpn(net: String, routes: String, mtu: Int, dns: String) {
        armedOptions = JSONObject().apply {
            put("net", net)
            put("routes", routes)
            put("mtu", mtu)
            put("dns", dns)
        }
        kickVpn()
    }

    /** Runs the VPN step now instead of waiting for the next poll tick. */
    fun kickVpn() {
        pollHandler.post { ensureVpn() }
    }

    /** Whether a device is up — what the UI waits for before creating its entrypoint. */
    fun vpnReady(): Boolean = VpnStatus.established

    /**
     * Brings the VPN up for the tun device the app is about to use — the armed
     * config, or an existing tun entrypoint's. A user who has not permitted the
     * VPN yet gets a nudge notification instead: establishing needs consent,
     * which only an Activity can ask for.
     *
     * Every failure here is logged, never thrown: this runs on the poll thread,
     * where an uncaught exception takes the whole service (and the backend with
     * it) down.
     */
    private fun ensureVpn() {
        try {
            val running = runningTunEntrypoint()?.optJSONObject("options")
            val armed = armedOptions

            // The form's armed values exist to give an entrypoint that is about
            // to be created or updated its device. Once the entrypoint carrying
            // those values is running they are redundant — and they must not
            // outlive it, or a stopped entrypoint would keep the VPN up.
            if (running != null && armed != null && deviceOf(armed).config() == deviceOf(running).config()) {
                armedOptions = null
            }

            val opts = armedOptions ?: running
            if (opts == null) {
                // Nothing wants a device. Releasing is what stops the VPN from
                // outliving its reason — including the system's idea of it,
                // which only a stopped VpnService clears.
                if (VpnStatus.established) {
                    Log.i(TAG, "no running tun entrypoint: releasing the VPN device")
                    TunVpnService.release(this)
                }
                return
            }

            val device = deviceOf(opts)
            if (VpnStatus.established && VpnStatus.config == device.config()) {
                // A device is up: a consent lost since (the user or another VPN
                // took it away) deserves a fresh nudge, not the old flag.
                vpnNudged = false
                promoteForegroundForVpn()
                return
            }

            // Consent belongs to the Activity (only it can show the dialog), so
            // a missing one is a nudge, not an attempt.
            if (VpnService.prepare(this) != null) {
                nudgeVpnPermission()
                return
            }

            if (VpnStatus.established) {
                // A changed config needs a new device; the old one goes away
                // with it, so a running entrypoint has to be started again.
                Log.i(TAG, "VPN config changed, re-establishing")
            }
            TunVpnService.ensure(this, device)
        } catch (e: Exception) {
            Log.w(TAG, "VPN poll failed", e)
        }
    }

    /**
     * The fields that define the device. The form's armed values and an
     * entrypoint's stored options describe the same device with different key
     * sets, so comparing whole JSON objects would call every swap between the
     * two a change and rebuild the device — which kills the copy the running
     * entrypoint holds.
     */
    private fun deviceOf(opts: JSONObject): VpnStatus.Device = VpnStatus.Device(
        net = opts.optString("net"),
        routes = opts.optString("routes"),
        mtu = opts.optInt("mtu"),
        dns = opts.optString("dns"),
    )

    /** The permission nudge is posted once, not on every poll. */
    private var vpnNudged = false

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
        WisperJNI.setTunFd(-1)
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
            val body = httpGet("/api/stats") ?: return

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

    /** GETs a backend path, or null when the backend is not answering. */
    private fun httpGet(path: String): String? {
        return try {
            val conn = URL("$BACKEND_URL$path").openConnection() as HttpURLConnection
            conn.connectTimeout = 1500
            conn.readTimeout = 1500
            conn.requestMethod = "GET"
            conn.setRequestProperty("Accept", "application/json")

            val code = conn.responseCode
            if (code != 200) {
                Log.w(TAG, "$path HTTP $code")
                return null
            }

            BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
        } catch (e: Exception) {
            Log.w(TAG, "$path failed", e)
            null
        }
    }

    // ---------------------------------------------------------------
    // VPN establishment
    // ---------------------------------------------------------------

    /** The first *running* tun entrypoint, if any: the VPN exists to serve one,
     *  so a stopped or failed entrypoint must not hold it up. A restored
     *  entrypoint counts as running from the moment it is listed — it is
     *  waiting for this app's device, not the other way round. */
    private fun runningTunEntrypoint(): JSONObject? {
        val body = httpGet("/api/entrypoints") ?: return null
        // The list endpoints answer a bare array — the {"entrypoints": …} shape
        // is /api/stats's, not this one's.
        val arr = JSONArray(body)
        for (i in 0 until arr.length()) {
            val ep = arr.optJSONObject(i) ?: continue
            if (ep.optString("type") == "tun" && ep.optString("status") == "running") return ep
        }
        return null
    }

    /**
     * Android 14 requires the "systemExempted" foreground service type for a
     * VPN, and only accepts it once the app is one, so the type follows the
     * VPN. The type cannot be taken back, so one promotion per process is
     * enough — and a second one would only repeat the notification.
     */
    private fun promoteForegroundForVpn() {
        if (vpnPromoted) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return
        vpnPromoted = true
        try {
            startForeground(
                NOTIFICATION_ID,
                buildNotification(
                    getString(R.string.app_name),
                    getString(R.string.notification_running)
                ),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED
            )
        } catch (e: Exception) {
            Log.e(TAG, "startForeground (VPN) failed", e)
        }
    }

    /** Asks the user for the VPN permission (tapping runs the system dialog). */
    private fun nudgeVpnPermission() {
        if (vpnNudged) return
        val prepare = VpnService.prepare(this) ?: return
        vpnNudged = true

        val pendingIntent = PendingIntent.getActivity(
            this, 0, prepare,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.vpn_permission_title))
            .setContentText(getString(R.string.vpn_permission_text))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        getSystemService(NotificationManager::class.java)
            .notify(VPN_NOTIFICATION_ID, notification)
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
