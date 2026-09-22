package tunnel

import (
	"os"
	"path/filepath"
	"testing"

	cfg "github.com/go-gost/wisper/config"
)

// TestP2PTunnelKeyLifecycle covers the key file: created on Run with 0600,
// reused across stop/start (same identity), removed by Delete.
func TestP2PTunnelKeyLifecycle(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})

	tn := NewP2PTunnel(IDOption("test-p2p-id"), EndpointOption("127.0.0.1:9"))
	if err := tn.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	// Connect to an unreachable relay is non-fatal (the engine retries), so Run
	// succeeds and the host still reports its pubkey.
	Add(tn) // Delete() only sees tunnels in the global list
	key1 := tn.Entrypoint()
	if key1 == "" {
		t.Fatal("Entrypoint() = empty, want the base64 public key")
	}

	keyPath := filepath.Join(os.Getenv("XDG_CONFIG_HOME"), "wisper", "p2p", "test-p2p-id.key")
	fi, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("key file: %v", err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Fatalf("key file mode = %o, want 600", perm)
	}

	if err := tn.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := tn.Close(); err != nil {
		t.Fatalf("second Close: %v (must be idempotent)", err)
	}
	if _, err := os.Stat(keyPath); err != nil {
		t.Fatalf("Close removed the key file: %v (stop/start must reuse the identity)", err)
	}

	// A restarted tunnel keeps the same identity.
	tn2 := NewP2PTunnel(IDOption("test-p2p-id"), EndpointOption("127.0.0.1:9"))
	if err := tn2.Run(); err != nil {
		t.Fatalf("Run after restart: %v", err)
	}
	Set(tn2) // replaces the old entry in place; Delete would drop the key file too
	if got := tn2.Entrypoint(); got != key1 {
		t.Fatalf("pubkey changed across restart: %q -> %q", key1, got)
	}
	_ = tn2.Close()

	Delete("test-p2p-id")
	if _, err := os.Stat(keyPath); !os.IsNotExist(err) {
		t.Fatalf("Delete left the key file behind: %v", err)
	}
}

// TestP2PDerpDefault: an empty settings.p2p resolves to the public gost.run
// relay (never a hard failure).
func TestP2PDerpDefault(t *testing.T) {
	if got := p2pDerpURL(nil); got != defaultP2PDerp {
		t.Fatalf("p2pDerpURL(nil) = %q, want %q", got, defaultP2PDerp)
	}
	if got := p2pDerpURL(&cfg.Settings{}); got != defaultP2PDerp {
		t.Fatalf("p2pDerpURL(empty) = %q, want %q", got, defaultP2PDerp)
	}
	want := "wss://relay.example/derp"
	if got := p2pDerpURL(&cfg.Settings{P2P: &cfg.P2PSettings{Derp: want}}); got != want {
		t.Fatalf("p2pDerpURL(configured) = %q, want %q", got, want)
	}
}
