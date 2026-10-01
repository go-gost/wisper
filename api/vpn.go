package api

import (
	"log/slog"

	"github.com/go-gost/wisper/event"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/wisper/tunnel/entrypoint"
)

// StopForVpnTaken stops the tun entrypoint that holds the VPN device, because
// the device was taken from under it: another app now owns the VPN. Android
// reports that as a revoke of ours while the other app's VPN is up, and it is
// the one moment the question — did we lose the device to someone else, or was
// our own VPN switched off — has an unambiguous answer.
//
// Racing the other app back would undo the user's switch and ping-pong with it
// (every establish() revokes the other side), so the entrypoint stops and its
// history says why; the user starts it again when they want it. With the
// entrypoint gone nothing wants a device, which is what keeps the poller from
// re-establishing.
//
// It returns the holder's name and true when it stopped one, and ("", false)
// when nobody holds the device — either nothing was running or a holder already
// stopped. The only caller is the Android JNI shim.
func StopForVpnTaken() (string, bool) {
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
	event.Record(id, event.LevelWarn, "VPN handed to another app — stopped")
	if err := entrypoint.SaveConfig(); err != nil {
		slog.Error("save config", "err", err)
	}

	return name, true
}
