package tunnel

import (
	"os"
	"path/filepath"
	"testing"

	cfg "github.com/go-gost/wisper/config"
)

// TestP2PTunnelKeyLifecycle covers the key file: created on Run with 0600,
// reused across stop/start and across Delete/replace (same identity), and
// removed by RemoveP2PKey — the call the API's delete handler makes.
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
	Set(tn2) // replaces the old entry in place, like an API update
	if got := tn2.Entrypoint(); got != key1 {
		t.Fatalf("pubkey changed across restart: %q -> %q", key1, got)
	}
	_ = tn2.Close()

	Delete("test-p2p-id")
	if _, err := os.Stat(keyPath); err != nil {
		t.Fatalf("Delete removed the key file: %v (update/replace must keep the identity)", err)
	}

	// The API delete path removes the key separately.
	if err := RemoveP2PKey("test-p2p-id"); err != nil {
		t.Fatalf("RemoveP2PKey: %v", err)
	}
	if _, err := os.Stat(keyPath); !os.IsNotExist(err) {
		t.Fatalf("RemoveP2PKey left the key file behind: %v", err)
	}
}

// TestP2PDerpDefault: an empty settings.p2p resolves to the public gost.run
// relay (never a hard failure).
func TestP2PDerpDefault(t *testing.T) {
	if got := P2PDerpURL(nil); got != defaultP2PDerp {
		t.Fatalf("P2PDerpURL(nil) = %q, want %q", got, defaultP2PDerp)
	}
	if got := P2PDerpURL(&cfg.Settings{}); got != defaultP2PDerp {
		t.Fatalf("P2PDerpURL(empty) = %q, want %q", got, defaultP2PDerp)
	}
	want := "wss://relay.example/derp"
	if got := P2PDerpURL(&cfg.Settings{P2P: &cfg.P2PSettings{Derp: want}}); got != want {
		t.Fatalf("P2PDerpURL(configured) = %q, want %q", got, want)
	}
}

// TestP2PTLSConfig: an unset settings.p2p must not panic and keeps p2p's
// defaults; a configured one is passed through.
func TestP2PTLSConfig(t *testing.T) {
	if got := P2PTLSConfig(nil); got != nil {
		t.Fatalf("P2PTLSConfig(nil) = %+v, want nil", got)
	}
	if got := P2PTLSConfig(&cfg.Settings{}); got != nil {
		t.Fatalf("P2PTLSConfig(empty) = %+v, want nil", got)
	}
	if got := P2PTLSConfig(&cfg.Settings{P2P: &cfg.P2PSettings{}}); got != nil {
		t.Fatalf("P2PTLSConfig(defaults) = %+v, want nil", got)
	}
	no := false
	got := P2PTLSConfig(&cfg.Settings{P2P: &cfg.P2PSettings{CAFile: "/tmp/ca.pem", Secure: &no}})
	if got == nil || got.CAFile != "/tmp/ca.pem" || got.Secure == nil || *got.Secure {
		t.Fatalf("P2PTLSConfig(configured) = %+v, want the configured values", got)
	}
}
