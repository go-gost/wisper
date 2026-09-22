package entrypoint

import (
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
