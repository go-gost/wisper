package tunnel

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
	"time"

	cfg "github.com/go-gost/wisper/config"
)

// TestTunTunnelMetadata: the two metadata maps are the whole contract this side
// has with x's tun listener and handler. The value *types* matter as much as
// the keys — x reads ttl as an int in seconds, so a time.Duration there would be
// accepted by the map and silently ignored by the handler.
func TestTunTunnelMetadata(t *testing.T) {
	tun := NewTunTunnel(
		IDOption("tun-meta"),
		NameOption("Hub"),
		EndpointOption("127.0.0.1:8421"),
		NetOption("10.10.0.1/24"),
		MTUOption(1400),
		DeviceNameOption("wisper-hub"),
		RoutesOption("192.168.50.0/24"),
		DNSOption("10.10.0.1"),
		KeepaliveOption(true),
		TTLOption(15),
	)

	if tun.Type() != TunTunnel {
		t.Errorf("Type() = %q, want %q", tun.Type(), TunTunnel)
	}
	if got := tun.Endpoint(); got != "127.0.0.1:8421" {
		t.Errorf("Endpoint() = %q, want the bind address", got)
	}
	if got := tun.Entrypoint(); got != "10.10.0.1/24" {
		t.Errorf("Entrypoint() = %q, want the device address", got)
	}

	s, ok := tun.(*tunTunnel)
	if !ok {
		t.Fatalf("NewTunTunnel returned %T, want *tunTunnel", tun)
	}

	lm := s.listenerMetadata()
	for key, want := range map[string]any{
		"name":   "wisper-hub",
		"mtu":    1400,
		"net":    "10.10.0.1/24",
		"routes": "192.168.50.0/24",
		"dns":    "10.10.0.1",
	} {
		if got := lm[key]; got != want {
			t.Errorf("listener metadata[%s] = %v (%T), want %v (%T)", key, got, got, want, want)
		}
	}
	if _, ok := lm["peer"]; ok {
		t.Error("listener metadata carries peer: a tun hub is not a point-to-point link")
	}
	// p2p collapses the route table to a single peer, which would destroy the
	// hub's per-spoke demultiplexing.
	if _, ok := lm["p2p"]; ok {
		t.Error("listener metadata carries p2p: a tun hub must not")
	}

	hm := s.handlerMetadata()
	if got := hm["keepalive"]; got != true {
		t.Errorf("handler metadata[keepalive] = %v, want true", got)
	}
	if v, ok := hm["ttl"].(int); !ok || v != 15 {
		t.Errorf("handler metadata[ttl] = %v (%T), want int 15", hm["ttl"], hm["ttl"])
	}
	if _, ok := hm["p2p"]; ok {
		t.Error("handler metadata carries p2p: a tun hub must not")
	}
}

// TestTunTunnelHasNoBindAddress: a tun hub reaches its spokes over p2p, so it
// has no address to bind — the peer allowlist is the whole of its configuration
// and it is what the route is built from.
func TestTunTunnelHasNoBindAddress(t *testing.T) {
	tun := NewTunTunnel(
		NetOption("10.10.0.1/24"),
		PeersOption("peer-a", "peer-b"),
	).(*tunTunnel)

	if err := tun.init(); err != nil {
		t.Fatalf("init: %v", err)
	}
	if len(tun.opts.Peers) != 2 {
		t.Fatalf("allowlist = %v, want both peers", tun.opts.Peers)
	}
	if tun.Endpoint() != "" {
		t.Errorf("Endpoint = %q, want a hub to bind nothing", tun.Endpoint())
	}
}

// TestTunTunnelRejectsBindAddress: a hub carried over from the socket form is
// refused with a reason instead of silently changing meaning — the paired p2p
// tunnel that repeated the address would be dialing a socket nobody binds.
func TestTunTunnelRejectsBindAddress(t *testing.T) {
	tun := NewTunTunnel(
		EndpointOption("127.0.0.1:8421"),
		NetOption("10.10.0.1/24"),
		PeersOption("peer-a"),
	).(*tunTunnel)

	err := tun.init()
	if err == nil {
		t.Fatal("a hub accepted a bind address")
	}
	if !strings.Contains(err.Error(), "127.0.0.1:8421") {
		t.Errorf("the error does not name the address it rejected: %v", err)
	}
}

// TestTunTunnelAcceptsNoPeers: a hub is created with just a device and its
// spokes arrive on the peers page, so an empty allowlist is the state it is
// built in — not a misconfiguration to refuse. The hub then runs and discards
// every packet, which the API announces (noteNoSpokes) and the detail page
// shows; p2pTunnel has always taken an empty list this way.
func TestTunTunnelAcceptsNoPeers(t *testing.T) {
	tun := NewTunTunnel(NetOption("10.10.0.1/24")).(*tunTunnel)

	if err := tun.init(); err != nil {
		t.Fatalf("init refused a hub with no spokes: %v", err)
	}
}

