package tunnel

import (
	"context"
	"net"
	"slices"
	"testing"
	"time"

	"github.com/go-gost/core/router"
)

// The interface check the brief asks for: a *NetviewRouter is a router.Router,
// or the named registration at the tun listener (x/listener/tun/metadata.go:37)
// would never accept it.
var _ router.Router = (*NetviewRouter)(nil)

func TestNetviewRouterLPMAndUnknownDestination(t *testing.T) {
	r := NewNetviewRouter()
	r.Apply(netviewMessage{Type: "netview", V: 1, Hub: "hub1", Rev: 1, Claims: []claimEntry{
		{Prefix: "192.168.0.0/16", Origin: "peerW"},
		{Prefix: "192.168.50.0/24", Origin: "peerB"},
	}})

	// Longest-prefix *selection*, not just "some route exists": the /24 is
	// peerB's claim and the /16 is peerW's, so Dst names which claim won.
	// A shortest-first walk, a first-match-anywhere walk, or an
	// "any non-nil route" bug each fail one of these two lookups.
	rt := r.GetRoute(context.Background(), "192.168.50.9")
	if rt == nil {
		t.Fatal("a claimed prefix must resolve")
	}
	if rt.Dst != "192.168.50.0/24" {
		t.Fatalf("192.168.50.9 must select peerB's /24, the longest match: got %+v", rt)
	}
	// Inside the /16 but outside the /24: the shorter claim still matches,
	// because the snapshot is longest-first and nothing longer covers it.
	rt = r.GetRoute(context.Background(), "192.168.77.9")
	if rt == nil {
		t.Fatal("a /16 claim must match a destination no /24 covers")
	}
	if rt.Dst != "192.168.0.0/16" {
		t.Fatalf("192.168.77.9 must select peerW's /16, not just any claim: got %+v", rt)
	}
	// Nothing claims it: no route, and the packet keeps its existing fate.
	if rt := r.GetRoute(context.Background(), "8.8.8.8"); rt != nil {
		t.Fatalf("an unclaimed destination must have no route: %+v", rt)
	}
}

func TestNetviewRouterIgnoresStaleRevAndAcceptsNewHub(t *testing.T) {
	r := NewNetviewRouter()
	r.Apply(netviewMessage{V: 1, Hub: "hub1", Rev: 5, Claims: []claimEntry{{Prefix: "192.168.50.0/24", Origin: "peerB"}}})
	r.Apply(netviewMessage{V: 1, Hub: "hub1", Rev: 4, Claims: []claimEntry{{Prefix: "10.0.0.0/8", Origin: "peerX"}}})
	if rt := r.GetRoute(context.Background(), "10.1.2.3"); rt != nil {
		t.Fatal("a stale rev must not install")
	}
	// The stale push must leave the installed table intact, not merely leave
	// the stale claim uninstalled: peerB's route still answers.
	if rt := r.GetRoute(context.Background(), "192.168.50.9"); rt == nil || rt.Dst != "192.168.50.0/24" {
		t.Fatalf("a stale rev must not disturb the installed table: got %+v", rt)
	}
	r.Apply(netviewMessage{V: 1, Hub: "hub2", Rev: 1, Claims: []claimEntry{{Prefix: "10.0.0.0/8", Origin: "peerX"}}})
	rt := r.GetRoute(context.Background(), "10.1.2.3")
	if rt == nil {
		t.Fatal("a new hub id must be accepted at any rev")
	}
	if rt.Dst != "10.0.0.0/8" {
		t.Fatalf("the new hub's claim must be the one answering: got %+v", rt)
	}
}

