package tunnel

import (
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	cfg "github.com/go-gost/wisper/config"
)

// peerPipe returns the conn shape the manager sees for an inbound stream from
// a given peer plus the dialing peer's far end: a net.Pipe conn whose
// RemoteAddr is the peer key.
func peerPipe(peer string) (inbound, far net.Conn) {
	far, inbound = net.Pipe()
	return peerConn{Conn: inbound, peer: peer}, far
}

// peerConn is a net.Conn whose RemoteAddr carries the peer key, the way the
// p2p listener presents inbound streams.
type peerConn struct {
	net.Conn
	peer string
}

func (c peerConn) RemoteAddr() net.Addr { return peerRouteAddr(c.peer) }

// TestP2PHostManagerRefcount covers the singleton's lifetime: the first
// acquire starts the host, later ones only take a reference, and the host is
// stopped (routes included) only when the last reference goes.
func TestP2PHostManagerRefcount(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	// Unreachable relay: the connect fails instantly and, by design, non-fatally.
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})

	m := p2pHost
	if m.refs != 0 || m.host != nil {
		t.Fatal("manager is not idle: a previous test leaked a reference")
	}
	// Keep the singleton idle even if an assertion below aborts the test.
	defer func() {
		for m.refs > 0 {
			m.release()
		}
	}()

	host, err := m.acquire()
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	if host == nil {
		t.Fatal("first acquire returned a nil host")
	}
	if m.refs != 1 {
		t.Fatalf("refs after first acquire = %d, want 1", m.refs)
	}

	h2, err := m.acquire()
	if err != nil {
		t.Fatalf("second acquire: %v", err)
	}
	if h2 != host {
		t.Fatal("second acquire started a second host")
	}
	if m.refs != 2 {
		t.Fatalf("refs after second acquire = %d, want 2", m.refs)
	}

	m.release()
	if m.host == nil || m.refs != 1 {
		t.Fatalf("after one release: host %v refs %d; want the host still running with 1 ref", m.host, m.refs)
	}

	m.release()
	if m.host != nil || m.ln != nil || m.refs != 0 {
		t.Fatalf("after the last release: host %v ln %v refs %d; want the host stopped", m.host, m.ln, m.refs)
	}
}

// TestP2PHostManagerRoutes covers the route table: batch registration that is
// all-or-nothing, N peers sharing one listener, dispatch by peer key,
// unregistration by the owning listener only, and the queue semantics the
// route exposes to its gost service.
func TestP2PHostManagerRoutes(t *testing.T) {
	m := &p2pHostManager{routes: make(map[string]*peerListener)}

	ln, err := m.register([]string{"k1"})
	if err != nil {
		t.Fatalf("register k1: %v", err)
	}
	if got := ln.Addr().String(); got != "k1" {
		t.Fatalf("route addr = %q, want the peer key", got)
	}
	if _, err := m.register([]string{"k1"}); err == nil {
		t.Fatal("a peer key was registered twice; it belongs to exactly one tunnel")
	}

	// N peers share the route: every key of the list resolves to one listener.
	ln2, err := m.register([]string{"k2", "k3"})
	if err != nil {
		t.Fatalf("register k2+k3: %v", err)
	}
	if m.routes["k2"] != ln2 || m.routes["k3"] != ln2 {
		t.Fatal("the allowlist's peers did not share one route")
	}
	if got := ln2.Addr().String(); got != "k2,k3" {
		t.Fatalf("route addr = %q, want the allowlist", got)
	}

	// All-or-nothing: a duplicate rolls the whole batch back, so a
	// half-registered tunnel cannot linger in the table.
	if _, err := m.register([]string{"k4", "k3"}); err == nil {
		t.Fatal("a batch containing an already-routed peer was accepted")
	} else if !strings.Contains(err.Error(), "k3") {
		t.Fatalf("register error = %v, want it to name the duplicate peer", err)
	}
	if _, ok := m.routes["k4"]; ok {
		t.Fatal("the failed batch left k4 routed")
	}
	ln4, err := m.register([]string{"k4"})
	if err != nil {
		t.Fatalf("register k4 after the rollback: %v", err)
	}

	// The route is a queue keyed by peer: a delivery lands on Accept.
	inbound, far := peerPipe("k2")
	defer far.Close()
	m.dispatch(inbound)
	got, err := ln2.Accept()
	if err != nil {
		t.Fatalf("Accept: %v", err)
	}
	if a := got.RemoteAddr(); a == nil || a.String() != "k2" {
		t.Fatalf("Accept returned a conn from %v, want the k2 stream", a)
	}
	// The accepted conn is the service's, not the route's: unregistering below
	// must not (and cannot) close it.
	_ = got.Close()

	// A stale unregister (a listener that owns no key of the list) is a no-op.
	m.unregister([]string{"k4"}, ln2)
	if m.routes["k4"] != ln4 {
		t.Fatal("a stale unregister removed another listener's route")
	}

	// Unregistering the list removes every key it owns and closes the route.
	m.unregister([]string{"k2", "k3"}, ln2)
	if _, ok := m.routes["k2"]; ok {
		t.Fatal("unregister left k2 routed")
	}
	if _, ok := m.routes["k3"]; ok {
		t.Fatal("unregister left k3 routed")
	}
	if _, err := ln2.Accept(); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("Accept on the unregistered route = %v, want net.ErrClosed", err)
	}

	// Re-registering a freed key works, and Close drops its queued conns.
	ln5, err := m.register([]string{"k2"})
	if err != nil {
		t.Fatalf("register k2 after unregister: %v", err)
	}
	local, remote := net.Pipe()
	defer local.Close()
	ln5.(*peerListener).deliver(remote)
	if err := ln5.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if _, err := ln5.Accept(); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("Accept after Close = %v, want net.ErrClosed", err)
	}
	if _, err := local.Read(make([]byte, 1)); err == nil {
		t.Fatal("Close left the queued conn open")
	}
}

