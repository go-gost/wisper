package entrypoint

import (
	"context"
	"errors"
	"net"
	"testing"

	cfg "github.com/go-gost/wisper/config"
	tp "github.com/go-gost/wisper/tunnel"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	"github.com/go-gost/x/registry"
)

// tungoCleanup drops the names a tungo entrypoint's init registers, so one
// test's rules bypass and p2p provider cannot leak into the next test in this
// process.
func tungoCleanup(t *testing.T, id string) {
	t.Helper()
	t.Cleanup(func() {
		registry.BypassRegistry().Unregister("tungo-rules-" + id)
		registry.P2PRegistry().Unregister("tungo-ep-" + id)
	})
}

// TestTungoEntryPointServiceConfig pins the assembled config: a tungo listener
// over a tungo handler, a single-node chain whose node carries a relay request
// over the p2p link to the peer, and the rule list hanging off the hop as a
// whitelist bypass. It also pins the two absences the split depends on: no
// forwarder (a tun-shaped handler with one bypasses the chain) and no
// resolver/hosts (either one resolves the destination before the hop, which
// turns every domain rule into an IP that silently goes direct).
func TestTungoEntryPointServiceConfig(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	const id = "tungo-config"
	tungoCleanup(t, id)

	rules := []string{"example.com", "192.168.100.0/24"}
	ep := NewTungoEntryPoint(
		tp.IDOption(id),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.100.250/32"),
		tp.MTUOption(1300),
		tp.RoutesOption("0.0.0.0/0, ::/0"),
		tp.DNSOption("192.168.100.100"),
		tp.DeviceNameOption("tun9"),
		tp.RulesOption(rules...),
	)

	if got := ep.Type(); got != TungoEntryPoint {
		t.Fatalf("Type() = %q, want %q", got, TungoEntryPoint)
	}
	if got := ep.Endpoint(); got != testPeerKey {
		t.Fatalf("Endpoint() = %q, want the peer key", got)
	}
	if got := NewByType(TungoEntryPoint); got == nil || got.Type() != TungoEntryPoint {
		t.Fatalf("NewByType(%q) = %v, want a tungo entrypoint", TungoEntryPoint, got)
	}

	s := ep.(*tungoEntryPoint)
	if err := s.init(); err != nil {
		t.Fatalf("init: %v", err)
	}

	if len(s.config.Services) != 1 || len(s.config.Chains) != 1 {
		t.Fatalf("config has %d services and %d chains, want 1 and 1",
			len(s.config.Services), len(s.config.Chains))
	}

	svc := s.config.Services[0]
	if svc.Name != ep.Name() {
		t.Errorf("service name = %q, want the entrypoint name %q", svc.Name, ep.Name())
	}
	if svc.Addr != ":0" {
		t.Errorf("service addr = %q, want :0 (the device binds no socket)", svc.Addr)
	}
	if svc.Handler == nil || svc.Handler.Type != "tungo" {
		t.Fatalf("handler = %+v, want type tungo", svc.Handler)
	}
	if svc.Listener == nil || svc.Listener.Type != "tungo" {
		t.Fatalf("listener = %+v, want type tungo", svc.Listener)
	}
	if svc.Handler.Chain != svc.Name {
		t.Errorf("handler chain = %q, want the service's own chain %q", svc.Handler.Chain, svc.Name)
	}
	if svc.Bypass != "" || len(svc.Bypasses) != 0 {
		t.Errorf("service carries a bypass (%q/%v): a service-level hit drops the conn instead of dialling direct",
			svc.Bypass, svc.Bypasses)
	}
	if svc.Resolver != "" || svc.Hosts != "" {
		t.Errorf("service resolver/hosts = %q/%q: either one resolves the destination before the hop, so domain rules never match",
			svc.Resolver, svc.Hosts)
	}
	if svc.Forwarder != nil {
		t.Errorf("service has a forwarder: a tun-shaped handler forwards there instead of through the chain")
	}

	opts := ep.Options()
	md := svc.Listener.Metadata
	for key, want := range map[string]any{
		"name":   opts.DeviceName,
		"mtu":    opts.MTU,
		"net":    opts.Net,
		"routes": opts.Routes,
		"dns":    opts.DNS,
	} {
		if got := md[key]; got != want {
			t.Errorf("listener metadata %s = %v, want %v", key, got, want)
		}
	}

	if len(s.config.Chains) != 1 {
		t.Fatalf("config has %d chains, want 1", len(s.config.Chains))
	}
	chCfg := s.config.Chains[0]
	if chCfg.Name != svc.Name {
		t.Errorf("chain name = %q, want the service's chain %q", chCfg.Name, svc.Name)
	}
	if len(chCfg.Hops) != 1 || len(chCfg.Hops[0].Nodes) != 1 {
		t.Fatalf("chain has %d hops, want 1 hop with 1 node", len(chCfg.Hops))
	}

	rulesName := "tungo-rules-" + id
	hop := chCfg.Hops[0]
	if len(hop.Bypasses) != 1 || hop.Bypasses[0] != rulesName {
		t.Errorf("hop bypasses = %v, want [%s]", hop.Bypasses, rulesName)
	}
	if hop.Bypass != "" {
		t.Errorf("hop.Bypass = %q, want the plural form only", hop.Bypass)
	}

	node := hop.Nodes[0]
	if node.Addr != testPeerKey {
		t.Errorf("node addr = %q, want the peer key", node.Addr)
	}
	if node.Connector == nil || node.Connector.Type != "relay" {
		t.Errorf("node connector = %+v, want type relay", node.Connector)
	}
	if node.Dialer == nil || node.Dialer.Type != "tcp" {
		t.Errorf("node dialer = %+v, want type tcp", node.Dialer)
	}
	if got := node.Metadata["p2p"]; got != "tungo-ep-"+id {
		t.Errorf("node metadata p2p = %v, want tungo-ep-%s", got, id)
	}

	if len(s.config.Bypasses) != 1 {
		t.Fatalf("config has %d bypasses, want 1", len(s.config.Bypasses))
	}
	bp := s.config.Bypasses[0]
	if bp.Name != rulesName {
		t.Errorf("bypass name = %q, want %q", bp.Name, rulesName)
	}
	if !bp.Whitelist {
		t.Error("bypass whitelist = false: listed destinations must be the ones using the tunnel")
	}
	if len(bp.Matchers) != len(rules) {
		t.Fatalf("bypass matchers = %v, want the entrypoint's rules %v", bp.Matchers, rules)
	}
	for i, rule := range rules {
		if bp.Matchers[i] != rule {
			t.Errorf("bypass matcher %d = %q, want %q", i, bp.Matchers[i], rule)
		}
	}
	if !registry.BypassRegistry().IsRegistered(rulesName) {
		t.Errorf("%s is not registered: the hop resolves its bypasses from the registry, not from the config", rulesName)
	}

	// The registration is the entrypoint's to give back: a closed entrypoint
	// must not leave a rule set behind under a name its replacement reuses.
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if !s.IsClosed() {
		t.Error("IsClosed() = false after Close")
	}
	if registry.BypassRegistry().IsRegistered(rulesName) {
		t.Errorf("%s still registered after Close", rulesName)
	}
}

