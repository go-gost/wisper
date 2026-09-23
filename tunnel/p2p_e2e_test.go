//go:build p2ppoc

// The acceptance tests for the private p2p mode in its peer-routed shape: a
// wisper p2p tunnel exposing a local echo on the process-wide host, named
// peers dialing in by the host's key through a real derper, and the tunnel's
// stats counting what crossed. TestP2PTunnelRefusesUnlistedPeer pins the
// allowlist: a host whose key is not listed gets no reply, while a listed one
// still does (the in-test control).
package tunnel_test

import (
	"context"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	clogger "github.com/go-gost/core/logger"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/p2p"
	"github.com/go-gost/p2p/endpoint"
	xconfig "github.com/go-gost/x/config"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	_ "github.com/go-gost/x/connector/forward"
	_ "github.com/go-gost/x/dialer/tcp"
	_ "github.com/go-gost/x/dialer/udp"
	"github.com/go-gost/x/registry"

	cfg "github.com/go-gost/wisper/config"
	wtunnel "github.com/go-gost/wisper/tunnel"
)

// relayOnly pins a test's host to the relay: those derpers serve no STUN, so a
// punch could only stall — the direct path has its own test (TestP2PTunnelDirectPath).
var relayOnly = false

// newDialingHost starts an in-process p2p host with a fixed key, connected to
// the DERP relay — the dialing side of a tunnel.
func newDialingHost(t *testing.T, derp, keyHex string) *endpoint.Endpoint {
	t.Helper()
	direct, secure := false, false
	h, err := endpoint.New(&p2p.Config{
		Derp: derp, KeyHex: keyHex,
		Direct: &direct, TLS: &p2p.TLSConfig{Secure: &secure},
	})
	if err != nil {
		t.Fatalf("new p2p host: %v", err)
	}
	t.Cleanup(func() { _ = h.Close() })
	if err := h.Connect(); err != nil {
		t.Fatalf("p2p connect to derper: %v", err)
	}
	if h.PublicKey() == "" {
		t.Fatal("host PublicKey() = empty, want its base64 key")
	}
	return h
}

// runTunnel starts the wisper-side p2p tunnel with the given allowlist and
// registers it for teardown.
func runTunnel(t *testing.T, id, echo string, peers ...string) wtunnel.Tunnel {
	t.Helper()
	tn := wtunnel.NewP2PTunnel(
		wtunnel.IDOption(id),
		wtunnel.EndpointOption(echo),
		wtunnel.PeersOption(peers...),
	)
	if err := tn.Run(); err != nil {
		t.Fatalf("run p2p tunnel: %v", err)
	}
	wtunnel.Add(tn)
	t.Cleanup(func() {
		// Delete closes the tunnel, releasing its manager reference.
		wtunnel.Delete(id)
		// Delete keeps the key file (an update must keep the identity), so the
		// transient test tunnel removes it explicitly.
		if err := wtunnel.RemoveP2PKey(id); err != nil {
			t.Errorf("remove p2p key: %v", err)
		}
	})
	return tn
}

// registerProvider publishes an in-process host's Tunnel the way an entrypoint
// does, and drops it again at teardown.
func registerProvider(t *testing.T, name string, h *endpoint.Endpoint) {
	t.Helper()
	if err := registry.P2PRegistry().Register(name, h); err != nil {
		t.Fatalf("register provider %s: %v", name, err)
	}
	t.Cleanup(func() { registry.P2PRegistry().Unregister(name) })
}

// dialHost opens one stream from provider to the wisper host addressed by
// hostKey — the chain an entrypoint builds, minus the entrypoint.
func dialHost(t *testing.T, ctx context.Context, provider, hostKey string) (net.Conn, error) {
	t.Helper()
	chCfg := wtunnel.ChainConfig("e2e-peer-chain", "e2e-peer-chain", "off")
	node := chCfg.Hops[0].Nodes[0]
	node.Addr = hostKey
	node.Connector = &xconfig.ConnectorConfig{Type: "forward"}
	node.Dialer = &xconfig.DialerConfig{Type: "tcp"}
	node.Metadata = map[string]any{"p2p": provider}
	ch, err := chain_parser.ParseChain(chCfg, clogger.Default())
	if err != nil {
		t.Fatalf("parse chain: %v", err)
	}
	rt := ch.Route(ctx, "tcp", hostKey)
	if rt == nil {
		t.Fatal("chain returned a nil route")
	}
	return rt.Dial(ctx, "tcp", hostKey)
}

