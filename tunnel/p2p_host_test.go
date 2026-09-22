package tunnel

import (
	"errors"
	"io"
	"net"
	"testing"
	"time"

	cfg "github.com/go-gost/wisper/config"
)

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

// TestP2PHostManagerRoutes covers the peer route table: 1:1 registration
// (duplicates rejected), unregistration by the owning listener only, and the
// queue semantics the route exposes to its gost service.
func TestP2PHostManagerRoutes(t *testing.T) {
	m := &p2pHostManager{routes: make(map[string]*peerListener)}

	ln, err := m.register("k1")
	if err != nil {
		t.Fatalf("register k1: %v", err)
	}
	if got := ln.Addr().String(); got != "k1" {
		t.Fatalf("route addr = %q, want the peer key", got)
	}
	if _, err := m.register("k1"); err == nil {
		t.Fatal("a peer key was registered twice; it belongs to exactly one tunnel")
	}

	// The route is a queue: deliver hands Accept the inbound conn.
	local, remote := net.Pipe()
	defer local.Close()
	ln.(*peerListener).deliver(remote)
	got, err := ln.Accept()
	if err != nil {
		t.Fatalf("Accept: %v", err)
	}
	if got != remote {
		t.Fatalf("Accept returned %v, want the delivered conn", got)
	}

	// A stale unregister (a different listener for the same key) is a no-op.
	m.unregister("k1", newPeerListener("k1"))
	if _, err := m.register("k1"); err == nil {
		t.Fatal("a stale unregister removed the live route")
	}

	m.unregister("k1", ln)
	ln2, err := m.register("k1")
	if err != nil {
		t.Fatalf("register after unregister: %v", err)
	}

	// Closing the route drops its queued conns and unblocks Accept.
	local2, remote2 := net.Pipe()
	defer local2.Close()
	ln2.(*peerListener).deliver(remote2)
	if err := ln2.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if _, err := ln2.Accept(); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("Accept after Close = %v, want net.ErrClosed", err)
	}
	if _, err := local2.Read(make([]byte, 1)); err == nil {
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
