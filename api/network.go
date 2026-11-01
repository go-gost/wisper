package api

import (
	"log/slog"

	"github.com/go-gost/wisper/tunnel"
)

// NetworkChanged re-registers the p2p host after the platform reports that its
// default network changed. An existing socket stays bound to the network it
// was created on, so a Wi-Fi <-> cellular switch leaves the relay connection
// writing into a path that no longer routes while every status still reads
// connected — the phone-side half of an "unreachable but connected" tunnel.
// The only caller is the Android JNI shim. It reports whether a relay
// connection was up to replace.
func NetworkChanged(iface string) bool {
	up := tunnel.ReconnectP2PRelay("default network changed: " + iface)
	slog.Info("default network changed", "iface", iface, "relay_was_up", up)
	return up
}