// mustEcho writes msg and requires exactly msg back within the deadline.
func mustEcho(t *testing.T, conn net.Conn, msg []byte) {
	t.Helper()
	if _, err := conn.Write(msg); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, len(msg))
	if _, err := io.ReadFull(conn, buf); err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(buf) != string(msg) {
		t.Fatalf("echo = %q, want %q", buf, msg)
	}
}

func TestP2PTunnelAcceptsPeerByKey(t *testing.T) {
	// The host key resolves through os.UserConfigDir(); keep the test out of
	// the real ~/.config/wisper/p2p/.
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	echo := startEchoServer(t) // from p2p_poc_test.go (same package + tag)
	derp := startDerper(t)     // from p2p_udp_poc_test.go (same package + tag)

	secure := false
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{
		P2P: &cfg.P2PSettings{Derp: derp, Secure: &secure, Direct: &relayOnly},
	}})

	// The dialing side: an in-process host with a fixed key. Its public key is
	// the credential the tunnel admits (PeersOption); its Tunnel() is the
	// provider whose dial opens the tunnel to the wisper host's key.
	peer := newDialingHost(t, derp, strings.Repeat("44", 32))
	peerKey := peer.PublicKey()

	// The wisper side: the peer route key is this tunnel's allowlist entry, so
	// an inbound stream from exactly this key is delivered to the tunnel's
	// service.
	tn := runTunnel(t, "e2e-p2p", echo, peerKey)

	// Run started the process-wide host: its key is what the peer dials.
	key := wtunnel.P2PHostPublicKey()
	if key == "" {
		t.Fatal("P2PHostPublicKey() = empty after Run, want the host's base64 key")
	}

	registerProvider(t, "e2e-peer", peer)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	conn, err := dialHost(t, ctx, "e2e-peer", key)
	if err != nil {
		t.Fatalf("dial through the p2p tunnel: %v", err)
	}
	defer conn.Close()

	msg := []byte("hello-private-p2p")
	mustEcho(t, conn, msg)

	// The live view the tunnel page polls: the dialing peer is the one — and
	// only one — connected, and the round trip above is its traffic.
	pstater, ok := tn.(interface{ PeerStats() []wtunnel.PeerStat })
	if !ok {
		t.Fatalf("p2p tunnel %T has no PeerStats", tn)
	}
	pstats := pstater.PeerStats()
	if len(pstats) != 1 || pstats[0].Key != peerKey {
		t.Fatalf("PeerStats = %+v, want one entry for the dialing peer", pstats)
	}
	if pstats[0].InputBytes < uint64(len(msg)) || pstats[0].OutputBytes < uint64(len(msg)) {
		t.Errorf("peer bytes = %d in / %d out, want each >= %d", pstats[0].InputBytes, pstats[0].OutputBytes, len(msg))
	}
	if pstats[0].TotalConns < 1 || pstats[0].CurrentConns < 1 {
		t.Errorf("peer conns = %d total / %d current, want its stream counted", pstats[0].TotalConns, pstats[0].CurrentConns)
	}

	// This setup pins direct off (relayOnly), so the connected peer's path is
	// reported as such, not as an anonymous relay — the per-peer view the
	// peers page and the tunnel card mark.
	if got := wtunnel.P2PHostStatus().PeerTransports[peerKey]; got != "disabled" {
		t.Errorf("peer transport = %q, want disabled (direct is switched off here)", got)
	}

	// Rates come from the snapshot the stats task takes each tick: a transfer
	// inside the window shows up, the bytes before it do not.
	updater, ok := tn.(wtunnel.PeerStatsUpdater)
	if !ok {
		t.Fatalf("p2p tunnel %T does not update peer stats", tn)
	}
	updater.UpdatePeerStats()
	time.Sleep(2 * time.Millisecond)
	window := []byte("rate window")
	mustEcho(t, conn, window)
	updater.UpdatePeerStats()

	pstats = pstater.PeerStats()
	if pstats[0].InputRateBytes == 0 || pstats[0].OutputRateBytes == 0 {
		t.Errorf("peer rates = %d in / %d out, want the window's transfer counted", pstats[0].InputRateBytes, pstats[0].OutputRateBytes)
	}
	if pstats[0].InputBytes < uint64(len(msg)+len(window)) {
		t.Errorf("peer input bytes = %d, want the running total %d", pstats[0].InputBytes, len(msg)+len(window))
	}

	// The tunnel serves its peer route with a standard gost service, so the
	// round trip above must show up in the service's live stats — the same
	// numbers runner/task/stats.go copies into Tunnel.Stats() in production.
	status := tn.Status()
	if status == nil {
		t.Fatal("tunnel Status() = nil, want the service status")
	}
	s := status.Stats()
	if s == nil {
		t.Fatal("service status has no stats")
	}
	if got := s.Get(stats.KindTotalConns); got < 1 {
		t.Errorf("stats TotalConns = %d, want >= 1", got)
	}
	if got := s.Get(stats.KindInputBytes); got < uint64(len(msg)) {
		t.Errorf("stats InputBytes = %d, want >= %d", got, len(msg))
	}
	if got := s.Get(stats.KindOutputBytes); got < uint64(len(msg)) {
		t.Errorf("stats OutputBytes = %d, want >= %d", got, len(msg))
	}

	// Stream ended: the peer shows as disconnected, its bytes still counted.
	// Teardown is async — the service closes its conn once the forwarding ends —
	// so poll briefly.
	if err := conn.Close(); err != nil {
		t.Fatalf("close stream: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for currentConns(pstater) > 0 && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if got := currentConns(pstater); got != 0 {
		t.Errorf("peer current conns after the stream ended = %d, want 0", got)
	}
	if pstats := pstater.PeerStats(); pstats[0].InputBytes < uint64(len(msg)) {
		t.Errorf("peer input bytes after the stream ended = %d, want the transfer kept", pstats[0].InputBytes)
	}
}

