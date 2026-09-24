package tunnel

import (
	"bytes"
	"os"
	"testing"

	cfg "github.com/go-gost/wisper/config"
)

// TestTunTunnelMetadata: the two metadata maps are the whole contract this side
// has with x's tun listener and handler. The value *types* matter as much as
// the keys — x reads ttl as an int in seconds, so a time.Duration there would be
// accepted by the map and silently ignored by the handler.
func TestTunTunnelMetadata(t *testing.T) {
	tun := NewTunTunnel(
		IDOption("tun-meta"),
		NameOption("Hub"),
		EndpointOption("127.0.0.1:8421"),
		NetOption("10.10.0.1/24"),
		MTUOption(1400),
		DeviceNameOption("wisper-hub"),
		RoutesOption("192.168.50.0/24"),
		DNSOption("10.10.0.1"),
		KeepaliveOption(true),
		TTLOption(15),
	)

	if tun.Type() != TunTunnel {
		t.Errorf("Type() = %q, want %q", tun.Type(), TunTunnel)
	}
	if got := tun.Endpoint(); got != "127.0.0.1:8421" {
		t.Errorf("Endpoint() = %q, want the bind address", got)
	}
	if got := tun.Entrypoint(); got != "10.10.0.1/24" {
		t.Errorf("Entrypoint() = %q, want the device address", got)
	}

	s, ok := tun.(*tunTunnel)
	if !ok {
		t.Fatalf("NewTunTunnel returned %T, want *tunTunnel", tun)
	}

	lm := s.listenerMetadata()
	for key, want := range map[string]any{
		"name":   "wisper-hub",
		"mtu":    1400,
		"net":    "10.10.0.1/24",
		"routes": "192.168.50.0/24",
		"dns":    "10.10.0.1",
	} {
		if got := lm[key]; got != want {
			t.Errorf("listener metadata[%s] = %v (%T), want %v (%T)", key, got, got, want, want)
		}
	}
	if _, ok := lm["peer"]; ok {
		t.Error("listener metadata carries peer: a tun hub is not a point-to-point link")
	}
	// p2p collapses the route table to a single peer, which would destroy the
	// hub's per-spoke demultiplexing.
	if _, ok := lm["p2p"]; ok {
		t.Error("listener metadata carries p2p: a tun hub must not")
	}

	hm := s.handlerMetadata()
	if got := hm["keepalive"]; got != true {
		t.Errorf("handler metadata[keepalive] = %v, want true", got)
	}
	if v, ok := hm["ttl"].(int); !ok || v != 15 {
		t.Errorf("handler metadata[ttl] = %v (%T), want int 15", hm["ttl"], hm["ttl"])
	}
	if _, ok := hm["p2p"]; ok {
		t.Error("handler metadata carries p2p: a tun hub must not")
	}
}

// TestTunTunnelRunRequiresEndpoint: a hub with no bind address fails to start
// instead of half-starting a device, and the failure is recorded (not a panic,
// not a closed tunnel — the API's start handler restarts a failed tunnel).
func TestTunTunnelRunRequiresEndpoint(t *testing.T) {
	cfg.Set(&cfg.Config{})

	tun := NewTunTunnel(NameOption("hub"))
	if err := tun.Run(); err == nil {
		t.Fatal("Run without a bind address succeeded")
	}
	if tun.Err() == nil {
		t.Error("the failure was not recorded")
	}
	if tun.IsClosed() {
		t.Error("a failed Run closed the tunnel, so it cannot be restarted")
	}
}

// TestSaveConfigKeepsTunDevice: the device configuration must survive
// SaveConfig, because the stats runner rewrites the config file every second —
// a field missing there is not merely unpersisted, it is erased.
func TestSaveConfigKeepsTunDevice(t *testing.T) {
	t.Chdir(t.TempDir()) // SaveConfig writes ./wisper.yaml when no config dir is set
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	tun := NewTunTunnel(
		IDOption("tun-save"),
		NameOption("Hub"),
		EndpointOption("127.0.0.1:8421"),
		NetOption("10.10.0.1/24"),
		MTUOption(1400),
		DeviceNameOption("wisper-hub"),
		RoutesOption("192.168.50.0/24"),
		DNSOption("10.10.0.1"),
		KeepaliveOption(true),
		TTLOption(15),
	)
	tun.Close() // never runs: this test is about the file
	Add(tun)
	defer Delete("tun-save")

	if err := SaveConfig(); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	saved := cfg.Get().Tunnels
	if len(saved) != 1 {
		t.Fatalf("saved %d tunnels, want 1", len(saved))
	}
	got := saved[0]
	if got.Net != "10.10.0.1/24" || got.MTU != 1400 || got.DeviceName != "wisper-hub" ||
		got.Routes != "192.168.50.0/24" || got.DNS != "10.10.0.1" ||
		!got.Keepalive || got.TTL != 15 {
		t.Errorf("persisted device config = %+v, want the constructed values", got)
	}

	// The yaml keys are the other half of the round trip: a reload reads them.
	raw, err := os.ReadFile("wisper.yaml")
	if err != nil {
		t.Fatalf("read back the config: %v", err)
	}
	for _, key := range []string{"net:", "mtu:", "device_name:", "routes:", "dns:", "keepalive:", "ttl:"} {
		if !bytes.Contains(raw, []byte(key)) {
			t.Errorf("wisper.yaml carries no %s key:\n%s", key, raw)
		}
	}
}
