package api

import (
	"log/slog"

	"github.com/go-gost/wisper/event"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

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
