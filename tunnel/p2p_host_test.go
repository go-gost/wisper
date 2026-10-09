package tunnel

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/p2p"
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
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})

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

	host, err := m.acquire(context.Background())
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	if host == nil {
		t.Fatal("first acquire returned a nil host")
	}
	if m.refs != 1 {
		t.Fatalf("refs after first acquire = %d, want 1", m.refs)
	}

	h2, err := m.acquire(context.Background())
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

	// A listener that owns no route (never registered, or already replaced) is
	// a no-op: unregistering it must not touch another route, nor close it.
	stranger := newPeerListener([]string{"k4"})
	m.unregister(stranger)
	if m.routes["k4"] != ln4 {
		t.Fatal("unregistering an unknown listener removed another listener's route")
	}
	select {
	case <-stranger.closed:
		t.Fatal("unregister closed a route it did not own")
	default:
	}

	// Unregistering the route removes every key it owns and closes it.
	m.unregister(ln2)
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

// TestP2PHostManagerReconcile: an allowlist change in place. The listener is
// the same object (the service keeps running), keys are added and dropped for
// it alone, a dropped peer's counters go with it, and a change that would steal
// another tunnel's key is refused whole.
func TestP2PHostManagerReconcile(t *testing.T) {
	m := &p2pHostManager{routes: make(map[string]*peerListener)}

	ln, err := m.register([]string{"k1", "k2"})
	if err != nil {
		t.Fatalf("register k1+k2: %v", err)
	}
	pl := ln.(*peerListener)
	other, err := m.register([]string{"k3"})
	if err != nil {
		t.Fatalf("register k3: %v", err)
	}

	// A delivered stream gives k2 counters to lose.
	inbound, far := peerPipe("k2")
	defer far.Close()
	m.dispatch(inbound)
	if _, err := ln.Accept(); err != nil {
		t.Fatalf("Accept: %v", err)
	}
	if len(pl.peerTraffic()) != 1 {
		t.Fatalf("peer traffic = %v, want one entry for k2", pl.peerTraffic())
	}

	// Swap the list: k4 in, k2 out, k1 kept.
	if err := m.reconcile(pl, []string{"k1", "k4"}); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if m.routes["k1"] != ln || m.routes["k4"] != ln {
		t.Fatal("reconcile did not claim the new key for the same route")
	}
	if _, ok := m.routes["k2"]; ok {
		t.Fatal("reconcile left a dropped key routed")
	}
	if m.routes["k3"] != other {
		t.Fatal("reconcile touched another tunnel's route")
	}
	if got := ln.Addr().String(); got != "k1,k4" {
		t.Fatalf("route addr = %q, want the new allowlist", got)
	}
	if len(pl.peerTraffic()) != 0 {
		t.Fatalf("peer traffic = %v, want the dropped peer's counters gone", pl.peerTraffic())
	}

	// All-or-nothing: k3 belongs to another tunnel, so nothing changes.
	if err := m.reconcile(pl, []string{"k3"}); err == nil {
		t.Fatal("a conflicting key was accepted")
	} else if !strings.Contains(err.Error(), "k3") {
		t.Fatalf("reconcile error = %v, want it to name the conflicting peer", err)
	}
	if m.routes["k1"] != ln || m.routes["k4"] != ln || m.routes["k3"] != other {
		t.Fatal("a refused reconcile changed the route table")
	}
	if got := ln.Addr().String(); got != "k1,k4" {
		t.Fatalf("route addr after the refusal = %q, want the accepted list", got)
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
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})
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

	keyPath := P2PHostKeyPath()
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

// peerDatagramPipe is peerPipe's datagram twin: the inbound conn also
// satisfies net.PacketConn, the shape p2p's Listen hands over for a udp
// tunnel.
func peerDatagramPipe(peer string) (inbound, far net.Conn) {
	far, in := net.Pipe()
	return peerDatagramStream{peerConn: peerConn{Conn: in, peer: peer}}, far
}

