package entrypoint

import (
	"os"
	"path/filepath"
	"testing"

	cfg "github.com/go-gost/wisper/config"
	tp "github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/x/registry"
)

// TestP2PEntryPointLifecycle: Run builds the host, registers the provider and
// creates the key file (0600); Close unregisters and is idempotent while the
// key survives so a restart reuses the identity.
func TestP2PEntryPointLifecycle(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})

	ep := NewP2PEntryPoint(
		tp.IDOption("test-p2p-ep"),
		tp.EndpointOption("127.0.0.1:0"),
		tp.PeerOption("dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA"),
	)
	if err := ep.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := ep.Endpoint(); got != "dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA" {
		t.Fatalf("Endpoint() = %q, want the peer key", got)
	}

	keyPath := filepath.Join(os.Getenv("XDG_CONFIG_HOME"), "wisper", "p2p", "test-p2p-ep.key")
	fi, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("key file: %v", err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Fatalf("key file mode = %o, want 600", perm)
	}
	if !registry.P2PRegistry().IsRegistered("p2p-ep-test-p2p-ep") {
		t.Fatal("provider not registered after Run")
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
	if _, err := os.Stat(keyPath); err != nil {
		t.Fatalf("Close removed the key file: %v", err)
	}
}

// TestP2PEntryPointRequiresPeer: a missing peer key fails loudly.
func TestP2PEntryPointRequiresPeer(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{}})
	ep := NewP2PEntryPoint(tp.IDOption("no-peer"))
	if err := ep.Run(); err == nil {
		t.Fatal("Run without a peer key = nil error, want a failure")
	}
	_ = ep.Close()
}
