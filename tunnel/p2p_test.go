package tunnel

import (
	"os"
	"path/filepath"
	"testing"

	cfg "github.com/go-gost/wisper/config"
	xservice "github.com/go-gost/x/service"
)

const testPeerKey = "dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA"

// TestP2PTunnelRequiresPeer: Peer is the route key (who may dial in), so Run
// without one fails loudly and leaves the manager untouched.
func TestP2PTunnelRequiresPeer(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{}})

	tn := NewP2PTunnel(IDOption("test-p2p-id"), EndpointOption("127.0.0.1:9"))
	if err := tn.Run(); err == nil {
		t.Fatal("Run without a peer key = nil error, want a failure")
	}
	if p2pHost.refs != 0 || p2pHost.host != nil {
		t.Fatalf("failed Run touched the manager: refs %d host %v", p2pHost.refs, p2pHost.host)
	}
	if err := tn.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
}

// TestP2PTunnelLifecycle: Run joins the shared host through a peer route (a
// broken relay is non-fatal), Close is idempotent and gives the reference
// back; the shared identity file outlives the tunnel.
func TestP2PTunnelLifecycle(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})
	if p2pHost.refs != 0 {
		t.Fatal("manager is not idle: a previous test leaked a reference")
	}
	defer func() {
		for p2pHost.refs > 0 {
			p2pHost.release()
		}
	}()

	tn := NewP2PTunnel(
		IDOption("test-p2p-id"),
		EndpointOption("127.0.0.1:9"),
		PeerOption(testPeerKey),
	)
	if err := tn.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	// Entrypoint() is the link's other end: the peer key the route is keyed on.
	if got := tn.Entrypoint(); got != testPeerKey {
		t.Fatalf("Entrypoint() = %q, want the peer key", got)
	}
	if p2pHost.refs != 1 {
		t.Fatalf("refs after Run = %d, want 1", p2pHost.refs)
	}
	st := tn.Status()
	if st == nil || st.State() == xservice.StateClosed {
		t.Fatalf("Status() = %v, want the running service's status", st)
	}

	// The identity is process-wide: <config>/wisper/p2p/host.key, 0600.
	keyPath := filepath.Join(os.Getenv("XDG_CONFIG_HOME"), "wisper", "p2p", "host.key")
	fi, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("host.key: %v", err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Fatalf("host.key mode = %o, want 600", perm)
	}
	if pub := p2pHost.PublicKey(); pub == "" {
		t.Fatal("host PublicKey() = empty, want the shared host's key")
	}

	if err := tn.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := tn.Close(); err != nil {
		t.Fatalf("second Close: %v (must be idempotent)", err)
	}
	if p2pHost.refs != 0 || p2pHost.host != nil {
		t.Fatalf("after Close: refs %d host %v, want the manager idle", p2pHost.refs, p2pHost.host)
	}
	if _, err := os.Stat(keyPath); err != nil {
		t.Fatalf("Close removed the key file: %v (stop/start must reuse the identity)", err)
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
