package tunnel

import (
	"encoding/binary"
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	cfg "github.com/go-gost/wisper/config"
	xservice "github.com/go-gost/x/service"
)

const testPeerKey = "dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA"

// directOff pins these tests to the relay: they cover lifecycle and routing,
// and a host with the direct path on would probe for a STUN server on the way up.
var directOff = false

// TestP2PStunProbe: the settings-page probe reports the mapping the STUN server
// sends back, so a user can tell a wrong or blocked STUN server from a working
// one (the usual reason a hole punch never comes up).
func TestP2PStunProbe(t *testing.T) {
	const mapped = "203.0.113.7:4567"
	addr := startFakeSTUN(t, mapped)

	got, public, latency, err := TestP2PStun(addr)
	if err != nil {
		t.Fatalf("TestP2PStun: %v", err)
	}
	if got != addr {
		t.Errorf("probed %q, want the address passed in", got)
	}
	if public != mapped {
		t.Errorf("mapped = %q, want what the server reported (%q)", public, mapped)
	}
	if latency <= 0 {
		t.Errorf("latency = %v, want the round trip measured", latency)
	}

	// An empty address probes the configured server, not nothing.
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{
		Derp: "wss://relay.example/derp", Stun: addr,
	}}})
	if got, _, _, err := TestP2PStun(""); err != nil || got != addr {
		t.Errorf("TestP2PStun(empty) = %q, %v; want the configured STUN server", got, err)
	}
}

// startFakeSTUN runs a minimal STUN responder on loopback that reports a fixed
// mapping, and returns the address to probe.
func startFakeSTUN(t *testing.T, mapped string) string {
	t.Helper()
	ua, err := net.ResolveUDPAddr("udp4", mapped)
	if err != nil {
		t.Fatal(err)
	}
	ip4 := ua.IP.To4()
	if ip4 == nil {
		t.Fatalf("fake STUN mapping %q is not IPv4", mapped)
	}

	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })

	go func() {
		const magic = 0x2112A442
		buf := make([]byte, 1500)
		for {
			n, src, err := conn.ReadFromUDP(buf)
			if err != nil {
				return
			}
			if n < 20 || binary.BigEndian.Uint16(buf[0:2]) != 0x0001 {
				continue // not a binding request
			}
			resp := make([]byte, 20, 32)
			binary.BigEndian.PutUint16(resp[0:2], 0x0101) // binding success
			binary.BigEndian.PutUint16(resp[2:4], 12)     // attribute length
			binary.BigEndian.PutUint32(resp[4:8], magic)
			copy(resp[8:20], buf[8:20]) // transaction id
			v := make([]byte, 8)
			v[1] = 0x01 // IPv4
			binary.BigEndian.PutUint16(v[2:4], uint16(ua.Port)^uint16(magic>>16))
			binary.BigEndian.PutUint32(v[4:8], binary.BigEndian.Uint32(ip4)^magic)
			resp = append(resp, 0x00, 0x20, 0x00, 0x08) // XOR-MAPPED-ADDRESS
			_, _ = conn.WriteToUDP(append(resp, v...), src)
		}
	}()
	return conn.LocalAddr().String()
}

// TestP2PTunnelEmptyAllowlist: Peers is an allowlist, not a requirement — an
// empty list runs the tunnel and routes nothing to it (no catch-all).
func TestP2PTunnelEmptyAllowlist(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})
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
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})
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
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})
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
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp", Direct: &directOff}}})
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
// peer's counters — reported in allowlist order, an idle peer as zeros, with
// rates over the stats task's window, and given up when the route closes.
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
	reply := []byte("hi")
	mustTransfer(t, far1, c1, msg)
	mustTransfer(t, c1, far1, reply)
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

	// Rates cover the tick window: k2's traffic moves through it, k1's does not.
	tn.UpdatePeerStats() // baseline
	time.Sleep(5 * time.Millisecond)
	k2msg := []byte("k2 traffic")
	mustTransfer(t, far2, c2, k2msg)
	mustTransfer(t, c2, far2, []byte("k2 reply"))
	tn.UpdatePeerStats()

	got = tn.PeerStats()
	if got[1].InputRateBytes == 0 || got[1].OutputRateBytes == 0 {
		t.Errorf("k2 rates = %d in / %d out, want the bytes moved this window", got[1].InputRateBytes, got[1].OutputRateBytes)
	}
	if got[0].InputRateBytes != 0 || got[0].OutputRateBytes != 0 {
		t.Errorf("k1 rates = %d in / %d out, want none (it moved nothing this window)", got[0].InputRateBytes, got[0].OutputRateBytes)
	}
	if got[1].InputBytes != uint64(len(k2msg)) {
		t.Errorf("k2 input bytes = %d, want %d", got[1].InputBytes, len(k2msg))
	}

	// A queued stream counts as connected, and closing the route drops it — the
	// accepted one the test still holds goes with its own Close.
	in3, far3 := peerPipe("k1")
	defer far3.Close()
	pl.deliver(in3)
	if got := tn.PeerStats()[0].CurrentConns; got != 1 {
		t.Fatalf("k1 current conns with a queued stream = %d, want 1", got)
	}
	_ = c2.Close()
	if err := pl.Close(); err != nil {
		t.Fatalf("Close route: %v", err)
	}
	got = tn.PeerStats()
	if got[0].CurrentConns != 0 || got[1].CurrentConns != 0 {
		t.Errorf("current conns after the route closed = %d/%d, want 0/0", got[0].CurrentConns, got[1].CurrentConns)
	}
}

