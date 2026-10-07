package tunnel

import (
	"testing"
)

// The share fields travel with every other option: TunnelOptions is the one
// place a new shared field is threaded everywhere from, and createTunnel (and
// RestartRunning through it) builds from it — so a hub restarted by the
// process comes back sharing the same LAN in the same mode.
func TestTunnelOptionsCarriesShareFields(t *testing.T) {
	hub := NewByType(TunTunnel, TunnelOptions(Options{
		ID:        "hub-1",
		Name:      "hub",
		Net:       "10.10.0.1/24",
		ShareLAN:  "192.168.1.0/24",
		ShareMode: ShareUserspace,
	})...)
	if hub == nil {
		t.Fatal("NewByType(tun) = nil")
	}
	got := hub.Options()
	if got.ShareLAN != "192.168.1.0/24" {
		t.Errorf("ShareLAN = %q, want 192.168.1.0/24", got.ShareLAN)
	}
	if got.ShareMode != ShareUserspace {
		t.Errorf("ShareMode = %q, want userspace", got.ShareMode)
	}
}

// An unconfigured mode normalizes to auto on the way in, so the badge's
// downgrade derivation (effective userspace under auto) reads the same value
// whether the operator chose auto or said nothing.
func TestShareModeOptionNormalizes(t *testing.T) {
	hub := NewByType(TunTunnel, TunnelOptions(Options{ID: "h", Net: "10.10.0.1/24"})...)
	if got := hub.Options().ShareMode; got != ShareAuto {
		t.Errorf("empty ShareMode = %q, want auto", got)
	}
}
