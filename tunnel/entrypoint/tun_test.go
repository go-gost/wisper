package entrypoint

import (
	"bytes"
	"os"
	"testing"

	cfg "github.com/go-gost/wisper/config"
	tp "github.com/go-gost/wisper/tunnel"
)

// TestTunEntryPointServiceConfig: the described service is the whole contract
// with x. The chain (and no forwarder) is what makes the tun handler run in
// client mode — with a forwarder hop, or without a chain at all, it would run
// as a server and never dial the hub.
func TestTunEntryPointServiceConfig(t *testing.T) {
	ep := NewTunEntryPoint(
		tp.IDOption("test-tun-ep"),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.0.2/24"),
		tp.MTUOption(1400),
		tp.DeviceNameOption("wisper-spoke"),
		tp.RoutesOption("0.0.0.0/0"),
		tp.DNSOption("10.10.0.1"),
		tp.KeepaliveOption(true),
		tp.TTLOption(15),
	)

	if ep.Type() != TunEntryPoint {
		t.Errorf("Type() = %q, want %q", ep.Type(), TunEntryPoint)
	}
	if got := ep.Endpoint(); got != testPeerKey {
		t.Errorf("Endpoint() = %q, want the hub's key", got)
	}
	if got := ep.Entrypoint(); got != "10.10.0.2/24" {
		t.Errorf("Entrypoint() = %q, want the device address", got)
	}

	s, ok := ep.(*tunEntryPoint)
	if !ok {
		t.Fatalf("NewTunEntryPoint returned %T, want *tunEntryPoint", ep)
	}
	if err := s.init(); err != nil {
		t.Fatalf("init: %v", err)
	}

	svc := s.config.Services[0]
	if svc.Addr != ":0" {
		t.Errorf("service addr = %q, want :0 (a tun listener binds no socket)", svc.Addr)
	}
	if svc.Forwarder != nil {
		t.Error("service carries a forwarder: with one, the tun handler dials the node address instead of the chain")
	}
	if svc.Handler.Type != "tun" || svc.Listener.Type != "tun" {
		t.Errorf("types = %s/%s, want tun/tun", svc.Handler.Type, svc.Listener.Type)
	}

	for key, want := range map[string]any{
		"name":   "wisper-spoke",
		"mtu":    1400,
		"net":    "10.10.0.2/24",
		"routes": "0.0.0.0/0",
		"dns":    "10.10.0.1",
	} {
		if got := svc.Listener.Metadata[key]; got != want {
			t.Errorf("listener metadata[%s] = %v (%T), want %v (%T)", key, got, got, want, want)
		}
	}
	if got := svc.Handler.Metadata["keepalive"]; got != true {
		t.Errorf("handler metadata[keepalive] = %v, want true", got)
	}
	// x reads ttl as an int in seconds; a time.Duration here would be ignored.
	if v, ok := svc.Handler.Metadata["ttl"].(int); !ok || v != 15 {
		t.Errorf("handler metadata[ttl] = %v (%T), want int 15",
			svc.Handler.Metadata["ttl"], svc.Handler.Metadata["ttl"])
	}

	node := s.config.Chains[0].Hops[0].Nodes[0]
	if node.Addr != testPeerKey {
		t.Errorf("node addr = %q, want the peer key", node.Addr)
	}
	if node.Dialer == nil || node.Dialer.Type != "udp" {
		t.Errorf("node dialer = %+v, want udp (a datagram tunnel)", node.Dialer)
	}
	if node.Connector == nil || node.Connector.Type != "forward" {
		t.Errorf("node connector = %+v, want forward (the peer picks the outlet)", node.Connector)
	}
	if got := node.Metadata["p2p"]; got != "tun-ep-test-tun-ep" {
		t.Errorf("node p2p provider = %v, want tun-ep-test-tun-ep", got)
	}
}

// TestTunEntryPointRequiresPeer: a missing hub key fails loudly, before the
// shared host is touched.
func TestTunEntryPointRequiresPeer(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{}})

	ep := NewTunEntryPoint(tp.IDOption("no-peer"), tp.NetOption("10.10.0.2/24"))
	if err := ep.Run(); err == nil {
		t.Fatal("Run without a peer key = nil error, want a failure")
	}
	if tp.P2PHostRunning() {
		t.Fatal("a failed Run started the shared host")
	}
	_ = ep.Close()
}

// TestSaveConfigKeepsTunDevice: the device configuration must survive
// SaveConfig — the stats runner rewrites the config file every second, so a
// field missing there is erased, not merely unpersisted.
func TestSaveConfigKeepsTunDevice(t *testing.T) {
	t.Chdir(t.TempDir()) // SaveConfig writes ./wisper.yaml when no config dir is set
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	ep := NewTunEntryPoint(
		tp.IDOption("ep-tun-save"),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.0.2/24"),
		tp.MTUOption(1400),
		tp.DeviceNameOption("wisper-spoke"),
		tp.RoutesOption("0.0.0.0/0"),
		tp.DNSOption("10.10.0.1"),
		tp.KeepaliveOption(true),
		tp.TTLOption(15),
		tp.RecordModeOption("headers"),
	)
	Add(ep)
	defer Delete("ep-tun-save")

	if err := SaveConfig(); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	saved := cfg.Get().EntryPoints
	if len(saved) != 1 {
		t.Fatalf("saved %d entrypoints, want 1", len(saved))
	}
	got := saved[0]
	if got.Peer != testPeerKey || got.Net != "10.10.0.2/24" || got.MTU != 1400 ||
		got.DeviceName != "wisper-spoke" || got.Routes != "0.0.0.0/0" || got.DNS != "10.10.0.1" ||
		!got.Keepalive || got.TTL != 15 || got.RecordMode != "headers" {
		t.Errorf("persisted tun entrypoint = %+v, want the constructed values", got)
	}

	// The yaml keys are the other half of the round trip: a reload reads them.
	raw, err := os.ReadFile("wisper.yaml")
	if err != nil {
		t.Fatalf("read back the config: %v", err)
	}
	for _, key := range []string{"net:", "mtu:", "device_name:", "routes:", "dns:", "keepalive:", "ttl:", "record_mode:"} {
		if !bytes.Contains(raw, []byte(key)) {
			t.Errorf("wisper.yaml carries no %s key:\n%s", key, raw)
		}
	}
}
