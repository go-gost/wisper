package tunnel

import (
	"testing"
)

// RED 3: share-LAN config plumbing — options survive the round trip so a save
// writes what the hub runs.
func TestShareLANOptionsRoundTrip(t *testing.T) {
	tn := NewTunTunnel(
		ShareLANOption("192.168.1.0/24"),
		ShareModeOption("kernel"),
	)
	got := tn.Options()
	if got.ShareLAN != "192.168.1.0/24" {
		t.Fatalf("ShareLAN = %q, want 192.168.1.0/24", got.ShareLAN)
	}
	if got.ShareMode != ShareKernel {
		t.Fatalf("ShareMode = %q, want %q", got.ShareMode, ShareKernel)
	}

	// TunnelOptions must carry both, or createTunnel drops them on the floor.
	back := Options{}
	for _, opt := range TunnelOptions(got) {
		opt(&back)
	}
	if back.ShareLAN != got.ShareLAN || back.ShareMode != got.ShareMode {
		t.Fatalf("TunnelOptions round trip = (%q,%q), want (%q,%q)",
			back.ShareLAN, back.ShareMode, got.ShareLAN, got.ShareMode)
	}
}