// A hub restart keeps its id (the id is its peer key) but starts a new
// generation at rev 1. Without the generation check every push from the new
// process would look stale for as long as the old rev was higher — the wedge
// the hub's per-run Gen exists to close.
func TestNetviewRouterGenResetsRev(t *testing.T) {
	r := NewNetviewRouter()
	if !r.Apply(netviewMessage{V: 1, Hub: "hub1", Gen: "g1", Rev: 5,
		Claims: []claimEntry{{Prefix: "192.168.50.0/24", Origin: "peerA"}}}) {
		t.Fatal("the first netview must be accepted")
	}
	if r.Apply(netviewMessage{V: 1, Hub: "hub1", Gen: "g1", Rev: 4,
		Claims: []claimEntry{{Prefix: "10.0.0.0/8", Origin: "peerB"}}}) {
		t.Fatal("an older rev in the same generation must be rejected")
	}
	if rt := r.GetRoute(context.Background(), "10.1.2.3"); rt != nil {
		t.Fatalf("a stale rev must not install: got %+v", rt)
	}

	if !r.Apply(netviewMessage{V: 1, Hub: "hub1", Gen: "g2", Rev: 1,
		Claims: []claimEntry{{Prefix: "10.0.0.0/8", Origin: "peerB"}}}) {
		t.Fatal("a new generation at rev 1 must be accepted")
	}
	if rt := r.GetRoute(context.Background(), "10.1.2.3"); rt == nil || rt.Dst != "10.0.0.0/8" {
		t.Fatalf("the new generation's claim must be installed: got %+v", rt)
	}
	if hub, gen, rev := r.Generation(); hub != "hub1" || gen != "g2" || rev != 1 {
		t.Fatalf("generation = (%q, %q, %d), want (hub1, g2, 1)", hub, gen, rev)
	}
}

// The peer list and the inbound block filter read Members and Claims. They
// must see exactly what the hub published — name, direct/disabled flags, the
// claim's origin and allow list — and must not be able to mutate the router's
// table through the returned slices.
func TestNetviewRouterMembersClaims(t *testing.T) {
	r := NewNetviewRouter()
	r.Apply(netviewMessage{V: 1, Hub: "hub1", Gen: "g1", Rev: 1,
		Members: []memberEntry{
			{IP: "10.10.100.1", Key: "hub", Name: "Home hub"},
			{IP: "10.10.100.5", Key: "peerB", Name: "laptop", Direct: true},
			{IP: "10.10.100.6", Key: "peerC", Disabled: true},
		},
		Claims: []claimEntry{
			{Prefix: "192.168.50.0/24", Origin: "peerB", Allow: []string{"peerC"}},
			{Prefix: "192.168.0.0/16", Origin: "peerD"},
		},
	})

	members := r.Members()
	if len(members) != 3 {
		t.Fatalf("members = %d, want 3", len(members))
	}
	if members[1].Name != "laptop" || !members[1].Direct || members[2].Disabled != true {
		t.Fatalf("member fields not preserved: %+v", members)
	}

	claims := r.Claims()
	if len(claims) != 2 {
		t.Fatalf("claims = %d, want 2", len(claims))
	}
	// The router preserves the hub's order; sorting is the lookup table's
	// job, not the published view's.
	if claims[0].Prefix != "192.168.50.0/24" || claims[1].Prefix != "192.168.0.0/16" {
		t.Fatalf("claim order not preserved: %+v", claims)
	}
	if claims[0].Origin != "peerB" || !slices.Equal(claims[0].Allow, []string{"peerC"}) {
		t.Fatalf("claim fields not preserved: %+v", claims[0])
	}

	// A caller owns its copy.
	claims[0].Allow[0] = "peerZ"
	members[0].Name = "changed"
	again := r.Claims()
	if !slices.Equal(again[0].Allow, []string{"peerC"}) {
		t.Fatalf("Claims returned a slice sharing the router's table: %+v", again[0])
	}
	if r.Members()[0].Name != "Home hub" {
		t.Fatalf("Members returned a slice sharing the router's table: %+v", r.Members()[0])
	}
}

