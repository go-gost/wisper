package run.gost.wisper

import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Log

/**
 * The logcat tag every tun-fd hand-off and release carries, on both services.
 *
 * Why a tag of its own, and logcat rather than the wisper log: the device is
 * given up on the Android side (four sites across two services, one of them a
 * system revoke), and "who took the device" is asked while reading logcat
 * adb-side. One tag means one filter — `adb logcat -s wisper-tunfd` reads the
 * whole fd timeline in order, which the Go side's own tunfd lines join.
 */
internal const val TUNFD_TAG = "wisper-tunfd"

/**
 * The app's VPN device, as a VpnService of its own so that it can be stopped.
 *
 * Android clears a VPN when its VpnService stops, and by nothing else: handing
 * -1 to the Go side releases the device fd, but the system goes on routing
 * through a VPN whose interface is gone, which blackholes every app's traffic.
 * Keeping this service separate from the backend service is what lets the
 * ordinary case — no tun entrypoint running — be no VPN at all rather than a
 * stuck one.
 *
 * The backend owns the decision (it is the one polling the API for running tun
 * entrypoints) and drives this service with intents; the device work lives
 * here.
 */
class TunVpnService : VpnService() {

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val i = intent ?: return START_NOT_STICKY
        when (i.action) {
            ACTION_ENSURE -> ensure(
                VpnStatus.Device(
                    net = i.getStringExtra(EXTRA_NET).orEmpty(),
                    routes = i.getStringExtra(EXTRA_ROUTES).orEmpty(),
                    mtu = i.getIntExtra(EXTRA_MTU, 0),
                    dns = i.getStringExtra(EXTRA_DNS).orEmpty(),
                )
            )
            ACTION_RELEASE -> release()
        }
        return START_NOT_STICKY
    }

    /**
     * Brings the device up for the given values, unless it is already up for
     * exactly those. Every failure is logged, never thrown: the caller is a
     * poll tick, and an uncaught exception here takes the process (and the
     * backend with it) down.
     */
    private fun ensure(device: VpnStatus.Device) {
        if (VpnStatus.established && VpnStatus.config == device.config()) return

        val addresses = cidrs(device.net)
        if (addresses.isEmpty()) {
            Log.w(TAG, "no usable device address")
            return
        }

        val builder = Builder().setSession(getString(R.string.app_name))
        for ((addr, prefix) in addresses) {
            builder.addAddress(addr, prefix)
        }
        for ((addr, prefix) in cidrs(device.routes)) {
            builder.addRoute(addr, prefix)
        }
        // The listener falls back to 1420 when the entrypoint sets no MTU; the
        // device has to match that, or packets will not fit the p2p path.
        builder.setMtu(if (device.mtu > 0) device.mtu else DEFAULT_MTU)
        for (dns in device.dns.split(",").map { it.trim() }.filter { it.isNotEmpty() }) {
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

        val pfd: ParcelFileDescriptor? = try {
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
        val fd = pfd.detachFd()
        Log.i(TUNFD_TAG, "set: TunVpnService.establish fd=$fd (device established)")
        WisperJNI.setTunFd(fd, "TunVpnService.establish")
        VpnStatus.established = true
        VpnStatus.config = device.config()
        Log.i(TAG, "VPN established for ${device.net}")
    }

    /**
     * Lets the device go and stops — only the stop clears the system VPN, which
     * is why this is its own service. The Go side holds the last copy of the fd
     * (a stopped entrypoint closed its own), so passing -1 releases it.
     */
    private fun release() {
        if (VpnStatus.established) {
            Log.i(TAG, "releasing the VPN device")
            Log.i(TUNFD_TAG, "release: TunVpnService.release fd=-1 (device no longer needed)")
            WisperJNI.setTunFd(-1, "TunVpnService.release")
        }
        VpnStatus.established = false
        VpnStatus.config = null
        stopSelf()
    }

    /**
     * The system took the VPN away: another app replaced it, or the user (or the
     * system) disconnected it. The device is gone either way, so the backend is
     * told to stop the entrypoint that held it — racing the revoke back would
     * undo whatever choice produced it, and ping-pong with another VPN app
     * (every establish() revokes the other side).
     *
     * The two cases are deliberately not told apart. The obvious probe (is a VPN
     * still up? then it is someone else's) was measured to be wrong: on a manual
     * disconnect it reported our own network, still tearing down, as another
     * app's. The user starts the entrypoint again when they want the tunnel
     * back, which is one tap and needs no guessing.
     */
    override fun onRevoke() {
        Log.w(TAG, "VPN revoked by the system")
        Log.w(TUNFD_TAG, "release: TunVpnService.onRevoke fd=-1 (revoked)")
        VpnStatus.established = false
        VpnStatus.config = null
        WisperJNI.setTunFd(-1, "onRevoke")
        // The stamp invalidates an arm that predates the revoke, so the poller
        // cannot re-establish from one; the backend stops the entrypoint, and
        // with the arm dropped nothing wants a device again.
        VpnStatus.takenAt = System.currentTimeMillis()
        WisperJNI.vpnTaken()
        super.onRevoke()
    }

    /**
     * cidrs parses comma-separated "addr/prefix" entries; an entry the listener
     * would skip (a typo, a missing prefix) is skipped here too, so the device
     * and the listener agree on what the address means.
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

    companion object {
        private const val TAG = "TunVpnService"

        /** Matches the tun listener's default when the entrypoint sets none. */
        private const val DEFAULT_MTU = 1420

        private const val ACTION_ENSURE = "run.gost.wisper.action.VPN_ENSURE"
        private const val ACTION_RELEASE = "run.gost.wisper.action.VPN_RELEASE"
        private const val EXTRA_NET = "net"
        private const val EXTRA_ROUTES = "routes"
        private const val EXTRA_MTU = "mtu"
        private const val EXTRA_DNS = "dns"

        /** Asks for the device these entrypoint values describe. */
        fun ensure(ctx: Context, device: VpnStatus.Device) {
            ctx.startService(
                Intent(ctx, TunVpnService::class.java)
                    .setAction(ACTION_ENSURE)
                    .putExtra(EXTRA_NET, device.net)
                    .putExtra(EXTRA_ROUTES, device.routes)
                    .putExtra(EXTRA_MTU, device.mtu)
                    .putExtra(EXTRA_DNS, device.dns)
            )
        }

        /**
         * Drops the device and the system VPN with it. Call it only when a
         * device is up: starting a service just to have it stop is churn.
         */
        fun release(ctx: Context) {
            ctx.startService(Intent(ctx, TunVpnService::class.java).setAction(ACTION_RELEASE))
        }
    }
}

/**
 * The app's VPN state, shared by everything in the process: the VpnService that
 * owns it, the backend that decides when it is needed, and the UI that waits
 * for it.
 */
object VpnStatus {
    /** Whether a device is up and its fd handed to the Go side. */
    @Volatile
    var established = false

    /** The device the running VPN was built from, to notice a changed one. */
    @Volatile
    var config: String? = null

    /**
     * When the VPN was taken by another app (onRevoke saw one active), as
     * System.currentTimeMillis(); 0 = never. It dates the takeover so an arm
     * older than it can be dropped — see WisperService.ensureVpn.
     */
    @Volatile
    var takenAt = 0L

    /**
     * The fields that define a device. The form's armed values and an
     * entrypoint's stored options describe the same device with different key
     * sets, so comparing whole JSON objects would call every swap between the
     * two a change and rebuild the device — which kills the copy the running
     * entrypoint holds.
     */
    data class Device(val net: String, val routes: String, val mtu: Int, val dns: String) {
        fun config(): String = listOf(net, routes, dns).joinToString("|") + "|" + mtu
    }
}
