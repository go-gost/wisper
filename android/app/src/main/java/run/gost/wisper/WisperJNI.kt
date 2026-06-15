package run.gost.wisper

object WisperJNI {
    init {
        System.loadLibrary("wisper")
    }

    /** Start the Go backend. Returns 0 on success, -1 on error. */
    external fun start(configDir: String, addr: String): Int

    /** Stop the Go backend (persist state + graceful shutdown). */
    external fun stop()
}