func TestNetviewMemberSyncOnlyAccepted(t *testing.T) {
	r := NewNetviewRouter()
	syncs := 0
	var synced []string
	cfg := ControlChannelConfig{
		Router:     r,
		RouteSync:  func(prefixes []string) { synced = prefixes },
		MemberSync: func() { syncs++ },
	}

	deliverNetview(cfg, netviewMessage{V: 1, Hub: "hub", Gen: "g1", Rev: 1,
		Claims: []claimEntry{{Prefix: "192.168.50.0/24", Origin: "peerB"}}})
	if syncs != 1 {
		t.Fatalf("MemberSync ran %d times after an accepted netview, want 1", syncs)
	}
	if len(synced) != 1 {
		t.Fatalf("RouteSync saw %v, want the accepted prefix", synced)
	}

	deliverNetview(cfg, netviewMessage{V: 1, Hub: "hub", Gen: "g1", Rev: 1})
	if syncs != 1 {
		t.Fatalf("MemberSync ran for a rejected netview: %d", syncs)
	}
	if len(synced) != 1 {
		t.Fatalf("RouteSync ran for a rejected netview: %v", synced)
	}

	deliverNetview(cfg, netviewMessage{V: 1, Hub: "hub", Gen: "g2", Rev: 1})
	if syncs != 2 {
		t.Fatalf("MemberSync did not run for a new generation: %d", syncs)
	}
}

func TestNetviewRouterKeepsIPv6ToItsOwnFamily(t *testing.T) {
	// IPv4-first must not become IPv4-only-capturing: a v4 claim never
	// answers for an IPv6 destination, so one keeps whatever fate it has
	// today, and an IPv6 claim answers only its own family.
	r := NewNetviewRouter()
	r.Apply(netviewMessage{V: 1, Hub: "hub1", Rev: 1, Claims: []claimEntry{
		{Prefix: "0.0.0.0/0", Origin: "peerW"},
		{Prefix: "fd00:dead:beef::/64", Origin: "peerB"},
	}})

	rt := r.GetRoute(context.Background(), "10.1.2.3")
	if rt == nil {
		t.Fatal("the IPv4 claim must match an IPv4 destination")
	}
	if rt.Dst != "0.0.0.0/0" {
		t.Fatalf("an IPv4 destination must be answered by the IPv4 claim: got %+v", rt)
	}
	// Dst discriminates which claim answered: if the v4 /0 wrongly captured
	// IPv6 destinations, this would come back "0.0.0.0/0".
	rt = r.GetRoute(context.Background(), "fd00:dead:beef::9")
	if rt == nil {
		t.Fatal("the IPv6 claim must match an IPv6 destination")
	}
	if rt.Dst != "fd00:dead:beef::/64" {
		t.Fatalf("an IPv6 destination must be answered by the IPv6 claim, not the v4 /0: got %+v", rt)
	}
	if rt := r.GetRoute(context.Background(), "2001:db8::1"); rt != nil {
		t.Fatalf("an IPv6 destination outside every IPv6 claim must have no route: %+v", rt)
	}
}

func TestNetviewRouterGatewayIsTheHubMember(t *testing.T) {
	// On a spoke every approved LAN is behind the hub, so every route's next
	// hop is the hub's tun address — from the Members entry whose Key is the
	// hub's, not merely the first entry (peerZ is deliberately listed first).
	r := NewNetviewRouter()
	r.Apply(netviewMessage{V: 1, Hub: "hub1", Rev: 1,
		Members: []memberEntry{
			{Key: "peerZ", IP: "10.7.0.9"},
			{Key: "hub1", IP: "10.99.0.1"},
		},
		Claims: []claimEntry{{Prefix: "192.168.0.0/16", Origin: "peerW"}},
	})
	rt := r.GetRoute(context.Background(), "192.168.77.9")
	if rt == nil {
		t.Fatal("a claimed prefix must resolve")
	}
	if rt.Gateway != "10.99.0.1" {
		t.Fatalf("gateway must be the hub member's tun address (Members[Key==Hub].IP): got %+v", rt)
	}
}

