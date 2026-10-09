package tunnel

import (
	"context"
	"testing"

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

	// A claimed LAN: the route names the hub as the gateway, which is where
	// the spoke actually sends it.
	if rt := r.GetRoute(context.Background(), "192.168.50.9"); rt == nil {
		t.Fatal("a claimed prefix must resolve")
	}
	// Inside the /16 but outside the /24: the shorter claim still matches,
	// because the earlier task made the snapshot longest-first.
	if rt := r.GetRoute(context.Background(), "192.168.77.9"); rt == nil {
		t.Fatal("a /16 claim must match a destination no /24 covers")
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
	r.Apply(netviewMessage{V: 1, Hub: "hub2", Rev: 1, Claims: []claimEntry{{Prefix: "10.0.0.0/8", Origin: "peerX"}}})
	if rt := r.GetRoute(context.Background(), "10.1.2.3"); rt == nil {
		t.Fatal("a new hub id must be accepted at any rev")
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

	if rt := r.GetRoute(context.Background(), "10.1.2.3"); rt == nil {
		t.Fatal("the IPv4 claim must match an IPv4 destination")
	}
	if rt := r.GetRoute(context.Background(), "fd00:dead:beef::9"); rt == nil {
		t.Fatal("the IPv6 claim must match an IPv6 destination")
	}
	if rt := r.GetRoute(context.Background(), "2001:db8::1"); rt != nil {
		t.Fatalf("an IPv6 destination outside every IPv6 claim must have no route: %+v", rt)
	}
}
