package run.gost.wisper

object WisperJNI {
    init {
        System.loadLibrary("wisper")
    }

    /** Start the Go backend. Returns 0 on success, -1 on error. */
    external fun start(configDir: String, addr: String): Int

    /** Stop the Go backend (persist state + graceful shutdown). */
    external fun stop()

    /**
     * Hand over the tun device fd of an established [android.net.VpnService].
     * The Go side owns it from here, so detach it from the ParcelFileDescriptor
     * first; pass -1 to release the device. [reason] names the call site
     * ("onRevoke", "TunVpnService.release", …) and rides the Go tunfd log line,
     * so a release can be attributed without logcat (whose record was missing
     * transitions on the real device).
     */
    external fun setTunFd(fd: Int, reason: String)

    /**
     * Android took our VPN away and another app's is up: the backend stops the
     * tun entrypoint that held the device instead of racing the other app for
     * it. See api.StopForVpnTaken.
     */
    external fun vpnTaken()
}
