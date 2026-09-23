package tunnel

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-gost/core/logger"
	"github.com/go-gost/core/metadata"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/p2p"
	"github.com/go-gost/p2p/endpoint"
	cfg "github.com/go-gost/wisper/config"
	xstats "github.com/go-gost/x/observer/stats"
	stats_wrapper "github.com/go-gost/x/observer/stats/wrapper"
)

// p2pBacklog bounds each peer route's undelivered inbound streams; overflow is
// dropped (the transport is lossy by design).
var p2pBacklog = 64

// P2PHostKeyPath is the process-wide p2p identity: <config>/wisper/p2p/host.key
// (0600, created on first use). One host, one identity, shared by every p2p
// tunnel and entrypoint.
func P2PHostKeyPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "wisper", "p2p", "host.key"), nil
}

// p2pHostManager owns the process-wide host: refcounted lifetime, the inbound
// accept loop, and the peer-key → tunnel routes.
type p2pHostManager struct {
	mu     sync.Mutex
	host   *endpoint.Endpoint
	ln     net.Listener
	routes map[string]*peerListener
	refs   int
}

var p2pHost = &p2pHostManager{routes: make(map[string]*peerListener)}

// AcquireP2PHost returns the process-wide p2p host, starting it on first use
// (key + relay + accept loop), and takes a reference on it. Every
// AcquireP2PHost must be matched by exactly one ReleaseP2PHost, or the host
// never shuts down.
func AcquireP2PHost() (*endpoint.Endpoint, error) { return p2pHost.acquire() }

// ReleaseP2PHost gives one reference back; the last one stops the host, its
// accept loop and every peer route. Releasing without a matching acquire
// would cut someone else's reference short.
func ReleaseP2PHost() { p2pHost.release() }

// P2PHostPublicKey returns the shared host's base64 public key — the value a
// peer's p2p entrypoint dials — materializing the identity on demand so the
// settings page can always show it. Errors are logged and reported as "".
func P2PHostPublicKey() string {
	pub, err := EnsureP2PIdentity()
	if err != nil {
		if log := logger.Default(); log != nil {
			log.Warnf("p2p identity: %v", err)
		}
	}
	return pub
}

// EnsureP2PIdentity returns the process-wide p2p public key, creating the
// identity file on first use. It needs no running service: p2p.New performs no
// network I/O (the DERP connect is deferred to Connect), so two sides can
// exchange keys before either is configured.
func EnsureP2PIdentity() (string, error) { return p2pHost.ensurePublicKey() }

// P2PHostRunning reports whether the shared host is started (a p2p tunnel or
// entrypoint holds a reference). The identity exists either way — see
// EnsureP2PIdentity.
func P2PHostRunning() bool {
	p2pHost.mu.Lock()
	defer p2pHost.mu.Unlock()
	return p2pHost.host != nil
}

// warmPeers starts the path to each peer on the running host: it brings up the
// relay session and the hole punch without opening a stream, so a freshly
// registered allowlist is being arranged — and visible in P2PHostStatus —
// before any traffic. A failure is the peer's business (it may not be up yet),
// so it is logged, never returned. No-op while no host runs.
func (m *p2pHostManager) warmPeers(peers []string) {
	m.mu.Lock()
	host := m.host
	m.mu.Unlock()
	if host == nil {
		return
	}
	for _, peer := range peers {
		if err := host.Warm(peer); err != nil {
			if log := logger.Default(); log != nil {
				log.Warnf("p2p: warm peer %s: %v", peer, err)
			}
		}
	}
}

// P2PHostStatus snapshots the shared host's transport counters; zeros when no
// host is running. DirectPeers/DerpPeers say where each peer's traffic goes
// right now, and PunchSuccess/PunchAttempts whether punching works from here —
// the difference between "direct is on" and "direct is actually in use".
func P2PHostStatus() p2p.Status {
	p2pHost.mu.Lock()
	host := p2pHost.host
	p2pHost.mu.Unlock()
	if host == nil {
		return p2p.Status{}
	}
	return host.Status()
}

// ensurePublicKey returns the running host's key, or materializes the identity
// reader-only when no host is running. The manager lock keeps a concurrent
// acquire from racing the transient host on the same key file.
func (m *p2pHostManager) ensurePublicKey() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.host != nil {
		return m.host.PublicKey(), nil
	}
	keyPath, err := P2PHostKeyPath()
	if err != nil {
		return "", err
	}
	host, err := endpoint.New(&p2p.Config{
		Derp: P2PDerpURL(cfg.Get().Settings),
		Key:  keyPath,
	})
	if err != nil {
		return "", fmt.Errorf("p2p identity: %w", err)
	}
	pub := host.PublicKey()
	_ = host.Close()
	return pub, nil
}