// currentConns sums the peers' open streams.
func currentConns(ps interface{ PeerStats() []wtunnel.PeerStat }) int {
	var n int
	for _, p := range ps.PeerStats() {
		n += int(p.CurrentConns)
	}
	return n
}

// TestP2PTunnelDirectPath: the relay is only the fallback. With STUN reachable
// and both ends punching, the tunnel must end up on a hole-punched path, and
// the next stream must actually ride it — the difference between "direct is
// switched on" and "direct is in use", which is what the settings page reports.
func TestP2PTunnelDirectPath(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	echo := startEchoServer(t)
	derp, stun := startDerperSTUN(t)

	secure := false
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{
		P2P: &cfg.P2PSettings{Derp: derp, Secure: &secure, Stun: stun},
	}})

	// The dialing side punches too: a hole is mutual, so both ends need a
	// candidate source (Wisper's own host gets one from the same STUN setting).
	direct := true
	peer, err := endpoint.New(&p2p.Config{
		Derp: derp, KeyHex: strings.Repeat("45", 32), Stun: stun,
		Direct: &direct, TLS: &p2p.TLSConfig{Secure: &secure},
	})
	if err != nil {
		t.Fatalf("new p2p host: %v", err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	if err := peer.Connect(); err != nil {
		t.Fatalf("p2p connect to derper: %v", err)
	}

	runTunnel(t, "e2e-p2p-direct", echo, peer.PublicKey())
	key := wtunnel.P2PHostPublicKey()
	if key == "" {
		t.Fatal("P2PHostPublicKey() = empty after Run")
	}
	registerProvider(t, "e2e-peer-direct", peer)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	conn, err := dialHost(t, ctx, "e2e-peer-direct", key)
	if err != nil {
		t.Fatalf("dial through the p2p tunnel: %v", err)
	}
	mustEcho(t, conn, []byte("hello-direct"))
	conn.Close()

	// The punch runs in the background: the first stream may well have opened
	// on the relay before the direct session settled.
	deadline := time.Now().Add(15 * time.Second)
	host, dialer := wtunnel.P2PHostStatus(), peer.Status()
	for (host.DirectPeers < 1 || dialer.DirectPeers < 1) && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
		host, dialer = wtunnel.P2PHostStatus(), peer.Status()
	}
	if host.DirectPeers < 1 || dialer.DirectPeers < 1 {
		t.Fatalf("no direct session: host direct=%d relay=%d punch=%d/%d, dialer direct=%d relay=%d punch=%d/%d",
			host.DirectPeers, host.DerpPeers, host.PunchSuccess, host.PunchAttempts,
			dialer.DirectPeers, dialer.DerpPeers, dialer.PunchSuccess, dialer.PunchAttempts)
	}
	// The peers page marks each peer from this map, so the key must be there
	// and say direct — the gauge alone would not tell which peer is which.
	if got := host.PeerTransports[peer.PublicKey()]; got != "direct" {
		t.Errorf("peer transport = %q, want direct", got)
	}

	// A stream opened now rides the direct session — the counters say so.
	before := peer.Status().StreamsDirect
	conn2, err := dialHost(t, ctx, "e2e-peer-direct", key)
	if err != nil {
		t.Fatalf("dial over the direct path: %v", err)
	}
	defer conn2.Close()
	mustEcho(t, conn2, []byte("over-direct"))
	if got := peer.Status().StreamsDirect; got <= before {
		t.Errorf("streams over the direct path = %d, want more than %d", got, before)
	}
}