type peerDatagramStream struct {
	peerConn
}

func (c peerDatagramStream) ReadFrom(b []byte) (int, net.Addr, error) {
	n, err := c.Read(b)
	return n, c.RemoteAddr(), err
}

func (c peerDatagramStream) WriteTo(b []byte, _ net.Addr) (int, error) { return c.Write(b) }

// TestPeerListenerDeliversDatagramConn: a udp tunnel's stream reaches the
// service as a datagram conn — the shape the local handler tells udp by, which
// x's WrapConn would strip — while its bytes still land in the peer's counters.
func TestPeerListenerDeliversDatagramConn(t *testing.T) {
	ln := newPeerListener([]string{"peer-a"})
	inbound, far := peerDatagramPipe("peer-a")
	defer far.Close()
	ln.deliver(inbound)

	accepted := make(chan net.Conn, 1)
	go func() {
		c, err := ln.Accept()
		if err == nil {
			accepted <- c
		}
	}()

	var c net.Conn
	select {
	case c = <-accepted:
	case <-time.After(3 * time.Second):
		t.Fatal("datagram stream was not accepted")
	}

	if _, ok := c.(net.PacketConn); !ok {
		t.Fatal("a udp tunnel stream must be delivered as a net.PacketConn")
	}
	if got := c.RemoteAddr().String(); got != "peer-a" {
		t.Fatalf("remote addr = %q, want the peer key", got)
	}

	// The conn counts into the peer's counters (the per-peer table's source).
	pStats := ln.peerStat("peer-a")
	if got := pStats.Get(stats.KindCurrentConns); got != 1 {
		t.Fatalf("current conns = %d, want 1 while the stream is open", got)
	}

	go func() { _, _ = far.Write([]byte("in")) }()
	buf := make([]byte, 8)
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	n, err := c.Read(buf)
	if err != nil || string(buf[:n]) != "in" {
		t.Fatalf("read %q, %v; want in", buf[:n], err)
	}
	if got := pStats.Get(stats.KindInputBytes); got != 2 {
		t.Fatalf("input bytes = %d, want 2", got)
	}

	go func() { _, _ = c.Write([]byte("out")) }()
	out := make([]byte, 8)
	_ = far.SetReadDeadline(time.Now().Add(3 * time.Second))
	n, err = far.Read(out)
	if err != nil || string(out[:n]) != "out" {
		t.Fatalf("far read %q, %v; want out", out[:n], err)
	}
	// The counter is added after the write unblocks the reader, so poll.
	deadline := time.Now().Add(2 * time.Second)
	for pStats.Get(stats.KindOutputBytes) != 3 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if got := pStats.Get(stats.KindOutputBytes); got != 3 {
		t.Fatalf("output bytes = %d, want 3", got)
	}

	if err := c.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	if got := pStats.Get(stats.KindCurrentConns); got != 0 {
		t.Fatalf("current conns after close = %d, want 0", got)
	}
}

// TestP2PHostKeyPathWithoutHome: Android defines neither $XDG_CONFIG_HOME nor
// $HOME, which is what os.UserConfigDir() needs — the identity path must still
// resolve, from wisper's own config directory (the app hands its files dir to
// config.Init). This is what made creating a tun entrypoint fail on the phone.
func TestP2PHostKeyPathWithoutHome(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", "")
	t.Setenv("HOME", "")

	got := P2PHostKeyPath()
	if !filepath.IsAbs(got) {
		t.Fatalf("P2PHostKeyPath() = %q, want an absolute path with no $HOME/$XDG_CONFIG_HOME", got)
	}
	if want := filepath.Join("p2p", "host.key"); !strings.HasSuffix(got, want) {
		t.Fatalf("P2PHostKeyPath() = %q, want it to end in %q", got, want)
	}
}

// knock drives one refused inbound stream through the real path: a pipe conn
// whose RemoteAddr is the peer key, the way the p2p listener presents it.
func knock(m *p2pHostManager, key string) {
	inbound, far := peerPipe(key)
	defer far.Close()
	m.dispatch(inbound)
}