func TestNetviewRouterGatewayDegradesToEmptyWithoutHubMember(t *testing.T) {
	// The hub not yet listing itself is the state until Task 6 publishes it:
	// routes still resolve, but the gateway stays empty — exactly the
	// spoke's behaviour today, where an unparseable gateway is no route.
	r := NewNetviewRouter()
	r.Apply(netviewMessage{V: 1, Hub: "hub1", Rev: 1,
		Members: []memberEntry{{Key: "peerZ", IP: "10.7.0.9"}},
		Claims:  []claimEntry{{Prefix: "192.168.0.0/16", Origin: "peerW"}},
	})
	rt := r.GetRoute(context.Background(), "192.168.77.9")
	if rt == nil {
		t.Fatal("a claimed prefix must resolve even before the hub publishes itself")
	}
	if rt.Gateway != "" {
		t.Fatalf("no hub member yet: gateway must stay empty rather than guess: got %+v", rt)
	}
}

// TestNetviewRouterPrefixes: the spoke's installed routes are an observability
// surface as much as a routing table — the API answers "what did the hub
// approve" from them — and a reader must not have to walk the table or read the
// claims out from under the router to answer. Sorted, because the answer is read
// by a human and by a diff, and the router's internal order is
// longest-prefix-first, which is a routing order and not a reading one.
func TestNetviewRouterPrefixes(t *testing.T) {
	// A router that never saw a netview reports nothing rather than an empty
	// slice of nothing: a spoke whose control channel has not opened has no
	// LAN routing, and the API must be able to say so.
	if got := NewNetviewRouter().Prefixes(); len(got) != 0 {
		t.Fatalf("an empty router reports %v, want no routes at all", got)
	}

	r := NewNetviewRouter()
	r.Apply(netviewMessage{V: 1, Hub: "hub1", Rev: 1, Claims: []claimEntry{
		{Prefix: "192.168.50.0/24", Origin: "peerB"},
		{Prefix: "192.168.0.0/16", Origin: "peerW"},
		{Prefix: "10.0.0.0/8", Origin: "peerX"},
	}})

	want := []string{"10.0.0.0/8", "192.168.0.0/16", "192.168.50.0/24"}
	if got := r.Prefixes(); !slices.Equal(got, want) {
		t.Fatalf("Prefixes() = %v, want the approved claims sorted: %v", got, want)
	}

	// The table is a whole-table write, so a netview that withdraws a claim
	// withdraws it here too: the answer is the live table, not an
	// accumulation of everything ever seen.
	r.Apply(netviewMessage{V: 1, Hub: "hub1", Rev: 2, Claims: []claimEntry{
		{Prefix: "192.168.50.0/24", Origin: "peerB"},
	}})
	if got := r.Prefixes(); !slices.Equal(got, []string{"192.168.50.0/24"}) {
		t.Fatalf("Prefixes() after a smaller netview = %v, want only the claim still installed", got)
	}
}

// TestKeepClaimFresh: a claim is live only while its owner re-asserts it, so a
// spoke that holds a LAN has to keep saying so. What it re-sends is the whole
// claim, not a heartbeat: a refresh that said nothing about what it holds would
// tell the hub the spoke exists and nothing about what it carries, and a spoke
// that claimed a second LAN between refreshes would lose the first.
func TestKeepClaimFresh(t *testing.T) {
	hub, spoke := net.Pipe()
	defer hub.Close()

	claims := []string{"192.168.50.0/24"}
	stop := make(chan struct{})
	done := make(chan struct{})
	// A short interval so the test does not take the 20s it takes in the
	// field: the mechanism is the whole of what is under test.
	go func() {
		defer close(done)
		keepClaimFresh(stop, hub, claims, true, testLogger(), 5*time.Millisecond)
	}()

	// The whole claim, more than once: every tick says the same thing, which
	// is the point — the hub re-reads a claim it already holds.
	for i := 0; i < 3; i++ {
		_, claim, err := readMessage(spoke)
		if err != nil {
			t.Fatalf("refresh %d: %v", i, err)
		}
		if claim.Type != ctrlTypeClaim || len(claim.Add) != 1 || claim.Add[0] != "192.168.50.0/24" {
			t.Fatalf("refresh %d re-asserted %+v, want the whole claim", i, claim)
		}
		if !claim.Direct {
			t.Fatalf("refresh %d dropped the direct capability: %+v", i, claim)
		}
	}

	// Ending the session stops the refreshes. A write already in flight is
	// unblocked by the conn closing — the same teardown the session itself does
	// — so the refresher exits instead of writing into a dead stream.
	close(stop)
	_ = hub.Close()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("the refresher outlived its session")
	}
}

