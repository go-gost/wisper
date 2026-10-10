package entrypoint

import (
	"testing"

	cfg "github.com/go-gost/wisper/config"
	tp "github.com/go-gost/wisper/tunnel"
)

// TestEntryPointConfigRoundTripsShareFields: a spoke's LAN sharing is part of
// its device configuration, so both fields have to survive the round trip the
// stats runner rewrites every second — SaveConfig into the config, LoadConfig
// back out into a live entrypoint. A hop that drops one of them leaves a spoke
// the API reported as configured sharing nothing at all.
func TestEntryPointConfigRoundTripsShareFields(t *testing.T) {
	t.Chdir(t.TempDir()) // SaveConfig writes ./wisper.yaml when no config dir is set
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	const id = "ep-share"
	ep := NewTunEntryPoint(
		tp.IDOption(id),
		tp.NameOption(id),
		tp.PeerOption(testPeerKey),
		tp.ShareLANOption("192.168.50.0/24"),
		tp.ShareModeOption("kernel"),
	)
	Add(ep)

	// Closed before the save, and taken out of the registry before the reload:
	// LoadConfig starts whatever the config says is running, and this test is
	// about the fields surviving the trip, not about a tun device coming up.
	ep.Close()
	defer Delete(id)

	if err := SaveConfig(); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	saved := cfg.Get().EntryPoints
	if len(saved) != 1 {
		t.Fatalf("saved %d entrypoints, want 1", len(saved))
	}
	if saved[0].ShareLAN != "192.168.50.0/24" {
		t.Errorf("persisted share_lan = %q, want 192.168.50.0/24", saved[0].ShareLAN)
	}
	if saved[0].ShareMode != "kernel" {
		t.Errorf("persisted share_mode = %q, want kernel", saved[0].ShareMode)
	}

	Delete(id)
	LoadConfig()

	reloaded := Get(id)
	if reloaded == nil {
		t.Fatal("LoadConfig did not register the saved entrypoint")
	}
	defer Delete(id)

	if got := reloaded.Options().ShareLAN; got != "192.168.50.0/24" {
		t.Errorf("reloaded ShareLAN = %q, want 192.168.50.0/24", got)
	}
	if got := reloaded.Options().ShareMode; got != "kernel" {
		t.Errorf("reloaded ShareMode = %q, want kernel", got)
	}
}
