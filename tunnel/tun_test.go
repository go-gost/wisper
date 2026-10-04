package tunnel

import (
	"bytes"
	"context"
	"errors"
	"net"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
	xlogger "github.com/go-gost/x/logger"
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
		"name": "wisper-hub",
		"mtu":  1400,
		"net":  "10.10.0.1/24",
	} {
		if got := lm[key]; got != want {
			t.Errorf("listener metadata[%s] = %v (%T), want %v (%T)", key, got, got, want, want)
		}
	}
	// Routes and DNS must never reach a hub's device, even when they are set on
	// the options. Both are client-side, and a hub runs with host networking:
	// routes would RouteReplace the host's own route to that subnet, and dns
	// would register the hub's device as a resolver on the host. Naming a
	// subnet the host already routes — its own LAN — takes the network down.
	for _, key := range []string{"routes", "dns"} {
		if got, ok := lm[key]; ok {
			t.Errorf("listener metadata carries %s (%v): a tun hub must not", key, got)
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

// TestTunHubIgnoresUsernamePassword: a hub's admission is the allowlist plus its
// own assignment, so the username/password pair it may still carry in its config
// is read by nothing here. It cannot be asserted that no auther exists — what it
// asserts is the observable: a spoke claiming the address its own row assigns is
// registered either way, and a spoke claiming a neighbour's is refused either way.
// If a username ever came back into the decision, the second half would start
// refusing the first spoke's registration, and the hub would need the operator to
// type each spoke's address as the tunnel's username — the thing the allowlist and
// the assignment replaced.
func TestTunHubIgnoresUsernamePassword(t *testing.T) {
	const hubID = "hub-userpass"
	event.Seed(hubID, nil) // isolate: the store is process-wide
	t.Cleanup(func() { event.Seed(hubID, nil) })

	build := func(creds ...Option) *tunTunnel {
		opts := append([]Option{
			IDOption(hubID),
			NameOption("Hub"),
			NetOption("10.10.0.1/24"),
			PeersOption("p1", "p2"),
			PeerIPsOption(map[string]string{"p1": "10.10.0.2", "p2": "10.10.0.3"}),
		}, creds...)
		return NewTunTunnel(opts...).(*tunTunnel)
	}
	plain := build()
	withCreds := build(UsernameOption("hub"), PasswordOption("secret"))

	ctx := context.Background()
	for name, hub := range map[string]*tunTunnel{"without credentials": plain, "with credentials": withCreds} {
		// The hub builds its own authorizer the way Run does, so this exercises the
		// wiring — that the identity is the hub's ID and the assignment is its own
		// rows — and not merely the authorizer in isolation.
		authz := hub.newAuthorizer(xlogger.Nop())

		if !authz.Authorize(ctx, "p1", []net.IP{net.ParseIP("10.10.0.2").To16()}) {
			t.Errorf("%s: a spoke claiming its own assigned address was refused", name)
		}
		if authz.Authorize(ctx, "p1", []net.IP{net.ParseIP("10.10.0.3").To16()}) {
			t.Errorf("%s: a spoke claiming its neighbour's address was authorized", name)
		}
		// The hub's ID, not the peer's key and not the hub's name: the event has to
		// land on the page the operator is looking at. The hub's name here is
		// deliberately different from its ID, so an authorizer built with the name
		// instead would file this refusal where nobody reads it.
		if hub.opts.Name == hub.opts.ID {
			t.Fatal("the fixture's name and id are the same, so the assertion below cannot tell them apart")
		}
		if got := len(event.List(hubID)); got != 1 {
			t.Errorf("%s: the hub's history holds %d refusals, want 1", name, got)
		}
		if got := len(event.List("p1")); got != 0 {
			t.Errorf("%s: %d refusals were filed under the peer key, want none", name, got)
		}
	}
}

// TestTunHubAllocatesPeerAddresses: a hub whose spokes have empty rows gets an
// address for each from its own subnet, and the assignment it hands the
// authorizer is what those spokes may then hold. The hub's own address is the one
// nobody is given, which is what the allocation's self half is for.
//
// This is the wiring, not the allocator: the rules it depends on
// (TestAssignPeerIPs*) are the pure functions' own tests in tunip_test.go. What is
// pinned here is that the hub's Net is what allocation reads, and that the result
// reaches the authorizer through SetPeerIPs — a swap that cannot fail, so a save
// never leaves the two disagreeing.
func TestTunHubAllocatesPeerAddresses(t *testing.T) {
	hub := NewTunTunnel(
		IDOption("hub-alloc"),
		NetOption("10.10.0.1/24"),
		PeersOption("spoke-a", "spoke-b"),
		PeerIPsOption(map[string]string{"spoke-a": "", "spoke-b": ""}),
	).(*tunTunnel)

	prefixes, self := parseHubNets(hub.opts.Net)
	assigned, err := assignPeerIPs(hub.opts.Peers, hub.opts.PeerIPs, prefixes, self)
	if err != nil {
		t.Fatalf("assignPeerIPs: %v", err)
	}
	if assigned["spoke-a"] != "10.10.0.2" || assigned["spoke-b"] != "10.10.0.3" {
		t.Fatalf("assigned = %v, want spoke-a=10.10.0.2 and spoke-b=10.10.0.3", assigned)
	}

	// A hub that is not running has no authorizer to swap, which is what makes this
	// a two-step setup rather than a Run: Run needs CAP_NET_ADMIN for the device.
	hub.authz = hub.newAuthorizer(xlogger.Nop())
	if err := hub.SetPeerIPs(context.Background(), assigned); err != nil {
		t.Fatalf("SetPeerIPs: %v", err)
	}

	ctx := context.Background()
	for peer, want := range map[string]string{"spoke-a": "10.10.0.2", "spoke-b": "10.10.0.3"} {
		if !hub.authz.Authorize(ctx, peer, []net.IP{net.ParseIP(want).To16()}) {
			t.Errorf("%s was refused the address the hub allocated it (%s)", peer, want)
		}
	}
	// The hub's own address is never allocated, so no spoke can claim it and have
	// the hub's self-loop guard refuse it at runtime with a message pointing nowhere
	// near the cause.
	if hub.authz.Authorize(ctx, "spoke-a", []net.IP{net.ParseIP("10.10.0.1").To16()}) {
		t.Error("a spoke was authorized to claim the hub's own address")
	}
	// And the assignment is what the options now carry, so a save writes what is
	// authorizing rather than the empty rows it started from.
	if got := hub.Options().PeerIPs; len(got) != 2 || got["spoke-a"] != "10.10.0.2" || got["spoke-b"] != "10.10.0.3" {
		t.Errorf("PeerIPs = %v, want the allocated rows", got)
	}
}

// TestTunHubDropsRowsItCannotHonour: the hub is the allocator of record, so a row
// naming something it cannot honour is dropped where the operator can see it — when
// the hub starts, and when an assignment is saved — rather than reaching the
// authorizer and being refused later, from a spoke that simply will not register and
// a route-table entry pointing at an address nothing delivers to.
//
// Three rows are in that class: an address outside every subnet the hub's device is
// on (the listener adds a connected route for the hub's own net and a hub asks for no
// routes at all, so such a spoke registers, believes it holds the address, and is
// unreachable at it); an address that is not an address at all; and, in
// TestTunHubDropsBothSidesOfADuplicate below, an address another row names too.
//
// Each is dropped whole, none of them is an error, and the sound rows beside them
// keep working: one typo must not cost a whole subnet's worth of spokes, and must not
// make every later save fail until the operator hand-edits the file.
//
// Both chokepoints are run over the same rows, because what is saved and what
// authorizes are one fact — and a hub started from a hand-edited file has to land on
// exactly the assignment a save would have written.
func TestTunHubDropsRowsItCannotHonour(t *testing.T) {
	const hubID = "hub-drops"
	event.Seed(hubID, nil) // isolate: the store is process-wide
	t.Cleanup(func() { event.Seed(hubID, nil) })

	rows := map[string]string{
		"good":    "10.10.0.2",    // stays: inside the hub's subnet
		"offsite": "192.168.9.9",  // dropped: in no subnet the hub holds
		"junk":    "10.10.0.9/24", // dropped: a prefix is not a host address
		"empty":   "",             // stays: the state that means "may claim nothing"
	}

	for _, cp := range []struct {
		name string
		// apply hands the rows to the hub the way Run or a save does, and returns
		// the authorizer now in force.
		apply func(t *testing.T, hub *tunTunnel) *spokeAuthorizer
	}{
		{"at Run", func(t *testing.T, hub *tunTunnel) *spokeAuthorizer {
			// Run builds its authorizer from the rows already in the options.
			return hub.newAuthorizer(xlogger.Nop())
		}},
		{"at save", func(t *testing.T, hub *tunTunnel) *spokeAuthorizer {
			// Started from an empty assignment, so the drops below are this save's
			// own rather than the Run filter's — the Run filter is the other half of
			// this table, and counting both would double every one of them.
			hub.authz = newSpokeAuthorizer(hub.opts.ID, nil, xlogger.Nop())
			if err := hub.SetPeerIPs(context.Background(), rows); err != nil {
				t.Fatalf("SetPeerIPs: %v", err)
			}
			return hub.authz
		}},
	} {
		t.Run(cp.name, func(t *testing.T) {
			event.Seed(hubID, nil)
			hub := NewTunTunnel(
				IDOption(hubID),
				NetOption("10.10.0.1/24"),
				PeersOption("good", "offsite", "junk", "empty"),
				PeerIPsOption(rows),
			).(*tunTunnel)
			authz := cp.apply(t, hub)

			// The saved assignment is what authorizes, and not merely a superset of
			// it: a row left in the config that the authorizer does not hold is a row
			// the operator can see and the hub is not honouring.
			saved := hub.Options().PeerIPs
			if len(saved) != 2 || saved["good"] != "10.10.0.2" || saved["empty"] != "" {
				t.Fatalf("PeerIPs = %v, want the two rows the hub can honour: good and empty", saved)
			}
			for _, peer := range []string{"offsite", "junk"} {
				if _, ok := saved[peer]; ok {
					t.Errorf("PeerIPs kept the dropped row %q: %v", peer, saved)
				}
			}

			// One warning per dropped row, under the hub's ID, naming the row and
			// why — asserted before the claims below, because a refusal records an
			// event of its own and would land in the same count.
			want := []string{
				`spoke "offsite" dropped from the hub's address assignment: 192.168.9.9 is outside the hub's subnets (10.10.0.0/24)`,
				`spoke "junk" dropped from the hub's address assignment: its row "10.10.0.9/24" is not a comma-separated list of IP addresses`,
			}
			if got := warnMessages(hubID); !sameMessages(got, want) {
				t.Errorf("the hub's warnings = %v, want %v", got, want)
			}
			// The hub's ID, not the peer's key: a peer key names an object the
			// operator has no page for.
			if got := event.List("offsite"); len(got) != 0 {
				t.Errorf("a drop was filed under the peer key: %v", got)
			}

			ctx := context.Background()
			// The sound rows still serve their spokes: dropping one row is not the
			// hub deciding it has had enough rows.
			if !authz.Authorize(ctx, "good", claimOf("10.10.0.2")) {
				t.Error(`the spoke with the sound row was refused its own address`)
			}
			if !authz.Authorize(ctx, "empty", nil) {
				t.Error(`the spoke with the empty row was refused a claim of nothing`)
			}
			if authz.Authorize(ctx, "empty", claimOf("10.10.0.2")) {
				t.Error(`the spoke with the empty row was authorized to claim an address`)
			}

			// A dropped row is refused as a peer this hub does not know — including
			// a claim of nothing, which is the half a "normalise the bad row to an
			// empty one" mistake gets wrong: that would come back as "this spoke may
			// claim nothing" and lock the spoke out with a reason pointing nowhere.
			for _, peer := range []string{"offsite", "junk"} {
				if authz.Authorize(ctx, peer, claimOf("10.10.0.2")) {
					t.Errorf("%s: a spoke whose row was dropped was authorized to claim an address", peer)
				}
				if authz.Authorize(ctx, peer, nil) {
					t.Errorf("%s: a spoke whose row was dropped was authorized to claim nothing, want refused as not in the hub's assignment", peer)
				}
			}
		})
	}
}

// TestTunHubDropsBothSidesOfADuplicate: two rows naming one address is the case the
// whole feature exists to prevent, because the hub's route table is
// last-writer-wins per address — the second spoke to register silently takes the
// first one's route and its traffic goes to the wrong device.
//
// One of the two cannot be kept, and the only order available to choose it by is Go's
// randomized map order: a hub that picked a winner would hand out a different answer
// on the next save, which is a network that changes under a running config. Both rows
// go instead — the address is ambiguous, dropping both sides does not depend on
// iteration order, and both spokes are refused as unknown, the same fail-closed
// answer a malformed row gets.
//
// The repetition is the point. With one run, an implementation that kept whichever
// row the map happened to yield first would pass; the outcome has to be the same
// every time. Both chokepoints are exercised, because a hand-edited file and a save
// reach the same filter by different paths.
func TestTunHubDropsBothSidesOfADuplicate(t *testing.T) {
	const hubID = "hub-dup"
	t.Cleanup(func() { event.Seed(hubID, nil) })

	rows := map[string]string{
		"first":  "10.10.0.2",
		"second": "10.10.0.2",
		"other":  "10.10.0.3",
	}
	want := []string{
		`spoke "first" dropped from the hub's address assignment: 10.10.0.2 appears 2 times in the assignment, so the hub cannot tell which row owns it`,
		`spoke "second" dropped from the hub's address assignment: 10.10.0.2 appears 2 times in the assignment, so the hub cannot tell which row owns it`,
	}

	for _, cp := range []struct {
		name  string
		apply func(t *testing.T, hub *tunTunnel) *spokeAuthorizer
	}{
		{"at Run", func(t *testing.T, hub *tunTunnel) *spokeAuthorizer {
			return hub.newAuthorizer(xlogger.Nop())
		}},
		{"at save", func(t *testing.T, hub *tunTunnel) *spokeAuthorizer {
			hub.authz = newSpokeAuthorizer(hub.opts.ID, nil, xlogger.Nop())
			if err := hub.SetPeerIPs(context.Background(), rows); err != nil {
				t.Fatalf("SetPeerIPs: %v", err)
			}
			return hub.authz
		}},
	} {
		t.Run(cp.name, func(t *testing.T) {
			for i := range 50 {
				// Reseeded per run: event.Record folds a repeat of the newest event
				// into it, so a fixed id would carry one entry with a rising count
				// instead of this run's two drops.
				event.Seed(hubID, nil)
				hub := NewTunTunnel(IDOption(hubID), NetOption("10.10.0.1/24"), PeerIPsOption(rows)).(*tunTunnel)
				authz := cp.apply(t, hub)

				saved := hub.Options().PeerIPs
				if len(saved) != 1 || saved["other"] != "10.10.0.3" {
					t.Fatalf("run %d: PeerIPs = %v, want only the row naming 10.10.0.3: both sides of the duplicate are dropped", i, saved)
				}
				if got := warnMessages(hubID); !sameMessages(got, want) {
					t.Fatalf("run %d: the hub's warnings = %v, want %v", i, got, want)
				}

				ctx := context.Background()
				if !authz.Authorize(ctx, "other", claimOf("10.10.0.3")) {
					t.Errorf("run %d: the spoke whose row was untouched was refused its own address", i)
				}
				for _, peer := range []string{"first", "second"} {
					if authz.Authorize(ctx, peer, claimOf("10.10.0.2")) {
						t.Errorf("run %d: %s, one side of the duplicate, was authorized to claim the contested address", i, peer)
					}
					if authz.Authorize(ctx, peer, nil) {
						t.Errorf("run %d: %s, one side of the duplicate, was authorized to claim nothing, want refused as not in the hub's assignment", i, peer)
					}
				}
			}
		})
	}
}

// TestTunHubDropsARowThatRepeatsItsAddress: the same ambiguity inside one row. No
// claim can ever match "10.10.0.2,10.10.0.2" — the authorizer's sweep consumes, so
// the second copy finds its address already taken — and a row that can authorize
// nothing is a row the hub cannot honour. It is said once, not twice: the count in
// the reason already tells the operator what is wrong.
func TestTunHubDropsARowThatRepeatsItsAddress(t *testing.T) {
	const hubID = "hub-repeat-row"
	event.Seed(hubID, nil)
	t.Cleanup(func() { event.Seed(hubID, nil) })

	hub := NewTunTunnel(
		IDOption(hubID),
		NetOption("10.10.0.1/24"),
		PeerIPsOption(map[string]string{"twice": "10.10.0.2,10.10.0.2", "good": "10.10.0.3"}),
	).(*tunTunnel)
	authz := hub.newAuthorizer(xlogger.Nop())

	saved := hub.Options().PeerIPs
	if len(saved) != 1 || saved["good"] != "10.10.0.3" {
		t.Fatalf("PeerIPs = %v, want only the sound row", saved)
	}
	want := []string{
		`spoke "twice" dropped from the hub's address assignment: 10.10.0.2 appears 2 times in the assignment, so the hub cannot tell which row owns it`,
	}
	if got := warnMessages(hubID); !sameMessages(got, want) {
		t.Errorf("the hub's warnings = %v, want %v — one event for the row, one sentence in it", got, want)
	}
	if authz.Authorize(context.Background(), "twice", claimOf("10.10.0.2")) {
		t.Error("a spoke whose row repeats an address was authorized to claim it once")
	}
}

// TestTunHubWithNoSubnetChecksDuplicatesOnly: a hub with no net configured is one
// broken hub, not a set of broken rows, and the two are deliberately not treated
// alike. The two checks are independent, and only one of them needs a subnet to
// answer.
//
// It does not: two rows naming the same address is a comparison among the rows
// themselves. So the duplicate check still runs here — and it must, because that
// address is just as routable on this hub as on any other, so leaving both rows in
// force is the silent route theft the whole feature exists to prevent, in the one
// configuration where nothing else warns about it.
//
// What is skipped is the question that has no answer without a subnet: an address
// cannot be outside a subnet the hub does not have, so an off-subnet row stays — and
// so does a row naming the address the hub *would* hold if it had a net, because
// this hub holds nothing and that value is an ordinary address to it. Dropping rows
// on the missing "net" instead would turn one absent field into an assignment of
// nothing — every spoke refused, with warnings blaming rows the operator never wrote,
// and a hub that reads as a broken allowlist. The mistake is already reported where
// it is made: assignPeerIPs refuses to allocate on a hub with no subnet, and
// validatePeerIP names the missing subnet to whoever typed an address.
//
// A net that does not parse is the same hub: parseHubNets skips an entry it cannot
// read, so a hub whose only entry is junk has no subnet either.
func TestTunHubWithNoSubnetChecksDuplicatesOnly(t *testing.T) {
	const hubID = "hub-nosubnet"
	t.Cleanup(func() { event.Seed(hubID, nil) })

	// The rows this hub cannot judge: one in no subnet it has, one naming what would
	// be its own address if it had a net. Both are ordinary rows here.
	unjudgeable := map[string]string{
		"offsite": "192.168.9.9",
		"wouldbe": "10.10.0.1",
		"first":   "10.10.0.2",
		"second":  "10.10.0.3",
	}
	// And the one thing it can judge, because the answer does not depend on a subnet:
	// two rows naming one address.
	contested := map[string]string{
		"first":  "10.10.0.2",
		"second": "10.10.0.2",
		"other":  "10.10.0.3",
	}
	wantContested := []string{
		`spoke "first" dropped from the hub's address assignment: 10.10.0.2 appears 2 times in the assignment, so the hub cannot tell which row owns it`,
		`spoke "second" dropped from the hub's address assignment: 10.10.0.2 appears 2 times in the assignment, so the hub cannot tell which row owns it`,
	}

	for _, tc := range []struct{ name, netSpec string }{
		{"no net at all", ""},
		{"a net that does not parse", "not-a-cidr"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Run("rows it cannot judge are kept", func(t *testing.T) {
				event.Seed(hubID, nil)
				hub := NewTunTunnel(IDOption(hubID), NetOption(tc.netSpec), PeerIPsOption(unjudgeable)).(*tunTunnel)
				authz := hub.newAuthorizer(xlogger.Nop())

				saved := hub.Options().PeerIPs
				if len(saved) != len(unjudgeable) {
					t.Fatalf("PeerIPs = %v, want every row kept: with no subnet there is nothing to judge a row against", saved)
				}
				for peer, want := range unjudgeable {
					if saved[peer] != want {
						t.Errorf("PeerIPs[%q] = %q, want %q", peer, saved[peer], want)
					}
				}
				if got := warnMessages(hubID); len(got) != 0 {
					t.Errorf("a hub with no subnet warned about rows it cannot judge: %v", got)
				}

				// Kept and in force, not merely saved: the skipped step is a no-op on
				// both sides of the saved-is-what-authorizes invariant.
				if !authz.Authorize(context.Background(), "first", claimOf("10.10.0.2")) {
					t.Error("the spoke whose row was kept was refused its own address")
				}
			})

			t.Run("contested rows are still dropped", func(t *testing.T) {
				event.Seed(hubID, nil)
				hub := NewTunTunnel(IDOption(hubID), NetOption(tc.netSpec), PeerIPsOption(contested)).(*tunTunnel)
				authz := hub.newAuthorizer(xlogger.Nop())

				saved := hub.Options().PeerIPs
				if len(saved) != 1 || saved["other"] != "10.10.0.3" {
					t.Fatalf("PeerIPs = %v, want only the row naming 10.10.0.3: a duplicate needs no subnet to spot", saved)
				}
				if got := warnMessages(hubID); !sameMessages(got, wantContested) {
					t.Errorf("the hub's warnings = %v, want %v", got, wantContested)
				}

				ctx := context.Background()
				if !authz.Authorize(ctx, "other", claimOf("10.10.0.3")) {
					t.Error("the spoke whose row was untouched was refused its own address")
				}
				for _, peer := range []string{"first", "second"} {
					if authz.Authorize(ctx, peer, claimOf("10.10.0.2")) {
						t.Errorf("%s, one side of the duplicate, was authorized to claim the contested address on a hub with no subnet", peer)
					}
				}
			})
		})
	}
}

// TestTunHubDropsARowNamingItsOwnAddress: a row naming the address the hub's own
// device holds is one the hub can never honour, and dropping it is what stops the
// failure this feature was designed around: x's self-loop guard turns such a spoke
// away at registration with a message pointing nowhere near the cause, so an
// operator would be left with a spoke that "will not connect" and a hub that says
// nothing.
//
// It is the same filter, the same event and the same consequence as an off-subnet
// row, because it is the same class of thing: an address this hub does not give.
// parseHubNets returns the hub's own address as a second return value precisely
// because the prefix cannot carry it, so this costs the rule rather than a mechanism.
//
// The other half of it is what happens on a hub with no net: there is no subnet for
// the address to be outside of, and no address the hub holds at all, so 10.10.0.1 is
// an ordinary value to that hub and the row is kept. That is the same reasoning the
// off-subnet pass-through rests on, applied to the own-address check because it is
// part of the same step.
func TestTunHubDropsARowNamingItsOwnAddress(t *testing.T) {
	const hubID = "hub-self"
	event.Seed(hubID, nil)
	t.Cleanup(func() { event.Seed(hubID, nil) })

	hub := NewTunTunnel(
		IDOption(hubID),
		NetOption("10.10.0.1/24"),
		PeerIPsOption(map[string]string{"greedy": "10.10.0.1", "good": "10.10.0.2"}),
	).(*tunTunnel)
	authz := hub.newAuthorizer(xlogger.Nop())

	saved := hub.Options().PeerIPs
	if len(saved) != 1 || saved["good"] != "10.10.0.2" {
		t.Fatalf("PeerIPs = %v, want only the sound row: the hub's own address is nobody's to hand out", saved)
	}
	want := []string{
		`spoke "greedy" dropped from the hub's address assignment: 10.10.0.1 is the hub's own address, which no spoke may claim`,
	}
	if got := warnMessages(hubID); !sameMessages(got, want) {
		t.Errorf("the hub's warnings = %v, want %v", got, want)
	}
	if got := event.List("greedy"); len(got) != 0 {
		t.Errorf("a drop was filed under the peer key: %v", got)
	}

	ctx := context.Background()
	// The row beside it is untouched: dropping one row is not the hub deciding it
	// has had enough rows.
	if !authz.Authorize(ctx, "good", claimOf("10.10.0.2")) {
		t.Error("the spoke with the sound row was refused its own address")
	}
	if authz.Authorize(ctx, "greedy", claimOf("10.10.0.1")) {
		t.Error("a spoke whose row named the hub's own address was authorized to claim it")
	}
	if authz.Authorize(ctx, "greedy", nil) {
		t.Error("a spoke whose row named the hub's own address was authorized to claim nothing, want refused as not in the hub's assignment")
	}

	// The same value on a hub with no net, where the hub holds no address at all and
	// there is no subnet for this one to be outside of.
	event.Seed(hubID, nil)
	nosub := NewTunTunnel(
		IDOption(hubID),
		NetOption(""),
		PeerIPsOption(map[string]string{"anybody": "10.10.0.1"}),
	).(*tunTunnel)
	nosubAuthz := nosub.newAuthorizer(xlogger.Nop())

	if saved := nosub.Options().PeerIPs; len(saved) != 1 || saved["anybody"] != "10.10.0.1" {
		t.Errorf("PeerIPs on a hub with no net = %v, want the row kept: that hub holds no address of its own", saved)
	}
	if got := warnMessages(hubID); len(got) != 0 {
		t.Errorf("a hub with no net dropped a row naming what would be its own address: %v", got)
	}
	if !nosubAuthz.Authorize(ctx, "anybody", claimOf("10.10.0.1")) {
		t.Error("on a hub that holds no address of its own, a spoke was refused 10.10.0.1")
	}
}

// claimOf is the shape a spoke's claim arrives in: 16 bytes per address, which is
// what x writes on the wire, so an IPv4 address reaches Authorize as ::ffff:a.b.c.d.
func claimOf(addr string) []net.IP {
	return []net.IP{net.ParseIP(addr).To16()}
}

// warnMessages returns the warnings filed under id, oldest first. A repeat of the
// newest one is folded into it with a count, so this is one entry per distinct
// message rather than one per occurrence.
func warnMessages(id string) []string {
	var msgs []string
	for _, ev := range event.List(id) {
		if ev.Level == event.LevelWarn {
			msgs = append(msgs, ev.Message)
		}
	}
	return msgs
}

// sameMessages compares two sets of messages without regard to order. The store's
// order follows the order the rows were ranged over and Go randomizes map order, so
// an order-sensitive comparison would be a scheduler bet rather than an assertion.
func sameMessages(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	a, b := slices.Clone(got), slices.Clone(want)
	slices.Sort(a)
	slices.Sort(b)
	return slices.Equal(a, b)
}

// TestTunHubAllocationIsStableAcrossSaves: allocation is idempotent. The second
// save of the same hub runs it again over the rows the first save filled, and it
// must change nothing — every row now names an address, so there is nothing left
// to fill, and the addresses stay the ones the spokes already hold. A hub whose
// addresses shifted under it on the second save would have every spoke's device
// address change without anybody touching it.
func TestTunHubAllocationIsStableAcrossSaves(t *testing.T) {
	hub := NewTunTunnel(
		IDOption("hub-stable"),
		NetOption("10.10.0.1/24"),
		PeersOption("spoke-a", "spoke-b"),
		PeerIPsOption(map[string]string{"spoke-a": "", "spoke-b": ""}),
	).(*tunTunnel)
	hub.authz = hub.newAuthorizer(xlogger.Nop())

	prefixes, self := parseHubNets(hub.opts.Net)
	first, err := assignPeerIPs(hub.opts.Peers, hub.opts.PeerIPs, prefixes, self)
	if err != nil {
		t.Fatalf("assignPeerIPs: %v", err)
	}
	if err := hub.SetPeerIPs(context.Background(), first); err != nil {
		t.Fatalf("SetPeerIPs: %v", err)
	}

	// The second save starts from what the first one left, which is what a real
	// save does: the rows come out of the config that was written from them.
	second, err := assignPeerIPs(hub.opts.Peers, hub.Options().PeerIPs, prefixes, self)
	if err != nil {
		t.Fatalf("assignPeerIPs on the saved rows: %v", err)
	}
	for peer, want := range first {
		if second[peer] != want {
			t.Errorf("save two gave %s = %q, want the %q the first save assigned", peer, second[peer], want)
		}
	}
	if len(second) != len(first) {
		t.Errorf("save two produced %d rows, want %d", len(second), len(first))
	}
	if err := hub.SetPeerIPs(context.Background(), second); err != nil {
		t.Fatalf("SetPeerIPs: %v", err)
	}
	if got := hub.Options().PeerIPs; len(got) != 2 || got["spoke-a"] != "10.10.0.2" || got["spoke-b"] != "10.10.0.3" {
		t.Errorf("PeerIPs after the second save = %v, want the first save's addresses", got)
	}
}

// TestTunHubSetPeerIPsNeedsARunningHub: SetPeers refuses a hub with no route and
// SetPeerIPs refuses one with no authorizer, because both mean the same thing —
// there is no hub to save. The order of the two checks matters and is pinned: a
// closed hub says so even though its authorizer is also gone by then, because
// ErrTunnelClosed is the more useful of the two answers.
func TestTunHubSetPeerIPsNeedsARunningHub(t *testing.T) {
	hub := &tunTunnel{opts: Options{Net: "10.10.0.1/24"}, cclose: make(chan struct{})}

	err := hub.SetPeerIPs(context.Background(), map[string]string{"p1": "10.10.0.2"})
	if err == nil {
		t.Fatal("a hub that never ran took an assignment")
	}
	if !strings.Contains(err.Error(), "not running") {
		t.Errorf("a hub that never ran was refused with %v, want an error saying it is not running", err)
	}
	// The options are untouched, so a refused save cannot half-apply.
	if hub.Options().PeerIPs != nil {
		t.Errorf("PeerIPs = %v, want nil: a refused save must change nothing", hub.Options().PeerIPs)
	}

	hub.authz = hub.newAuthorizer(xlogger.Nop())
	if err := hub.SetPeerIPs(context.Background(), map[string]string{"p1": "10.10.0.2"}); err != nil {
		t.Fatalf("SetPeerIPs on a hub with an authorizer: %v", err)
	}
	if got := hub.Options().PeerIPs["p1"]; got != "10.10.0.2" {
		t.Errorf("PeerIPs[p1] = %q, want the assignment applied", got)
	}

	// Close drops the authorizer with the rest of the run, so a closed hub is
	// refused for being closed rather than for being stopped.
	if err := hub.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if hub.authz != nil {
		t.Error("Close kept the authorizer: a closed hub would answer as if it were running")
	}
	if err := hub.SetPeerIPs(context.Background(), map[string]string{"p1": "10.10.0.3"}); !errors.Is(err, ErrTunnelClosed) {
		t.Errorf("SetPeerIPs on a closed hub = %v, want ErrTunnelClosed", err)
	}
	if got := hub.Options().PeerIPs["p1"]; got != "10.10.0.2" {
		t.Errorf("PeerIPs[p1] = %q after a refused save, want the assignment before it", got)
	}
}

// TestNormalizePeerIPsDropsRemovedKeys: an assignment outlives the allowlist row it
// belongs to unless it is normalized, so a spoke removed from a hub's allowlist
// would keep its address in the config and come back already holding it if it were
// ever added again. Same rule, same shape as NormalizePeerDisabled.
func TestNormalizePeerIPsDropsRemovedKeys(t *testing.T) {
	known := map[string]string{"p1": "10.10.0.2", "p2": "10.10.0.3", "p3": ""}

	got := NormalizePeerIPs([]string{"p1", "p3"}, known)
	if len(got) != 2 {
		t.Fatalf("normalized = %v, want the two still-listed rows", got)
	}
	if got["p1"] != "10.10.0.2" || got["p3"] != "" {
		t.Errorf("normalized = %v, want p1=10.10.0.2 and p3 kept as the empty row it is", got)
	}
	if _, ok := got["p2"]; ok {
		t.Errorf("normalized kept the removed spoke p2: %v", got)
	}

	// Values are the operator's and are never re-rendered: normalization drops keys,
	// it does not parse or reformat addresses.
	prefixed := NormalizePeerIPs([]string{"p1"}, map[string]string{"p1": " 10.10.0.2 , 10.10.0.9 "})
	if prefixed["p1"] != " 10.10.0.2 , 10.10.0.9 " {
		t.Errorf("normalized rewrote an address: %q", prefixed["p1"])
	}

	if got := NormalizePeerIPs(nil, known); got != nil {
		t.Errorf("normalized with no allowlist = %v, want nil", got)
	}
	if got := NormalizePeerIPs([]string{"p1"}, nil); got != nil {
		t.Errorf("normalized with no assignment = %v, want nil", got)
	}
	if got := NormalizePeerIPs([]string{"p4"}, known); got != nil {
		t.Errorf("normalized with nothing still listed = %v, want nil", got)
	}
}

// TestTunTunnelSatisfiesPeerIPSetter: structural, like the assertions above it.
// The API's peers save reaches a hub's assignment through this interface, so a hub
// that stopped implementing it would refuse assignments at the handler with a cast
// failure rather than at the build.
func TestTunTunnelSatisfiesPeerIPSetter(t *testing.T) {
	var setter PeerIPSetter = NewTunTunnel(NetOption("10.10.0.1/24")).(*tunTunnel)
	if err := setter.SetPeerIPs(context.Background(), map[string]string{"p1": "10.10.0.2"}); err == nil {
		t.Error("a hub that never ran took an assignment through the interface")
	}
}

// TestSaveConfigKeepsPeerIPs: the assignment is the hub's whole authorization
// policy, so it has to survive the config round trip — SaveConfig rewrites
// wisper.yaml on every stats tick, and a field missing there is not merely
// unpersisted, it is erased within a second of being saved. The same is true of
// the load path: a hub that starts from an empty assignment refuses every spoke.
func TestSaveConfigKeepsPeerIPs(t *testing.T) {
	t.Chdir(t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	tun := NewTunTunnel(
		IDOption("tun-peerips"),
		NetOption("10.10.0.1/24"),
		PeersOption("p1", "p2"),
		PeerIPsOption(map[string]string{"p1": "10.10.0.2", "p2": "10.10.0.3"}),
	)
	tun.Close() // never runs: this test is about the file
	Add(tun)
	defer Delete("tun-peerips")

	if err := SaveConfig(); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	got := cfg.Get().Tunnels
	if len(got) != 1 {
		t.Fatalf("saved %d tunnels, want 1", len(got))
	}
	if len(got[0].PeerIPs) != 2 || got[0].PeerIPs["p1"] != "10.10.0.2" || got[0].PeerIPs["p2"] != "10.10.0.3" {
		t.Errorf("persisted assignment = %v, want both rows", got[0].PeerIPs)
	}
	raw, err := os.ReadFile("wisper.yaml")
	if err != nil {
		t.Fatalf("read back the config: %v", err)
	}
	if !bytes.Contains(raw, []byte("peer_ips:")) {
		t.Errorf("wisper.yaml carries no peer_ips key:\n%s", raw)
	}

	// The load side, without running anything: LoadConfig would start the hub, and
	// a hub needs CAP_NET_ADMIN. What is normalized here is the assignment, which
	// is the part that would come back wrong.
	if back := NormalizePeerIPs(got[0].Peers, got[0].PeerIPs); len(back) != 2 ||
		back["p1"] != "10.10.0.2" || back["p2"] != "10.10.0.3" {
		t.Errorf("the loaded assignment = %v, want both rows", back)
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
