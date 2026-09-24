package run.gost.wisper

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
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

/**
 * Hosts the Go backend in the foreground and owns the tun device a tun
 * entrypoint needs: on Android an unprivileged app cannot open /dev/net/tun, so
 * the device has to come from a VpnService, and its fd is handed to the Go side
 * (see [WisperJNI.setTunFd]).
 */
class WisperService : VpnService() {

    companion object {
        private const val TAG = "WisperService"
        private const val CHANNEL_ID = "wisper_foreground"
        private const val NOTIFICATION_ID = 1
        private const val VPN_NOTIFICATION_ID = 2
        private const val POLL_INTERVAL_MS = 2000L
        private const val BACKEND_URL = "http://127.0.0.1:8900"

        /** Matches the tun listener's default when the entrypoint sets none. */
        private const val DEFAULT_MTU = 1420
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
    /** Whether a VpnService device is up and its fd handed to the Go side. */
    @Volatile
    private var vpnEstablished = false

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

    /**
     * The system tore the VPN down (another VPN took over, or the user
     * disconnected it). The fd is gone with it, so drop it and let the poll
     * establish it again.
     */
    override fun onRevoke() {
        Log.w(TAG, "VPN revoked by the system")
        vpnEstablished = false
        vpnNudged = false
        WisperJNI.setTunFd(-1)
        super.onRevoke()
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

    /**
     * Brings the VPN up as soon as a tun entrypoint exists, since the device
     * that entrypoint needs can only come from here. A tun entrypoint the user
     * has not permitted yet gets a nudge notification instead: establishing
     * needs the user's consent, which only an Activity can ask for.
     */
    private fun ensureVpn() {
        if (vpnEstablished) return

        val ep = fetchTunEntrypoint() ?: return

        if (VpnService.prepare(this) != null) {
            nudgeVpnPermission()
            return
        }

        establishVpn(ep)
    }

    /** The first tun entrypoint the backend knows about, running or not. */
    private fun fetchTunEntrypoint(): JSONObject? {
        val body = httpGet("/api/entrypoints") ?: return null
        val arr = JSONObject(body).optJSONArray("entrypoints") ?: return null
        for (i in 0 until arr.length()) {
            val ep = arr.optJSONObject(i) ?: continue
            if (ep.optString("type") == "tun") return ep
        }
        return null
    }

    /**
     * Builds the device from the entrypoint's own definition — the Java side and
     * the Go side must not each keep a copy of the addresses, routes, MTU and
     * DNS — and hands the resulting fd to Go.
     */
    private fun establishVpn(ep: JSONObject) {
        val opts = ep.optJSONObject("options") ?: return

        val builder = Builder().setSession(getString(R.string.app_name))

        val addresses = cidrs(opts.optString("net"))
        if (addresses.isEmpty()) {
            Log.w(TAG, "tun entrypoint has no usable address")
            return
        }
        for ((addr, prefix) in addresses) {
            builder.addAddress(addr, prefix)
        }
        for ((addr, prefix) in cidrs(opts.optString("routes"))) {
            builder.addRoute(addr, prefix)
        }
        // The listener falls back to 1420 when the entrypoint sets no MTU; the
        // device has to match that, or packets will not fit the p2p path.
        val mtu = opts.optInt("mtu")
        builder.setMtu(if (mtu > 0) mtu else DEFAULT_MTU)
        for (dns in opts.optString("dns").split(",").map { it.trim() }.filter { it.isNotEmpty() }) {
            builder.addDnsServer(dns)
        }
        // Our own sockets must not enter the tunnel: the p2p link that carries
        // it would loop back through the hub. (An allowlist alternative to
        // VpnService.protect, which would need a hook in every p2p socket.)
        try {
            builder.addDisallowedApplication(packageName)
        } catch (e: Exception) {
            Log.w(TAG, "addDisallowedApplication failed", e)
        }

        val pfd = try {
            builder.establish()
        } catch (e: Exception) {
            Log.e(TAG, "establish failed", e)
            null
        }
        if (pfd == null) {
            Log.e(TAG, "establish returned no device")
            return
        }

        // The Go side owns the device from here: it copies the fd per tun
        // device, so an entrypoint restart keeps working without a new VPN.
        WisperJNI.setTunFd(pfd.detachFd())
        vpnEstablished = true
        Log.i(TAG, "VPN established for entrypoint ${ep.optString("name")}")

        promoteForegroundForVpn()
    }

    /**
     * Android 14 requires the "systemExempted" foreground service type for a
     * VPN, and only accepts it once the app is one, so the type follows the
     * VPN.
     */
    private fun promoteForegroundForVpn() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return
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

    /**
     * Splits a comma-separated "cidr [gw]" list (what "net" and "routes" hold)
     * into address/prefix pairs. A gateway is ignored: VpnService routes are
     * on-link.
     */
    private fun cidrs(value: String?): List<Pair<String, Int>> {
        if (value.isNullOrBlank()) return emptyList()
        return value.split(",").mapNotNull { entry ->
            val cidr = entry.trim().substringBefore(" ").trim()
            val addr = cidr.substringBefore("/")
            val prefix = cidr.substringAfter("/", "").toIntOrNull()
            if (addr.isEmpty() || prefix == null || prefix !in 0..128) null else addr to prefix
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
