package api

import (
	"log/slog"

	"github.com/go-gost/wisper/event"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

// RestartForVpnSwap restarts the tun entrypoint that holds the VPN device after
// the device was replaced underneath it. Android's VpnService rebuilds the
// device when the app re-establishes the VPN for a changed config — a new
// entrypoint's values, or the form's — and the old interface goes away with the
// fd the running entrypoint captured when it started. Nothing then restarts
// that run, so it goes on reporting running while every packet into the tunnel
// is lost. The new fd is already in place when this is called, so a fresh run
// picks it up and the tunnel keeps working.
//
// It returns the holder's name and true when it restarted one, and ("", false)
// when nobody holds the device — either nothing was running or a holder already
// stopped. The only caller is the Android JNI shim.
func RestartForVpnSwap() (string, bool) {
	id, name := tunnel.TunDeviceOwner()
	if id == "" {
		return "", false
	}

	ep := entrypoint.Get(id)
	if ep == nil {
		// A claim that outlived its entrypoint (deleted while it held the
		// device) would keep every other tun entrypoint refused; let it go.
		tunnel.ReleaseTunDevice(id)
		return "", false
	}

	// The holder keeps the device across the restart: the new run re-claims it,
	// and the swap must not look like the entrypoint going away.
	if entrypoint.Restart(id) == nil {
		return "", false
	}
	event.Record(id, event.LevelInfo, "VPN device rebuilt — restarted")
	return name, true
}

// StopForVpnRevoke stops the tun entrypoint that holds the VPN device, because
// the device was taken from under it: Android revoked our VPN — another app
// replaced it, or the user or the system disconnected it. The two are not told
// apart, because they cannot be: the probe for "is another app's VPN up?" was
// measured to answer yes on a manual disconnect, seeing our own network still
// tearing down. The revoke itself is unambiguous, and it is enough.
//
// Racing the revoke back would undo whichever choice produced it and ping-pong
// with another VPN app (every establish() revokes the other side), so the
// entrypoint stops and its history says why; the user starts it again when they
// want the tunnel. With the entrypoint gone nothing wants a device, which is
// what keeps the poller from re-establishing.
//
// It returns the holder's name and true when it stopped one, and ("", false)
// when nobody holds the device — either nothing was running or a holder already
// stopped. The only caller is the Android JNI shim.
func StopForVpnRevoke() (string, bool) {
	id, name := tunnel.TunDeviceOwner()
	if id == "" {
		return "", false
	}

	ep := entrypoint.Get(id)
	if ep == nil {
		// A claim that outlived its entrypoint (deleted while it held the
		// device) would keep every other tun entrypoint refused; let it go.
		tunnel.ReleaseTunDevice(id)
		return "", false
	}

	// Close releases the device, so a second call finds nobody — the loop
	// cannot restart itself.
	ep.Close()
	event.Record(id, event.LevelWarn, "VPN revoked by the system — stopped")
	if err := entrypoint.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

	return name, true
}