// acquire starts the host on first use (key + relay + Listen + accept loop) and
// takes a reference. A failed relay connection is not fatal: the engine retries
// in the background, so it is logged, never returned.
func (m *p2pHostManager) acquire() (*endpoint.Endpoint, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.host == nil {
		keyPath, err := P2PHostKeyPath()
		if err != nil {
			return nil, err
		}
		settings := cfg.Get().Settings
		direct := P2PDirect(settings)
		conf := &p2p.Config{
			Derp:   P2PDerpURL(settings),
			Key:    keyPath,
			Stun:   p2pHostStun(settings),
			Direct: &direct,
		}
		conf.TLS = P2PTLSConfig(settings)
		host, err := endpoint.New(conf)
		if err != nil {
			return nil, fmt.Errorf("p2p host: %w", err)
		}
		ln, err := host.Listen()
		if err != nil {
			_ = host.Close()
			return nil, err
		}
		if cerr := host.Connect(); cerr != nil {
			if log := logger.Default(); log != nil {
				log.Warnf("p2p derp connect: %v", cerr)
			}
		}
		m.host, m.ln = host, ln
		go m.acceptLoop(ln)
	}
	m.refs++
	return m.host, nil
}

// release drops one reference; the last one stops the host and every route.
func (m *p2pHostManager) release() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.refs > 0 {
		m.refs--
	}
	if m.refs > 0 || m.host == nil {
		return
	}
	if m.ln != nil {
		_ = m.ln.Close()
	}
	_ = m.host.Close()
	m.host, m.ln = nil, nil
	for k, pl := range m.routes {
		pl.close()
		delete(m.routes, k)
	}
}

// register routes inbound streams from every peer in the list to the returned
// listener. It is all-or-nothing: a peer key already claimed by another tunnel
// (or listed twice) rolls back the peers this call added and fails naming the
// peer. An empty list is valid — the listener accepts nothing.
func (m *p2pHostManager) register(peers []string) (net.Listener, error) {
	pl := newPeerListener(peers)
	if err := m.reconcile(pl, peers); err != nil {
		return nil, err
	}
	return pl, nil
}

// reconcile makes ln the route for exactly peers: it claims the missing keys
// and drops the ones ln no longer serves, in one step. All-or-nothing — a key
// another tunnel holds fails the whole change and leaves the table (and ln's
// routes) untouched, so a rejected allowlist cannot half-apply.
func (m *p2pHostManager) reconcile(ln *peerListener, peers []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	want := make(map[string]struct{}, len(peers))
	for _, p := range peers {
		if cur, ok := m.routes[p]; ok && cur != ln {
			return fmt.Errorf("peer %s is already used by another p2p tunnel", p)
		}
		want[p] = struct{}{}
	}
	for p := range want {
		m.routes[p] = ln
	}
	for p, l := range m.routes {
		if l != ln {
			continue
		}
		if _, keep := want[p]; !keep {
			delete(m.routes, p)
		}
	}
	ln.setPeers(peers)
	return nil
}

// unregister drops every peer route ln still owns, so a stale unregister (a
// replaced tunnel's) cannot remove a live route. The listener is closed once,
// when at least one route was removed.
func (m *p2pHostManager) unregister(ln net.Listener) {
	pl, _ := ln.(*peerListener)
	if pl == nil {
		return
	}
	m.mu.Lock()
	owned := false
	for p, l := range m.routes {
		if l == pl {
			delete(m.routes, p)
			owned = true
		}
	}
	m.mu.Unlock()
	if owned {
		_ = pl.Close()
	}
}

// PublicKey returns the host's base64 key, or "" while the host is not running.
func (m *p2pHostManager) PublicKey() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.host == nil {
		return ""
	}
	return m.host.PublicKey()
}

func (m *p2pHostManager) acceptLoop(ln net.Listener) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		m.dispatch(conn)
	}
}

// dispatch routes one inbound conn by its remote address (the peer key); an
// unregistered peer is closed (explicit allowlist, no fallback).
func (m *p2pHostManager) dispatch(conn net.Conn) {
	peer := peerOf(conn)
	m.mu.Lock()
	pl := m.routes[peer]
	m.mu.Unlock()
	if pl == nil {
		if log := logger.Default(); log != nil {
			log.Warnf("p2p inbound stream from unregistered peer %s: closed", peer)
		}
		_ = conn.Close()
		return
	}
	pl.deliver(conn)
}

// peerOf reports the dialing peer's key: the p2p listener carries it in the
// conn's remote address.
func peerOf(conn net.Conn) string {
	if a := conn.RemoteAddr(); a != nil {
		return a.String()
	}
	return ""
}

