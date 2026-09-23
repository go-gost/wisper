package entrypoint

import (
	"net"
	"os"
	"path/filepath"
	"testing"

	cfg "github.com/go-gost/wisper/config"
	tp "github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/x/registry"
)

const testPeerKey = "dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA"

// TestP2PEntryPointLifecycle: Run takes a reference on the process-wide host
// and registers the provider; Close unregisters, gives the reference back and
// is idempotent, while the shared identity file survives.
func TestP2PEntryPointLifecycle(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})

	ep := NewP2PEntryPoint(
		tp.IDOption("test-p2p-ep"),
		tp.EndpointOption("127.0.0.1:0"),
		tp.PeerOption(testPeerKey),
	)
	if err := ep.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := ep.Endpoint(); got != testPeerKey {
		t.Fatalf("Endpoint() = %q, want the peer key", got)
	}
	if !registry.P2PRegistry().IsRegistered("p2p-ep-test-p2p-ep") {
		t.Fatal("provider not registered after Run")
	}
	if !tp.P2PHostRunning() {
		t.Fatal("shared host is not running after Run")
	}

	// The host is refcounted: a foreign acquire/release pair must leave it
	// running because the entrypoint still holds a reference.
	if _, err := tp.AcquireP2PHost(); err != nil {
		t.Fatalf("AcquireP2PHost: %v", err)
	}
	tp.ReleaseP2PHost()
	if !tp.P2PHostRunning() {
		t.Fatal("host stopped while the entrypoint still held a reference")
	}

	// The identity is the shared host's key file: 0600, under the config dir.
	keyPath := filepath.Join(os.Getenv("XDG_CONFIG_HOME"), "wisper", "p2p", "host.key")
	fi, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("host.key: %v", err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Fatalf("host.key mode = %o, want 600", perm)
	}

	if err := ep.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := ep.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
	if registry.P2PRegistry().IsRegistered("p2p-ep-test-p2p-ep") {
		t.Fatal("provider still registered after Close")
	}
	if tp.P2PHostRunning() {
		t.Fatal("shared host still running after the last reference went away")
	}
	if _, err := os.Stat(keyPath); err != nil {
		t.Fatalf("Close removed the key file: %v", err)
	}
}

// TestP2PEntryPointRequiresPeer: a missing peer key fails loudly, before the
// shared host is touched.
func TestP2PEntryPointRequiresPeer(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{}})
	ep := NewP2PEntryPoint(tp.IDOption("no-peer"))
	if err := ep.Run(); err == nil {
		t.Fatal("Run without a peer key = nil error, want a failure")
	}
	if tp.P2PHostRunning() {
		t.Fatal("a failed Run started the shared host")
	}
	_ = ep.Close()
}

// TestSaveConfigKeepsPeer: the persisted config must carry what LoadConfig
// reads back. A p2p entrypoint's peer key above all — without it Run fails and
// the entrypoint comes back stopped, with no way to tell why.
func TestSaveConfigKeepsPeer(t *testing.T) {
	t.Chdir(t.TempDir()) // SaveConfig writes ./wisper.yaml when no config dir is set
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	ep := NewP2PEntryPoint(
		tp.IDOption("ep-save"),
		tp.EndpointOption("127.0.0.1:0"),
		tp.PeerOption(testPeerKey),
		tp.ProtocolOption("udp"),
		tp.KeepaliveOption(true),
		tp.TTLOption(30),
	)
	Add(ep)
	defer Delete("ep-save")

	if err := SaveConfig(); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	saved := cfg.Get().EntryPoints
	if len(saved) != 1 {
		t.Fatalf("saved %d entrypoints, want 1", len(saved))
	}
	if saved[0].Peer != testPeerKey {
		t.Errorf("persisted peer = %q, want %q", saved[0].Peer, testPeerKey)
	}
	if saved[0].Protocol != "udp" {
		t.Errorf("persisted protocol = %q, want udp", saved[0].Protocol)
	}
	if !saved[0].Keepalive || saved[0].TTL != 30 {
		t.Errorf("persisted keepalive/ttl = %v/%d, want true/30", saved[0].Keepalive, saved[0].TTL)
	}
}

// TestP2PEntryPointUDPProtocol: a udp p2p entrypoint binds a udp socket and
// asks the host for a datagram tunnel — the listener, the handler's network and
// the chain node's dialer all follow the protocol, so the peer receives
// datagram-framed traffic.
func TestP2PEntryPointUDPProtocol(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})

	ep := NewP2PEntryPoint(
		tp.IDOption("test-p2p-ep-udp"),
		tp.EndpointOption("127.0.0.1:0"),
		tp.PeerOption(testPeerKey),
		tp.ProtocolOption("udp"),
		tp.KeepaliveOption(true),
	)
	if err := ep.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	defer ep.Close()

	s := ep.(*p2pEntryPoint)
	svc := s.config.Services[0]
	if svc.Listener.Type != "udp" || svc.Handler.Type != "udp" {
		t.Fatalf("listener/handler = %q/%q, want udp/udp", svc.Listener.Type, svc.Handler.Type)
	}
	if got := svc.Listener.Metadata["keepalive"]; got != true {
		t.Fatalf("listener keepalive = %v, want true", got)
	}
	if got := s.config.Chains[0].Hops[0].Nodes[0].Dialer.Type; got != "udp" {
		t.Fatalf("node dialer = %q, want udp", got)
	}

	// The service really bound a udp socket (0 -> a free port).
	addr := s.forward.Addr()
	if addr == nil {
		t.Fatal("service has no address after Run")
	}
	if got := addr.Network(); got != "udp" {
		t.Fatalf("bound listener network = %q, want udp", got)
	}
	if _, ok := addr.(*net.UDPAddr); !ok {
		t.Fatalf("bound address %T is not a UDP address", addr)
	}
}