// TestP2PTunnelRefusesUnlistedPeer is the negative case: the allowlist admits
// one key, and a host outside it gets nothing — no reply, and in practice a
// closed stream, since the host's dispatch drops unregistered peers.
func TestP2PTunnelRefusesUnlistedPeer(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	echo := startEchoServer(t)
	derp := startDerper(t)

	secure := false
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{
		P2P: &cfg.P2PSettings{Derp: derp, Secure: &secure, Direct: &relayOnly},
	}})

	listed := newDialingHost(t, derp, strings.Repeat("44", 32))
	intruder := newDialingHost(t, derp, strings.Repeat("55", 32))

	// Only the listed key is in the allowlist.
	runTunnel(t, "e2e-p2p-refuse", echo, listed.PublicKey())

	key := wtunnel.P2PHostPublicKey()
	if key == "" {
		t.Fatal("P2PHostPublicKey() = empty after Run, want the host's base64 key")
	}

	registerProvider(t, "e2e-listed", listed)
	registerProvider(t, "e2e-intruder", intruder)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Control: the listed peer still reaches the backend, so a refusal below
	// cannot pass merely because the relay or the tunnel is broken wholesale.
	control, err := dialHost(t, ctx, "e2e-listed", key)
	if err != nil {
		t.Fatalf("dial as listed peer: %v", err)
	}
	defer control.Close()
	mustEcho(t, control, []byte("hello-listed-peer"))

	// The unlisted peer: the stream must yield nothing. Any of the three
	// refusals counts — dial rejected, write rejected, or the stream closed
	// under the read; a reply is the failure.
	conn, err := dialHost(t, ctx, "e2e-intruder", key)
	if err != nil {
		t.Logf("unlisted peer refused at dial: %v", err)
		return
	}
	defer conn.Close()
	if _, err := conn.Write([]byte("hello-unlisted-peer")); err != nil {
		t.Logf("unlisted peer refused at write: %v", err)
		return
	}
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 32)
	n, err := conn.Read(buf)
	if err == nil {
		t.Fatalf("unlisted peer got a reply %q, want a closed stream", buf[:n])
	}
	t.Logf("unlisted peer refused at read: %v", err)
}

// dialHostUDP is dialHost's datagram twin: the chain node's dialer is udp, so
// the p2p tunnel carries datagrams (one Read/Write per datagram on the
// returned conn).
func dialHostUDP(t *testing.T, ctx context.Context, provider, hostKey string) (net.Conn, error) {
	t.Helper()
	chCfg := wtunnel.ChainConfig("e2e-peer-udp-chain", "e2e-peer-udp-chain", "off")
	node := chCfg.Hops[0].Nodes[0]
	node.Addr = hostKey
	node.Connector = &xconfig.ConnectorConfig{Type: "forward"}
	node.Dialer = &xconfig.DialerConfig{Type: "udp"}
	node.Metadata = map[string]any{"p2p": provider}
	ch, err := chain_parser.ParseChain(chCfg, clogger.Default())
	if err != nil {
		t.Fatalf("parse chain: %v", err)
	}
	rt := ch.Route(ctx, "udp", hostKey)
	if rt == nil {
		t.Fatal("chain returned a nil route")
	}
	return rt.Dial(ctx, "udp", hostKey)
}