// peerListener is one tunnel's route — a bounded queue shared by every peer in
// the tunnel's allowlist, lossy on overflow — exposed as a net.Listener for a
// gost service.
type peerListener struct {
	peers  []string
	ch     chan net.Conn
	closed chan struct{}
	once   sync.Once

	// stats is the service's stats object; accepted conns count into it, the
	// way x listeners count via stats.WrapListener.
	stats stats.Stats

	// peers' counters, one stats object per peer key: who is connected and how
	// much they moved, without the service-wide totals.
	mu      sync.Mutex
	traffic map[string]stats.Stats
}

// peerStat returns the per-peer counters for a key, creating them on first use.
func (l *peerListener) peerStat(peer string) stats.Stats {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.traffic == nil {
		l.traffic = make(map[string]stats.Stats)
	}
	s := l.traffic[peer]
	if s == nil {
		s = xstats.NewStats(false)
		l.traffic[peer] = s
	}
	return s
}

// peerTraffic returns the per-peer counters; stats objects are safe to read
// concurrently, so what is copied out lives on.
func (l *peerListener) peerTraffic() map[string]stats.Stats {
	l.mu.Lock()
	defer l.mu.Unlock()

	out := make(map[string]stats.Stats, len(l.traffic))
	for p, s := range l.traffic {
		out[p] = s
	}
	return out
}

// setStats attaches the serving service's stats to the route. It must be
// called before the service starts accepting; nil leaves conns unwrapped.
func (l *peerListener) setStats(s stats.Stats) { l.stats = s }

func newPeerListener(peers []string) *peerListener {
	return &peerListener{peers: peers, ch: make(chan net.Conn, p2pBacklog), closed: make(chan struct{})}
}

func (l *peerListener) deliver(conn net.Conn) {
	peer := peerOf(conn)
	// Each stream carries its peer's counters: closing it — by the service, or
	// by the route's drain — retires the peer exactly once.
	c := wrapConnStats(conn, l.peerStat(peer))
	select {
	case l.ch <- c:
	case <-l.closed:
		_ = c.Close()
	default:
		if log := logger.Default(); log != nil {
			log.Warnf("p2p inbound stream for peer %s dropped (backlog full)", peer)
		}
		_ = c.Close()
	}
}

// wrapConnStats counts a conn's bytes and conn count into pStats, keeping the
// datagram shape a udp tunnel's conn must keep: x's WrapConn returns a
// byte-stream conn, which would hide net.PacketConn from the handler that tells
// udp by it. nil stats leaves the conn unwrapped, like WrapConn does.
func wrapConnStats(c net.Conn, pStats stats.Stats) net.Conn {
	if pStats == nil {
		return c
	}
	if _, ok := c.(net.PacketConn); ok {
		pStats.Add(stats.KindTotalConns, 1)
		pStats.Add(stats.KindCurrentConns, 1)
		return &statsPacketConn{Conn: c, stats: pStats}
	}
	return stats_wrapper.WrapConn(c, pStats)
}

// statsPacketConn is the udp counterpart of x's stats conn wrapper: the route
// and the service take a net.Conn, while the handler tells a udp tunnel by
// net.PacketConn, so this keeps both shapes (net.Conn's methods plus the
// datagram pair). Bytes and the conn count go to the given counters.
type statsPacketConn struct {
	net.Conn
	stats stats.Stats

	closeOnce sync.Once
}

func (c *statsPacketConn) Read(b []byte) (int, error) {
	n, err := c.Conn.Read(b)
	c.stats.Add(stats.KindInputBytes, int64(n))
	return n, err
}

func (c *statsPacketConn) Write(b []byte) (int, error) {
	n, err := c.Conn.Write(b)
	c.stats.Add(stats.KindOutputBytes, int64(n))
	return n, err
}

func (c *statsPacketConn) ReadFrom(b []byte) (int, net.Addr, error) {
	n, err := c.Read(b)
	return n, c.RemoteAddr(), err
}

func (c *statsPacketConn) WriteTo(b []byte, _ net.Addr) (int, error) { return c.Write(b) }

// Close retires the conn count once, then closes the underlying conn.
func (c *statsPacketConn) Close() error {
	c.closeOnce.Do(func() {
		c.stats.Add(stats.KindCurrentConns, -1)
	})
	return c.Conn.Close()
}

func (l *peerListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.ch:
		return wrapConnStats(c, l.stats), nil
	case <-l.closed:
		return nil, net.ErrClosed
	}
}

// Init implements the gost listener.Listener contract: a peer route is a
// queue, not a socket, so there is nothing to configure.
func (l *peerListener) Init(md metadata.Metadata) error { return nil }