// TestPendingPeersRecordAndDismiss: one entry per key, counted across knocks,
// forgotten on request, and its absence is not an error.
func TestPendingPeersRecordAndDismiss(t *testing.T) {
	m := &p2pHostManager{routes: make(map[string]*peerListener)}
	const key = "kQ7Zm0Q0Y2r0k9v2mQm1Z2yq8S5w1Kc3x7bN0rH4tUg"

	knock(m, key)
	knock(m, key)

	got := m.pendingSnapshot()
	if len(got) != 1 {
		t.Fatalf("pending = %d entries, want 1: one entry per key", len(got))
	}
	if got[0].Key != key || got[0].Attempts != 2 {
		t.Fatalf("pending = %+v, want key %s with 2 attempts", got[0], key)
	}
	if got[0].FirstSeen.IsZero() || got[0].LastSeen.Before(got[0].FirstSeen) {
		t.Fatalf("timestamps = %v/%v, want the first at or before the last", got[0].FirstSeen, got[0].LastSeen)
	}

	if !m.dismissPending(key) {
		t.Error("dismissPending = false for a key that knocked")
	}
	if m.dismissPending(key) {
		t.Error("dismissPending = true for a key that is not recorded")
	}
	if n := len(m.pendingSnapshot()); n != 0 {
		t.Fatalf("pending = %d entries after dismiss, want 0", n)
	}

	// Newest first: the page shows the most recent ask at the top.
	for i, key := range []string{"key-old", "key-mid", "key-new"} {
		m.notePending(key)
		m.pending[key].LastSeen = time.Now().Add(time.Duration(i) * time.Second)
	}
	ordered := m.pendingSnapshot()
	if len(ordered) != 3 || ordered[0].Key != "key-new" || ordered[2].Key != "key-old" {
		t.Fatalf("pending order = %+v, want key-new, key-mid, key-old", ordered)
	}
}

// TestPendingPeersExpireAndEvict: the list is a notice, not a log — an entry
// past the TTL is gone, and the list cannot be grown past its bound by anyone
// who can reach the relay.
func TestPendingPeersExpireAndEvict(t *testing.T) {
	m := &p2pHostManager{routes: make(map[string]*peerListener)}
	now := time.Now()

	m.notePending("stale")
	m.pending["stale"] = &pendingPeer{
		Key:       "stale",
		FirstSeen: now.Add(-2 * p2pPendingTTL),
		LastSeen:  now.Add(-2 * p2pPendingTTL),
		Attempts:  1,
	}
	if n := len(m.pendingSnapshot()); n != 0 {
		t.Fatalf("pending = %d entries, want 0: a knock older than the TTL is retired", n)
	}

	for i := 0; i < p2pPendingMax; i++ {
		key := fmt.Sprintf("key-%02d", i)
		m.notePending(key)
		m.pending[key].LastSeen = now.Add(time.Duration(i) * time.Second)
	}
	m.notePending("newest")

	if n := len(m.pending); n != p2pPendingMax {
		t.Fatalf("pending holds %d entries, want the cap %d", n, p2pPendingMax)
	}
	if _, ok := m.pending["key-00"]; ok {
		t.Error("the least recently seen knock was not evicted")
	}
	if _, ok := m.pending["newest"]; !ok {
		t.Error("the new knock was not recorded")
	}
}

// TestPendingPeersClearedWithHost: with no host running nobody can knock, so
// the records go with it rather than outliving their reason to exist.
func TestPendingPeersClearedWithHost(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})

	if _, err := AcquireP2PHost(context.Background()); err != nil {
		t.Fatalf("AcquireP2PHost: %v", err)
	}
	p2pHost.notePending("kQ7Zm0Q0Y2r0k9v2mQm1Z2yq8S5w1Kc3x7bN0rH4tUg")
	if n := len(p2pHost.pendingSnapshot()); n != 1 {
		t.Fatalf("pending = %d entries before release, want 1", n)
	}

	ReleaseP2PHost()

	if n := len(p2pHost.pendingSnapshot()); n != 0 {
		t.Fatalf("pending = %d entries after the host stopped, want 0", n)
	}
}