// TestTunTunnelSetPeersAppliesInPlace: a hub saves its spokes the way a p2p
// tunnel saves its peers — the host's routes are reconciled on the tunnel that
// holds them, so the device, the service and a live spoke's stream all survive
// the change. The routes are the whole of it: a removed spoke is dropped from
// the table, an added one claimed, and a disabled one keeps its place with its
// route taken away. No device is created (that needs CAP_NET_ADMIN): what is
// pinned is that nothing is rebuilt and nothing else is touched.
func TestTunTunnelSetPeersAppliesInPlace(t *testing.T) {
	ln, err := p2pHost.register([]string{"k1"})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	pl := ln.(*peerListener)
	tun := &tunTunnel{
		opts:   Options{Peers: []string{"k1"}, Net: "10.10.0.1/24"},
		ln:     pl,
		cclose: make(chan struct{}),
	}
	// The manager is process-wide, so the routes go back when the test ends.
	defer p2pHost.unregister(pl)

	if err := tun.SetPeers(context.Background(), []string{"k1", "k2"}, map[string]string{"k2": "spoke2"}, []string{"k1"}); err != nil {
		t.Fatalf("SetPeers: %v", err)
	}

	// The disabled spoke keeps its place on the list and loses its route; the
	// added one claims one. Same table a p2p tunnel reconciles against.
	if _, ok := p2pHost.routes["k1"]; ok {
		t.Error("the disabled spoke still holds a route")
	}
	if p2pHost.routes["k2"] != pl {
		t.Errorf("the added spoke's route = %v, want this hub's", p2pHost.routes["k2"])
	}
	if got := pl.Addr().String(); got != "k2" {
		t.Errorf("the hub's route serves %q, want only the enabled spoke", got)
	}
	// The options are swapped under the lock, so the rows the API builds and
	// the routes the host holds cannot disagree.
	if got := tun.Options().Peers; len(got) != 2 || got[0] != "k1" || got[1] != "k2" {
		t.Errorf("Peers = %v, want k1 then k2", got)
	}
	if got := tun.Options().PeerAliases["k2"]; got != "spoke2" {
		t.Errorf("the alias of the added spoke = %q, want it kept", got)
	}
	if got := tun.Options().PeerDisabled; len(got) != 1 || got[0] != "k1" {
		t.Errorf("PeerDisabled = %v, want [k1]", got)
	}
	if got := tun.Options().Net; got != "10.10.0.1/24" {
		t.Errorf("Net = %q, want the device untouched by an allowlist save", got)
	}

	// A key another tunnel holds is the host's one refusal, and it is
	// all-or-nothing: a rejected save leaves the table exactly as it was.
	other, err := p2pHost.register([]string{"k3"})
	if err != nil {
		t.Fatalf("register the other tunnel: %v", err)
	}
	defer other.Close()
	if err := tun.SetPeers(context.Background(), []string{"k1", "k3"}, nil, nil); err == nil {
		t.Fatal("a hub claimed a key another tunnel holds")
	}
	if p2pHost.routes["k3"] != other.(*peerListener) {
		t.Error("the rejected save took the other tunnel's route")
	}
	if _, ok := p2pHost.routes["k2"]; !ok {
		t.Error("the rejected save still dropped this hub's own route")
	}

	// No route means no hub to save: a stopped hub has no device and no table.
	if err := (&tunTunnel{cclose: make(chan struct{})}).SetPeers(context.Background(), []string{"k1"}, nil, nil); err == nil {
		t.Error("a hub with no route took a peer list")
	}
}

// TestTunTunnelRunRecordsFailure: a hub whose config is refused fails to start
// instead of half-starting a device, and the failure is recorded (not a panic,
// not a closed tunnel — the API's start handler restarts a failed tunnel).
// Run is what reaches init, so this is also the test that init is on the start
// path at all: without an endpoint there is nothing else it would refuse.
func TestTunTunnelRunRecordsFailure(t *testing.T) {
	cfg.Set(&cfg.Config{})

	// An endpoint is the shape the old socket hub required, so this is the
	// case a config carried over from that form actually hits.
	tun := NewTunTunnel(NameOption("hub"), EndpointOption("127.0.0.1:8421"))
	if err := tun.Run(); err == nil {
		t.Fatal("Run with a bind address succeeded")
	}
	if tun.Err() == nil {
		t.Error("the failure was not recorded")
	}
	if tun.IsClosed() {
		t.Error("a failed Run closed the tunnel, so it cannot be restarted")
	}
}