func (l *peerListener) close() {
	l.once.Do(func() {
		close(l.closed)
		for {
			select {
			case c := <-l.ch:
				_ = c.Close()
			default:
				return
			}
		}
	})
}

func (l *peerListener) Close() error { l.close(); return nil }

// Addr is the route's allowlist (comma-joined): the route's identity, not a
// socket.
func (l *peerListener) Addr() net.Addr {
	l.mu.Lock()
	peers := append([]string(nil), l.peers...)
	l.mu.Unlock()
	return peerRouteAddr(strings.Join(peers, ","))
}

// setPeers swaps the route's peer list (the tunnel's allowlist changed without
// a restart). A dropped peer's counters go with it, so a key that comes back
// starts from zero.
func (l *peerListener) setPeers(peers []string) {
	l.mu.Lock()
	keep := make(map[string]struct{}, len(peers))
	for _, p := range peers {
		keep[p] = struct{}{}
	}
	for p := range l.traffic {
		if _, ok := keep[p]; !ok {
			delete(l.traffic, p)
		}
	}
	l.peers = append([]string(nil), peers...)
	l.mu.Unlock()
}

type peerRouteAddr string

func (a peerRouteAddr) Network() string { return "p2p" }
func (a peerRouteAddr) String() string  { return string(a) }

// TestP2PRelay dials the relay the way a host would, so the settings page can
// verify connectivity before saving. An empty derp tests the configured relay,
// falling back to the public default; secure/caFile mirror Config.TLS. The key
// is ephemeral: a probe must not touch (or depend on) the host identity. It
// returns the resolved relay URL and how long the connection took.
func TestP2PRelay(derp string, secure *bool, caFile string) (string, time.Duration, error) {
	settings := cfg.Get().Settings
	if derp == "" {
		derp = P2PDerpURL(settings)
	}
	if derp == "" {
		return "", 0, errors.New("no relay configured")
	}

	var key [32]byte
	if _, err := rand.Read(key[:]); err != nil {
		return derp, 0, err
	}
	direct := false
	host, err := endpoint.New(&p2p.Config{
		Derp:   derp,
		KeyHex: hex.EncodeToString(key[:]),
		Direct: &direct,
		TLS:    &p2p.TLSConfig{Secure: secure, CAFile: caFile},
	})
	if err != nil {
		return derp, 0, err
	}
	defer func() { _ = host.Close() }()

	start := time.Now()
	if err := host.Connect(); err != nil {
		return derp, 0, err
	}
	return derp, time.Since(start), nil
}

// p2pHostStun returns the STUN server to build the p2p host with. An explicit
// settings.p2p.stun is used as given — the settings page can test it, and a
// server that is down now may come back — while a *derived* one (P2PStunAddr)
// is used only if it answers: the public relay serves no STUN, and handing
// that guess over would leave every punch, and with it the first stream of
// every peer, waiting on a server that never replies.
func p2pHostStun(settings *cfg.Settings) string {
	if settings != nil && settings.P2P != nil && settings.P2P.Stun != "" {
		return settings.P2P.Stun
	}
	if !P2PDirect(settings) {
		return "" // relay-only: nothing to probe for
	}
	addr := P2PStunAddr(settings)
	if addr == "" {
		return ""
	}
	if !stunAnswers(addr) {
		// Say so: the address was a guess from the relay, and a silent guess
		// would leave a user wondering why direct never comes up.
		if log := logger.Default(); log != nil {
			log.Warnf("p2p: derived STUN %s does not answer, direct (IPv4) stays off; set settings.p2p.stun to enable it", addr)
		}
		return ""
	}
	return addr
}

// stunAnswers probes addr once. The budget is short on purpose: a STUN server
// answers in milliseconds when it answers at all, and this runs on the way to
// a host that is about to serve traffic.
func stunAnswers(addr string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
	defer cancel()
	_, err := endpoint.StunLookup(ctx, addr)
	return err == nil
}

// TestP2PStun probes the STUN server the direct path would use, so the settings
// page can verify it before saving. An empty stun tests the configured (or
// derived) one, the way TestP2PRelay treats its relay. It returns the address
// probed, the public mapping the server reported, and the round trip.
func TestP2PStun(stun string) (string, string, time.Duration, error) {
	if stun == "" {
		stun = P2PStunAddr(cfg.Get().Settings)
	}
	if stun == "" {
		return "", "", 0, errors.New("no STUN server configured")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	start := time.Now()
	mapped, err := endpoint.StunLookup(ctx, stun)
	if err != nil {
		return stun, "", 0, err
	}
	return stun, mapped.String(), time.Since(start), nil
}
