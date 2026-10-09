package tunnel

import (
	"context"
	"net"
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
		keepClaimFresh(stop, hub, claims, testLogger(), 5*time.Millisecond)
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