// mustTransfer writes msg from src and requires exactly msg back on dst —
// net.Pipe is synchronous, so the write needs a reader on the other end.
func mustTransfer(t *testing.T, src, dst net.Conn, msg []byte) {
	t.Helper()
	werr := make(chan error, 1)
	go func() { _, err := src.Write(msg); werr <- err }()
	buf := make([]byte, len(msg))
	if _, err := io.ReadFull(dst, buf); err != nil {
		t.Fatalf("read: %v", err)
	}
	if err := <-werr; err != nil {
		t.Fatalf("write: %v", err)
	}
	if string(buf) != string(msg) {
		t.Fatalf("read %q, want %q", buf, msg)
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

// TestP2PStunAddr: the STUN server follows the relay unless it is set
// explicitly, so a derper that serves STUN (the default) needs no config.
func TestP2PStunAddr(t *testing.T) {
	if got := P2PStunAddr(nil); got != "derp.gost.run:3478" {
		t.Fatalf("P2PStunAddr(nil) = %q, want the public relay's STUN", got)
	}
	got := P2PStunAddr(&cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://relay.example:8443/derp"}})
	if got != "relay.example:3478" {
		t.Fatalf("P2PStunAddr(derp) = %q, want the relay host on the STUN port", got)
	}
	got = P2PStunAddr(&cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://relay.example/derp", Stun: "192.0.2.7:3479"}})
	if got != "192.0.2.7:3479" {
		t.Fatalf("P2PStunAddr(explicit) = %q, want the configured server", got)
	}
	// A relay URL that does not parse leaves the direct path to IPv6.
	if got := P2PStunAddr(&cfg.Settings{P2P: &cfg.P2PSettings{Derp: "://"}}); got != "" {
		t.Fatalf("P2PStunAddr(bad relay) = %q, want empty", got)
	}
}

// TestP2PHostStun: an explicit STUN server is trusted as given, a derived one
// only after it answers — the derived guess (the relay host) is a dead end
// against the public relay, and a punch against it would stall every peer's
// first stream for nothing.
func TestP2PHostStun(t *testing.T) {
	if got := p2pHostStun(&cfg.Settings{P2P: &cfg.P2PSettings{Stun: "192.0.2.7:3479"}}); got != "192.0.2.7:3479" {
		t.Errorf("explicit STUN = %q, want it used as given", got)
	}
	// 192.0.2.1 (TEST-NET-1) is guaranteed unroutable, so the derived address
	// there cannot answer.
	if got := p2pHostStun(&cfg.Settings{P2P: &cfg.P2PSettings{Derp: "wss://192.0.2.1/derp"}}); got != "" {
		t.Errorf("derived STUN that does not answer = %q, want none", got)
	}

	// The probe itself: a server that answers, and one that does not.
	addr := startFakeSTUN(t, "203.0.113.7:4567")
	if !stunAnswers(addr) {
		t.Error("stunAnswers(answering server) = false")
	}
	if stunAnswers("192.0.2.1:9") {
		t.Error("stunAnswers(unroutable server) = true")
	}
}

// TestP2PDirect: the direct path is on unless it is turned off.
func TestP2PDirect(t *testing.T) {
	no, yes := false, true
	for _, tc := range []struct {
		name string
		s    *cfg.Settings
		want bool
	}{
		{"no settings", nil, true},
		{"no p2p block", &cfg.Settings{}, true},
		{"unset", &cfg.Settings{P2P: &cfg.P2PSettings{}}, true},
		{"explicit on", &cfg.Settings{P2P: &cfg.P2PSettings{Direct: &yes}}, true},
		{"explicit off", &cfg.Settings{P2P: &cfg.P2PSettings{Direct: &no}}, false},
	} {
		if got := P2PDirect(tc.s); got != tc.want {
			t.Errorf("P2PDirect(%s) = %v, want %v", tc.name, got, tc.want)
		}
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