// The control chain must dial a byte stream, not a datagram conn: the hub's
// demux (tunnel/p2p_host.go demuxControlStream) hands any net.PacketConn
// straight to the tun handler, so a udp-shaped control stream is delivered
// as a tun link, the WISP magic is never consumed, and the claim never
// reaches the controlHub - a silence with no other symptom. The marker is
// the only thing that says which one the p2p seam builds.
func TestControlChainDialAStream(t *testing.T) {
	cfg := controlChainConfig(ControlChannelConfig{HubPeer: "hubkey", Provider: "prov"})
	node := cfg.Hops[0].Nodes[0]

	if got := node.Metadata["p2p.network"]; got != "tcp" {
		t.Fatalf("p2p.network = %v, want \"tcp\": a control stream without the marker is a datagram conn the hub demuxes as a tun link, and the claim never arrives", got)
	}
	if got := node.Metadata["p2p"]; got != "prov" {
		t.Fatalf("p2p = %v, want prov", got)
	}
	if node.Dialer == nil || node.Dialer.Type != "udp" {
		t.Fatalf("dialer type = %v, want udp (the tun link's shape)", node.Dialer)
	}
	if node.Connector == nil || node.Connector.Type != "forward" {
		t.Fatalf("connector type = %v, want forward (the tun link's shape)", node.Connector)
	}
}

// The kernel, told what the hub approved: a netview the router accepts reaches
// the RouteSync with the router's prefixes, and a config without a sync (or a
// router) is simply told nothing. The sync is what installs the device's
// kernel routes, so a wiring silent here is a spoke that captures nothing the
// hub approved — the gap this whole change closes.
func TestDeliverNetviewSyncsTheKernel(t *testing.T) {
	r := NewNetviewRouter()
	var got []string
	cfg := ControlChannelConfig{Router: r, RouteSync: func(prefixes []string) { got = prefixes }}

	deliverNetview(cfg, netviewMessage{Type: ctrlTypeNetview, Hub: "hub", Rev: 1,
		Claims: []claimEntry{{Prefix: "192.168.50.0/24", Origin: "peerB"}}})

	want := []string{"192.168.50.0/24"}
	if !slices.Equal(got, want) {
		t.Fatalf("RouteSync prefixes = %v, want %v", got, want)
	}

	// A second netview that withdraws the prefix must reach the sync with the
	// empty set, so the kernel's routes are removed too.
	deliverNetview(cfg, netviewMessage{Type: ctrlTypeNetview, Hub: "hub", Rev: 2})
	if len(got) != 0 {
		t.Fatalf("RouteSync prefixes after the withdrawal = %v, want empty", got)
	}
}

func TestDeliverNetviewWithoutASyncOrRouter(t *testing.T) {
	// No panic and nothing to do for either of the two configurations a
	// process that never asked for LAN routing can be in.
	deliverNetview(ControlChannelConfig{}, netviewMessage{Type: ctrlTypeNetview, Hub: "hub", Rev: 1,
		Claims: []claimEntry{{Prefix: "192.168.50.0/24"}}})

	r := NewNetviewRouter()
	deliverNetview(ControlChannelConfig{Router: r}, netviewMessage{Type: ctrlTypeNetview, Hub: "hub", Rev: 1,
		Claims: []claimEntry{{Prefix: "192.168.50.0/24"}}})
	if got := r.Prefixes(); !slices.Equal(got, []string{"192.168.50.0/24"}) {
		t.Fatalf("router prefixes = %v, want the claim installed even without a sync", got)
	}
}