// TestP2PHostManagerDispatchUnknownPeer: an inbound stream from a peer with no
// route is closed, not delivered anywhere — the allowlist has no fallback.
func TestP2PHostManagerDispatchUnknownPeer(t *testing.T) {
	m := &p2pHostManager{routes: make(map[string]*peerListener)}

	// net.Pipe's RemoteAddr is the literal "pipe", which no manager registers.
	peer, inbound := net.Pipe()
	defer peer.Close()
	_ = peer.SetReadDeadline(time.Now().Add(5 * time.Second))

	m.dispatch(inbound)

	if _, err := peer.Read(make([]byte, 1)); err != io.EOF {
		t.Fatalf("read from the peer end = %v, want EOF (the unknown peer's conn must be closed)", err)
	}
}

// TestEnsureP2PIdentity: the identity materializes on demand — no tunnel or
// entrypoint has to run — so two sides can exchange keys before configuring
// anything. It never starts the shared host.
func TestEnsureP2PIdentity(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})
	if p2pHost.refs != 0 || p2pHost.host != nil {
		t.Fatal("manager is not idle: a previous test leaked a reference")
	}

	pub, err := EnsureP2PIdentity()
	if err != nil {
		t.Fatalf("EnsureP2PIdentity: %v", err)
	}
	if len(pub) != 43 {
		t.Fatalf("public key = %q (%d chars), want a 43-char base64 key", pub, len(pub))
	}
	// The key is read with no relay connection: no host, no reference.
	if p2pHost.host != nil || p2pHost.refs != 0 {
		t.Fatalf("EnsureP2PIdentity started the host: host %v refs %d", p2pHost.host, p2pHost.refs)
	}

	keyPath := filepath.Join(os.Getenv("XDG_CONFIG_HOME"), "wisper", "p2p", "host.key")
	fi, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("host.key: %v", err)
	}
	if perm := fi.Mode().Perm(); perm != 0o600 {
		t.Fatalf("host.key mode = %o, want 600", perm)
	}

	// Stable across calls, and the same key once a host runs on the same file.
	again, err := EnsureP2PIdentity()
	if err != nil {
		t.Fatalf("second EnsureP2PIdentity: %v", err)
	}
	if again != pub {
		t.Fatalf("identity changed between calls: %q != %q", again, pub)
	}

	tn := NewP2PTunnel(IDOption("identity"), EndpointOption("127.0.0.1:9"), PeersOption(testPeerKey))
	if err := tn.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := p2pHost.PublicKey(); got != pub {
		t.Fatalf("running host key = %q, want the materialized %q", got, pub)
	}
	if got, err := EnsureP2PIdentity(); err != nil || got != pub {
		t.Fatalf("EnsureP2PIdentity while the host runs = %q, %v; want the same key", got, err)
	}
	if err := tn.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	// The host is idle again; P2PHostPublicKey still reports the identity.
	if got := P2PHostPublicKey(); got != pub {
		t.Fatalf("P2PHostPublicKey with the host idle = %q, want %q", got, pub)
	}
}
