package tunnel

import (
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	cfg "github.com/go-gost/wisper/config"
	xservice "github.com/go-gost/x/service"
)

const testPeerKey = "dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA"

// TestP2PTunnelEmptyAllowlist: Peers is an allowlist, not a requirement — an
// empty list runs the tunnel and routes nothing to it (no catch-all).
func TestP2PTunnelEmptyAllowlist(t *testing.T) {
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

	tn := NewP2PTunnel(IDOption("test-p2p-empty"), EndpointOption("127.0.0.1:9"))
	if err := tn.Run(); err != nil {
		t.Fatalf("Run with an empty allowlist: %v", err)
	}
	st := tn.Status()
	if st == nil || st.State() == xservice.StateClosed {
		t.Fatalf("Status() = %v, want the running service's status", st)
	}
	if n := len(p2pHost.routes); n != 0 {
		t.Fatalf("routes after an empty-list Run = %d, want none", n)
	}

	// Nobody is admitted: whatever dials in is closed, not delivered.
	inbound, far := peerPipe("anyone")
	defer far.Close()
	_ = far.SetReadDeadline(time.Now().Add(5 * time.Second))
	p2pHost.dispatch(inbound)
	if _, err := far.Read(make([]byte, 1)); err != io.EOF {
		t.Fatalf("read from the dialing peer = %v, want EOF (an empty allowlist admits nobody)", err)
	}

	if err := tn.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if p2pHost.refs != 0 || p2pHost.host != nil {
		t.Fatalf("after Close: refs %d host %v, want the manager idle", p2pHost.refs, p2pHost.host)
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
		PeersOption(testPeerKey),
	)
	if err := tn.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	// Entrypoint() is the link's other ends: the allowlist the page shows.
	if got := tn.Entrypoint(); got != testPeerKey {
		t.Fatalf("Entrypoint() = %q, want the peer key", got)
	}
	if ln := p2pHost.routes[testPeerKey]; ln == nil {
		t.Fatal("the allowlisted peer has no route")
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
	if perm := fi.Mode().Perm(); perm != 0600 {
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
	if _, ok := p2pHost.routes[testPeerKey]; ok {
		t.Fatal("Close left the peer route registered")
	}
	if _, err := os.Stat(keyPath); err != nil {
		t.Fatalf("Close removed the key file: %v (stop/start must reuse the identity)", err)
	}
}

// TestP2PTunnelPeerAllowlist: every key in the allowlist reaches the same
// tunnel — N peers, one backend — and Close drops them all.
func TestP2PTunnelPeerAllowlist(t *testing.T) {
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

	peers := []string{"peer-a", "peer-b", "peer-c"}
	tn := NewP2PTunnel(IDOption("test-p2p-multi"), EndpointOption("127.0.0.1:9"), PeersOption(peers...))
	if err := tn.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	pl := p2pHost.routes["peer-a"]
	if pl == nil {
		t.Fatal("peer-a has no route")
	}
	for _, key := range peers[1:] {
		if p2pHost.routes[key] != pl {
			t.Fatalf("allowlisted peer %s does not share the tunnel's route", key)
		}
	}

	// Streams from any allowed key land on the one route.
	for _, key := range []string{"peer-a", "peer-c"} {
		inbound, far := peerPipe(key)
		p2pHost.dispatch(inbound)
		got, err := pl.Accept()
		if err != nil {
			t.Fatalf("Accept for %s: %v", key, err)
		}
		if a := got.RemoteAddr(); a == nil || a.String() != key {
			t.Fatalf("accepted conn RemoteAddr = %v, want %s", a, key)
		}
		_ = got.Close()
		_ = far.Close()
	}

	if err := tn.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	for _, key := range peers {
		if _, ok := p2pHost.routes[key]; ok {
			t.Fatalf("Close left peer %s routed", key)
		}
	}
}

// TestP2PTunnelDuplicatePeerKey: a peer key belongs to exactly one tunnel. The
// second Run fails, rolls its claim back, and leaves the first tunnel routing.
func TestP2PTunnelDuplicatePeerKey(t *testing.T) {
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

	first := NewP2PTunnel(IDOption("first"), EndpointOption("127.0.0.1:9"), PeersOption(testPeerKey))
	if err := first.Run(); err != nil {
		t.Fatalf("first Run: %v", err)
	}

	second := NewP2PTunnel(IDOption("second"), EndpointOption("127.0.0.1:9"), PeersOption(testPeerKey))
	if err := second.Run(); err == nil {
		t.Fatal("two tunnels claimed the same peer key")
	}
	if p2pHost.routes[testPeerKey] == nil {
		t.Fatal("the failed Run unregistered the first tunnel's route")
	}
	if p2pHost.refs != 1 {
		t.Fatalf("refs after the failed Run = %d, want 1 (the failure leaked or stole a reference)", p2pHost.refs)
	}
	if err := second.Close(); err != nil {
		t.Fatalf("Close of the failed tunnel: %v", err)
	}

	// The first tunnel still routes its peer.
	inbound, far := peerPipe(testPeerKey)
	defer far.Close()
	p2pHost.dispatch(inbound)
	got, err := p2pHost.routes[testPeerKey].Accept()
	if err != nil {
		t.Fatalf("Accept on the surviving route: %v", err)
	}
	_ = got.Close()

	if err := first.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}
	if p2pHost.refs != 0 || p2pHost.host != nil {
		t.Fatalf("after Close: refs %d host %v, want the manager idle", p2pHost.refs, p2pHost.host)
	}
}

// TestP2PDerpDefault: an empty settings.p2p resolves to the public gost.run
// relay (never a hard failure).
// TestP2PTunnelPeerStats: traffic is counted per peer — each stream carries its
// peer's counters — and reported in allowlist order, an idle peer as zeros.
func TestP2PTunnelPeerStats(t *testing.T) {
	pl := newPeerListener([]string{"k1", "k2"})
	tn := &p2pTunnel{opts: Options{Peers: []string{"k1", "k2"}}, cclose: make(chan struct{})}

	if got := tn.PeerStats(); got != nil {
		t.Fatalf("PeerStats with no route = %v, want nil", got)
	}
	tn.ln = pl

	in1, far1 := peerPipe("k1")
	defer far1.Close()
	in2, far2 := peerPipe("k2")
	defer far2.Close()
	pl.deliver(in1)
	pl.deliver(in2)

	c1, err := pl.Accept()
	if err != nil {
		t.Fatalf("Accept: %v", err)
	}
	c2, err := pl.Accept()
	if err != nil {
		t.Fatalf("Accept: %v", err)
	}
	defer c2.Close()

	// In from k1, out to k1.
	msg := []byte("hello-from-k1")
	werr := make(chan error, 1)
	go func() { _, err := far1.Write(msg); werr <- err }()
	buf := make([]byte, len(msg))
	if _, err := io.ReadFull(c1, buf); err != nil {
		t.Fatalf("read peer-k1 stream: %v", err)
	}
	if err := <-werr; err != nil {
		t.Fatalf("write peer-k1 stream: %v", err)
	}
	reply := []byte("hi")
	go func() { _, err := c1.Write(reply); werr <- err }()
	if _, err := io.ReadFull(far1, buf[:len(reply)]); err != nil {
		t.Fatalf("read far end: %v", err)
	}
	if err := <-werr; err != nil {
		t.Fatalf("write to peer: %v", err)
	}
	_ = c1.Close()

	got := tn.PeerStats()
	if len(got) != 2 || got[0].Key != "k1" || got[1].Key != "k2" {
		t.Fatalf("PeerStats = %+v, want k1 then k2 (allowlist order)", got)
	}
	if got[0].InputBytes != uint64(len(msg)) || got[0].OutputBytes != uint64(len(reply)) {
		t.Errorf("k1 bytes = %d in / %d out, want %d / %d", got[0].InputBytes, got[0].OutputBytes, len(msg), len(reply))
	}
	if got[0].TotalConns != 1 || got[0].CurrentConns != 0 {
		t.Errorf("k1 conns = %d total / %d current, want 1 / 0 (the stream is closed)", got[0].TotalConns, got[0].CurrentConns)
	}
	if got[1] != (PeerStat{Key: "k2", CurrentConns: 1, TotalConns: 1}) {
		t.Errorf("k2 stats = %+v, want its open stream counted and no bytes", got[1])
	}
}

// TestNormalizePeerAliases: every listed key ends up with a display name —
// a known alias is kept, a new key gets a distinct random one, and a key no
// longer listed loses its alias.
func TestNormalizePeerAliases(t *testing.T) {
	if got := NormalizePeerAliases(nil, nil); got != nil {
		t.Fatalf("NormalizePeerAliases(nil) = %v, want nil", got)
	}

	known := map[string]string{"k1": "home-laptop", "k9": "old-peer"}
	got := NormalizePeerAliases([]string{"k1", "k2", "k3"}, known)

	if got["k1"] != "home-laptop" {
		t.Errorf("k1 alias = %q, want the existing one kept", got["k1"])
	}
	if _, ok := got["k9"]; ok {
		t.Error("a key no longer listed kept its alias")
	}
	for _, k := range []string{"k2", "k3"} {
		if len(got[k]) != len("peer-")+4 {
			t.Errorf("generated alias for %s = %q, want a peer-xxxx name", k, got[k])
		}
	}
	if got["k2"] == got["k3"] {
		t.Errorf("two peers share the alias %q", got["k2"])
	}

	// Stable: a second pass keeps what the first generated.
	again := NormalizePeerAliases([]string{"k1", "k2", "k3"}, got)
	if again["k2"] != got["k2"] || again["k3"] != got["k3"] {
		t.Fatalf("aliases changed on a second pass: %v -> %v", got, again)
	}
}

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