// TestP2PPendingPeersFiltersListedKeys: a key any tunnel lists is not a
// requesting peer — it already has a row of its own on the peers page. A
// switched-off key is listed too (the disabled set is a subset of the listed
// one), so the same pass covers it.
func TestP2PPendingPeersFiltersListedKeys(t *testing.T) {
	t.Chdir(t.TempDir()) // Delete/SaveConfig reach for ./wisper.yaml without a config dir
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp"}}})

	const (
		listed  = "key-listed"
		off     = "key-disabled"
		unknown = "key-unknown"
	)

	tun := NewP2PTunnel(
		IDOption("pending-filter"),
		PeersOption(listed, off),
		PeerDisabledOption([]string{off}),
	)
	Add(tun)
	defer Delete("pending-filter")

	p2pHost.notePending(listed)
	p2pHost.notePending(off)
	p2pHost.notePending(unknown)
	defer func() {
		p2pHost.dismissPending(listed)
		p2pHost.dismissPending(off)
		p2pHost.dismissPending(unknown)
	}()

	got := P2PPendingPeers()
	if len(got) != 1 || got[0].Key != unknown {
		t.Fatalf("pending = %+v, want only %s", got, unknown)
	}
}

// TestP2PHostRebuildsOnSettingsChange covers the shared host's settings
// lifetime: the host captures its build settings once, so a changed direct
// path (or relay/STUN) must replace it — otherwise the settings toggle is dead
// while any consumer holds a reference. Unchanged settings keep the host, so a
// save that does not touch p2p does not churn it.
func TestP2PHostRebuildsOnSettingsChange(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	const derp = "wss://127.0.0.1:1/derp"
	on := true
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: derp, Direct: &on}}})

	m := p2pHost
	if m.refs != 0 || m.host != nil {
		t.Fatal("manager is not idle: a previous test leaked a reference")
	}
	defer func() {
		for m.refs > 0 {
			m.release()
		}
	}()

	host1, err := m.acquire(context.Background())
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}

	off := false
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: derp, Direct: &off}}})

	host2, err := m.acquire(context.Background())
	if err != nil {
		t.Fatalf("acquire after a settings change: %v", err)
	}
	if host2 == host1 {
		t.Fatal("acquire reused the host after the p2p settings changed")
	}

	host3, err := m.acquire(context.Background())
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	if host3 != host2 {
		t.Fatal("acquire rebuilt the host with unchanged settings")
	}
}

// TestAcquireThreadsFaultsToEngine pins the full settings→engine wiring: a
// faults block on settings.p2p must reach the shared host's engine, where the
// engine itself announces the active knobs at startup. The assertion is the
// engine's own warning line, not a copy of the struct — a config that reached
// only p2p.Config.Faults and never newFaults would log nothing.
func TestAcquireThreadsFaultsToEngine(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{
		Derp:   "wss://127.0.0.1:1/derp",
		Direct: &directOff,
		Faults: &p2p.FaultsConfig{DropDataRate: 0.5},
	}}})

	m := p2pHost
	if m.refs != 0 || m.host != nil {
		t.Fatal("manager is not idle: a previous test leaked a reference")
	}
	defer func() {
		for m.refs > 0 {
			m.release()
		}
	}()

	if _, err := m.acquire(context.Background()); err != nil {
		t.Fatalf("acquire: %v", err)
	}

	got := buf.String()
	if !strings.Contains(got, "fault injection is on") {
		t.Fatalf("the engine did not announce the threaded faults: %q", got)
	}
	if !strings.Contains(got, "dropDataRate(0.5)") {
		t.Fatalf("the engine did not name the threaded knob: %q", got)
	}
}