// TestTunTunnelPeerStats: a hub's allowlist rows are filled by the API from the
// same two interfaces a p2p tunnel answers, so a hub must report its spokes'
// traffic the same way — allowlist order, an idle spoke as zeros, and rates
// over the stats task's window. The route is registered through the manager the
// way Run registers it; no tun device is created (that needs CAP_NET_ADMIN).
func TestTunTunnelPeerStats(t *testing.T) {
	m := &p2pHostManager{routes: make(map[string]*peerListener)}
	ln, err := m.register([]string{"k1", "k2"})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	pl := ln.(*peerListener)
	tun := &tunTunnel{opts: Options{Peers: []string{"k1", "k2"}}, ln: pl, cclose: make(chan struct{})}

	if got := (&tunTunnel{opts: Options{Peers: []string{"k1"}}}).PeerStats(); got != nil {
		t.Fatalf("PeerStats with no route = %v, want nil", got)
	}

	in1, far1 := peerPipe("k1")
	defer far1.Close()
	in2, far2 := peerPipe("k2")
	defer far2.Close()
	m.dispatch(in1)
	m.dispatch(in2)

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

	got := tun.PeerStats()
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
	tun.UpdatePeerStats() // baseline
	time.Sleep(5 * time.Millisecond)
	k2msg := []byte("k2 traffic")
	mustTransfer(t, far2, c2, k2msg)
	mustTransfer(t, c2, far2, []byte("k2 reply"))
	tun.UpdatePeerStats()

	got = tun.PeerStats()
	if got[1].InputRateBytes == 0 || got[1].OutputRateBytes == 0 {
		t.Errorf("k2 rates = %d in / %d out, want the bytes moved this window", got[1].InputRateBytes, got[1].OutputRateBytes)
	}
	if got[0].InputRateBytes != 0 || got[0].OutputRateBytes != 0 {
		t.Errorf("k1 rates = %d in / %d out, want none (it moved nothing this window)", got[0].InputRateBytes, got[0].OutputRateBytes)
	}

	// Closing the hub's route zeroes the live conns (the p2p tunnel's own
	// contract), and releasing the route — what Close does — gives the report up
	// entirely: there is no route left to count on.
	_ = c2.Close()
	if err := pl.Close(); err != nil {
		t.Fatalf("Close route: %v", err)
	}
	if got := tun.PeerStats(); len(got) != 2 || got[0].CurrentConns != 0 || got[1].CurrentConns != 0 {
		t.Errorf("current conns after the route closed = %d/%d, want 0/0", got[0].CurrentConns, got[1].CurrentConns)
	}
	tun.ln = nil
	if got := tun.PeerStats(); got != nil {
		t.Errorf("PeerStats with the route released = %+v, want nil", got)
	}
}

// TestSaveConfigKeepsTunDevice: the device configuration must survive
// SaveConfig, because the stats runner rewrites the config file every second —
// a field missing there is not merely unpersisted, it is erased.
func TestSaveConfigKeepsTunDevice(t *testing.T) {
	t.Chdir(t.TempDir()) // SaveConfig writes ./wisper.yaml when no config dir is set
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	tun := NewTunTunnel(
		IDOption("tun-save"),
		NameOption("Hub"),
		EndpointOption("127.0.0.1:8421"),
		NetOption("10.10.0.1/24"),
		MTUOption(1400),
		DeviceNameOption("wisper-hub"),
		RoutesOption("192.168.50.0/24"),
		DNSOption("10.10.0.1"),
		KeepaliveOption(true),
		TTLOption(15),
	)
	tun.Close() // never runs: this test is about the file
	Add(tun)
	defer Delete("tun-save")

	if err := SaveConfig(); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	saved := cfg.Get().Tunnels
	if len(saved) != 1 {
		t.Fatalf("saved %d tunnels, want 1", len(saved))
	}
	got := saved[0]
	if got.Net != "10.10.0.1/24" || got.MTU != 1400 || got.DeviceName != "wisper-hub" ||
		got.Routes != "192.168.50.0/24" || got.DNS != "10.10.0.1" ||
		!got.Keepalive || got.TTL != 15 {
		t.Errorf("persisted device config = %+v, want the constructed values", got)
	}

	// The yaml keys are the other half of the round trip: a reload reads them.
	raw, err := os.ReadFile("wisper.yaml")
	if err != nil {
		t.Fatalf("read back the config: %v", err)
	}
	for _, key := range []string{"net:", "mtu:", "device_name:", "routes:", "dns:", "keepalive:", "ttl:"} {
		if !bytes.Contains(raw, []byte(key)) {
			t.Errorf("wisper.yaml carries no %s key:\n%s", key, raw)
		}
	}
}