// TestTungoEntryPointRulesRouteUnlistedDirect is the split itself: with the
// generated config parsed into a real chain, a listed destination selects the
// relay node and an unlisted one selects nothing — which is the empty route
// that sends the flow down DefaultRoute.Dial, i.e. out of the phone's own
// network.
func TestTungoEntryPointRulesRouteUnlistedDirect(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	const id = "tungo-route"
	const provider = "tungo-ep-" + id
	tungoCleanup(t, id)

	// The chain node resolves metadata.p2p by name at parse time, so the
	// provider must exist before ParseChain — an entrypoint registers it before
	// parsing for the same reason. Nothing dials here, so a stub is enough.
	registry.P2PRegistry().Unregister(provider)
	if err := registry.P2PRegistry().Register(provider, stubTunnel{}); err != nil {
		t.Fatalf("register p2p provider: %v", err)
	}

	ep := NewTungoEntryPoint(
		tp.IDOption(id),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.100.250/32"),
		tp.RoutesOption("0.0.0.0/0"),
		tp.DNSOption("192.168.100.100"),
		tp.RulesOption("example.com", "192.168.100.0/24"),
	)
	s := ep.(*tungoEntryPoint)
	if err := s.init(); err != nil {
		t.Fatalf("init: %v", err)
	}

	ch, err := chain_parser.ParseChain(s.config.Chains[0], p2pLog())
	if err != nil {
		t.Fatalf("parse chain: %v", err)
	}

	ctx := context.Background()
	for _, tc := range []struct {
		name string
		addr string
		want int
	}{
		{"listed domain", "example.com:443", 1},
		{"listed cidr", "192.168.100.100:53", 1},
		{"unlisted address", "1.2.3.4:443", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			route := ch.Route(ctx, "tcp", tc.addr)
			if route == nil {
				t.Fatalf("Route(%q) = nil, want a route", tc.addr)
			}
			if got := len(route.Nodes()); got != tc.want {
				t.Fatalf("Route(%q) has %d nodes, want %d (0 = direct)", tc.addr, got, tc.want)
			}
		})
	}
}

// TestTungoEntryPointRequiresPeer: without a peer key there is no chain to
// build, so the assembly refuses instead of producing a node nothing can be
// dialled to — and leaves nothing registered behind.
func TestTungoEntryPointRequiresPeer(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	const id = "tungo-no-peer"
	tungoCleanup(t, id)

	ep := NewTungoEntryPoint(tp.IDOption(id))
	s := ep.(*tungoEntryPoint)

	if err := s.init(); err == nil {
		t.Fatal("init without a peer key = nil error, want a failure")
	}
	if s.config != nil {
		t.Error("a peerless init assembled a config")
	}
	if registry.BypassRegistry().IsRegistered("tungo-rules-" + id) {
		t.Error("a peerless init registered a rule bypass")
	}
}

// stubTunnel is a p2p provider that never opens a stream: the chain only has
// to parse and route, and a route assertion must not touch the network.
type stubTunnel struct{}

func (stubTunnel) Dial(context.Context, string, string) (net.Conn, error) {
	return nil, errors.New("stub p2p tunnel: no dial")
}

func (stubTunnel) Close() error { return nil }