// TestP2PHostManagerDispatchDemuxesControlStream: a hub route demuxes its
// inbound byte streams by their first bytes. The control magic goes to the
// hub that owns the route's spokes; a datagram stream is a tun link and is not
// read at all; anything else is a tun stream and keeps every byte it arrived
// with, replayed after the peek.
func TestP2PHostManagerDispatchDemuxesControlStream(t *testing.T) {
	m := &p2pHostManager{routes: make(map[string]*peerListener)}
	ln := newPeerListener([]string{"peerB", "peerC"})
	m.routes["peerB"] = ln
	m.routes["peerC"] = ln
	defer func() {
		ln.Close()
		m.unregister(ln)
	}()

	h := newFakeP2PHandler()
	ch := newControlHub("hub1", map[string][]netip.Prefix{
		"peerB": {netip.MustParsePrefix("192.168.0.0/16")},
	}, h, testLogger())
	ln.setControl(ch)
	if err := ch.Register("peerB"); err != nil {
		t.Fatalf("Register: %v", err)
	}
	defer ch.Unregister("peerB")

	// A datagram stream first: the tun link, which must be delivered without
	// the hub reading a single byte off it.
	datagram, datagramFar := peerDatagramPipe("peerC")
	defer datagramFar.Close()
	m.dispatch(datagram)

	accepted := make(chan net.Conn, 4)
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			accepted <- c
		}
	}()

	got := acceptWithin(t, accepted, "the tun link's datagram stream")
	if _, ok := got.(net.PacketConn); !ok {
		t.Fatal("a datagram stream must keep its net.PacketConn shape")
	}
	go func() { _, _ = datagramFar.Write([]byte("ip")) }()
	buf := make([]byte, 8)
	_ = got.SetReadDeadline(time.Now().Add(3 * time.Second))
	if n, err := got.Read(buf); err != nil || string(buf[:n]) != "ip" {
		t.Fatalf("read %q, %v; want ip, untouched by the peek", buf[:n], err)
	}

	// The control stream: the magic first, then a claim. It must reach the
	// hub and not the service.
	ctrl, ctrlFar := peerPipe("peerB")
	defer ctrlFar.Close()
	go func() {
		_, _ = ctrlFar.Write(append(append([]byte(nil), ControlMagic...),
			framed(t, claimMessage{Type: ctrlTypeClaim, V: 1, Add: []string{"192.168.50.0/24"}})...))
	}()
	m.dispatch(ctrl)

	want := netip.MustParsePrefix("192.168.50.0/24")
	waitFor(t, "the control stream must reach the hub", func() bool {
		_, ok := h.installed()[want]
		return ok
	})

	// A tun stream that announces nothing but its own first packet: the peek
	// finds no magic, so the stream is delivered to the service whole.
	tun, tunFar := peerPipe("peerC")
	defer tunFar.Close()
	go func() { _, _ = tunFar.Write([]byte("GOST-tun-link")) }()
	m.dispatch(tun)

	stream := acceptWithin(t, accepted, "the tun stream without the magic")
	_ = stream.SetReadDeadline(time.Now().Add(3 * time.Second))
	// Read to completion, as a handler does: the replayed prefix and the rest
	// of the stream may arrive as separate reads.
	replayed := make([]byte, len("GOST-tun-link"))
	if _, err := io.ReadFull(stream, replayed); err != nil {
		t.Fatalf("read the tun stream: %v", err)
	}
	if string(replayed) != "GOST-tun-link" {
		t.Fatalf("read %q, want the spoke's bytes replayed", replayed)
	}
}

// acceptWithin takes one conn off the service's accept queue, failing the test
// with what none arrived for.
func acceptWithin(t *testing.T, conns <-chan net.Conn, what string) net.Conn {
	t.Helper()
	select {
	case c := <-conns:
		return c
	case <-time.After(3 * time.Second):
		t.Fatalf("%s: nothing was accepted", what)
		return nil
	}
}