// TestP2PTunnelServesPeerDatagrams: a udp dial reaches a wisper p2p tunnel and
// is served to its local backend — the tunnel's peer route delivers a datagram
// conn, the service's local handler dials the backend as udp, and the reply
// comes back on the same dial. This is the shape a udp entrypoint (or a tun
// client) dials into; the per-peer counters count it.
func TestP2PTunnelServesPeerDatagrams(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	echo := startUDPEcho(t, 0) // udp echo, from p2p_udp_poc_test.go (same package + tag)
	derp := startDerper(t)

	secure := false
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{
		P2P: &cfg.P2PSettings{Derp: derp, Secure: &secure, Direct: &relayOnly},
	}})

	peer := newDialingHost(t, derp, strings.Repeat("55", 32))
	peerKey := peer.PublicKey()

	tn := runTunnel(t, "e2e-p2p-udp", echo, peerKey)

	key := wtunnel.P2PHostPublicKey()
	if key == "" {
		t.Fatal("P2PHostPublicKey() = empty after Run, want the host's base64 key")
	}
	registerProvider(t, "e2e-peer-udp", peer)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	conn, err := dialHostUDP(t, ctx, "e2e-peer-udp", key)
	if err != nil {
		t.Fatalf("dial through the p2p tunnel: %v", err)
	}
	defer conn.Close()

	// One datagram each way on the first send: the link buffers the datagram
	// that triggers the dial until its edge is up.
	msg := []byte("hello-udp-private-p2p")
	if _, err := conn.Write(msg); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(10 * time.Second)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, len(msg))
	n, err := conn.Read(buf)
	if err != nil {
		t.Fatalf("read the echo: %v", err)
	}
	if string(buf[:n]) != string(msg) {
		t.Fatalf("echo = %q, want %q", buf[:n], msg)
	}

	// The peer's counters see the datagram traffic (the datagram conn wrapper,
	// not x's byte-stream one, which would strip the PacketConn shape).
	pstater, ok := tn.(interface{ PeerStats() []wtunnel.PeerStat })
	if !ok {
		t.Fatalf("p2p tunnel %T has no PeerStats", tn)
	}
	pstats := pstater.PeerStats()
	if len(pstats) != 1 || pstats[0].Key != peerKey {
		t.Fatalf("PeerStats = %+v, want one entry for the dialing peer", pstats)
	}
	if pstats[0].InputBytes < uint64(len(msg)) || pstats[0].OutputBytes < uint64(len(msg)) {
		t.Errorf("peer bytes = %d in / %d out, want each >= %d",
			pstats[0].InputBytes, pstats[0].OutputBytes, len(msg))
	}
}

// TestP2PTunnelSetPeersAppliesInPlace: saving the allowlist does not restart the
// tunnel. A live peer stream keeps working across the change (the service and
// its listener are the same), and a peer added at the same time starts reaching
// the tunnel.
func TestP2PTunnelSetPeersAppliesInPlace(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	echo := startEchoServer(t)
	derp := startDerper(t)

	secure := false
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{
		P2P: &cfg.P2PSettings{Derp: derp, Secure: &secure, Direct: &relayOnly},
	}})

	peerA := newDialingHost(t, derp, strings.Repeat("66", 32))
	peerB := newDialingHost(t, derp, strings.Repeat("77", 32))

	tn := runTunnel(t, "e2e-p2p-setpeers", echo, peerA.PublicKey())
	key := wtunnel.P2PHostPublicKey()
	registerProvider(t, "e2e-peer-a", peerA)
	registerProvider(t, "e2e-peer-b", peerB)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	connA, err := dialHost(t, ctx, "e2e-peer-a", key)
	if err != nil {
		t.Fatalf("dial A through the p2p tunnel: %v", err)
	}
	defer connA.Close()
	mustEcho(t, connA, []byte("before-the-save"))

	// A second peer is not listed yet: its stream must yield nothing. Any of
	// the three refusals counts — the transport opens either way, so the
	// stream being closed under the read is the usual shape.
	if connB, err := dialHost(t, ctx, "e2e-peer-b", key); err == nil {
		if _, werr := connB.Write([]byte("before-the-save")); werr == nil {
			_ = connB.SetReadDeadline(time.Now().Add(3 * time.Second))
			buf := make([]byte, 32)
			if n, rerr := connB.Read(buf); rerr == nil {
				t.Fatalf("an unlisted peer got a reply %q before the allowlist change", buf[:n])
			}
		}
		_ = connB.Close()
	}

	// Add the second peer in place.
	setter, ok := tn.(wtunnel.PeerSetter)
	if !ok {
		t.Fatalf("p2p tunnel %T does not take a peer list in place", tn)
	}
	if err := setter.SetPeers([]string{peerA.PublicKey(), peerB.PublicKey()}, nil); err != nil {
		t.Fatalf("SetPeers: %v", err)
	}

	// A's live stream survived the change.
	mustEcho(t, connA, []byte("after-the-save"))

	// And B can now dial in.
	connB, err := dialHost(t, ctx, "e2e-peer-b", key)
	if err != nil {
		t.Fatalf("dial B after the allowlist change: %v", err)
	}
	defer connB.Close()
	mustEcho(t, connB, []byte("hello-b"))
}
