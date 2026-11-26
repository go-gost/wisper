package entrypoint

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-gost/core/bypass"
	"github.com/go-gost/core/listener"
	"github.com/go-gost/core/metadata"
	"github.com/go-gost/core/observer/stats"
	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
	tp "github.com/go-gost/wisper/tunnel"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	xlistener "github.com/go-gost/x/listener/tcp"
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

// tungoRunConfig gives a starting entrypoint a config directory and the p2p
// setting the shared host needs to start: an unreachable derp URL, because a
// failed relay is not a failed start. The URL is deliberately not the p2p tests'
// one — the shared host outlives its last reference by a grace period, and a test
// that starts a host with the same settings would be handed this one, with this
// test's identity file and config directory. The previous config is put back
// afterwards for the same reason.
func tungoRunConfig(t *testing.T) {
	t.Helper()
	prev := cfg.Get()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{
		P2P: &cfg.P2PSettings{Derp: "wss://127.0.0.1:1/derp-tungo"},
	}})
	t.Cleanup(func() { cfg.Set(prev) })
}

// useSharedDevice turns on the app-device behavior for the duration of a test:
// the single VpnService device, claimed by the entrypoint running on it and
// reaching the listener as an fd. On a desktop the device is this process's own,
// so neither applies.
func useSharedDevice(t *testing.T) {
	t.Helper()
	orig := sharedDevice
	sharedDevice = true
	t.Cleanup(func() { sharedDevice = orig })
}

// useDeviceListener swaps the service's device listener for the duration of a
// test: a real one builds a tun interface, which a test machine either cannot do
// or should not do to the host it runs on.
func useDeviceListener(t *testing.T, build func(...listener.Option) listener.Listener) {
	t.Helper()
	orig := newDeviceListener
	newDeviceListener = build
	t.Cleanup(func() { newDeviceListener = orig })
}

// loopbackDeviceListener stands in for the device with the cheapest thing that
// serves: a loopback socket. It also pins what the device listener must be
// given — the run's counters. This side has exactly one writer of them: x
// counts handler errors on the service and nothing else, so the listener is
// where a device's connections and bytes are counted, as tun.go and p2p.go do.
func loopbackDeviceListener(t *testing.T) func(...listener.Option) listener.Listener {
	return func(opts ...listener.Option) listener.Listener {
		var o listener.Options
		for _, opt := range opts {
			opt(&o)
		}
		if o.Stats == nil {
			t.Error("the device listener carries no stats: it is this side's only writer of the conn and byte counters")
		}
		if o.Addr != ":0" {
			t.Errorf("device listener addr = %q, want :0 (a tungo listener binds no socket)", o.Addr)
		}
		return xlistener.NewListener(
			listener.AddrOption("127.0.0.1:0"),
			listener.LoggerOption(o.Logger),
		)
	}
}

// failingDeviceListener is the device step that cannot complete: Init reports
// what a real one would (an fd that never arrived, a missing privilege) before
// anything is served.
type failingDeviceListener struct {
	err error
}

func (l *failingDeviceListener) Init(metadata.Metadata) error { return l.err }
func (l *failingDeviceListener) Accept() (net.Conn, error)    { return nil, l.err }
func (l *failingDeviceListener) Addr() net.Addr               { return &net.TCPAddr{} }
func (l *failingDeviceListener) Close() error                 { return nil }

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
	// Domain rules can match only if the handler reads the HTTP Host or TLS
	// server name before routing; unknown protocols fall back to the IP.
	if got := svc.Handler.Metadata["sniffing"]; got != true {
		t.Errorf("handler metadata sniffing = %v, want true", got)
	}
	if got := svc.Handler.Metadata["sniffing.timeout"]; got != time.Second {
		t.Errorf("handler metadata sniffing.timeout = %v, want %v", got, time.Second)
	}
	if got := svc.Handler.Metadata["sniffing.fallback"]; got != true {
		t.Errorf("handler metadata sniffing.fallback = %v, want true", got)
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

	// The fd provider is Android's, where the device belongs to the app: a
	// desktop tun is created by the listener and has nothing handed over.
	if got, ok := md["fd"]; ok {
		t.Errorf("listener metadata carries fd = %v on a desktop device, want none", got)
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
	// The split swaps ChainConfig's tunnel connector for the relay one; the keys
	// that connector described still belong to this node, and dropping them with
	// the connector was what a wholesale metadata replacement did.
	if got := node.Metadata["tunnel.id"]; got != id {
		t.Errorf("node metadata tunnel.id = %v, want %s: the split's node still belongs to this tunnel", got, id)
	}
	if got, ok := node.Metadata["record.mode"]; !ok || got == "" {
		t.Errorf("node metadata record.mode = %v (present %t), want the record mode ChainConfig set", got, ok)
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

// TestTungoEntryPointSniffingIsTungoOnly keeps the domain-splitting behavior
// scoped to the userspace stack; the ordinary tun handler forwards packets.
func TestTungoEntryPointSniffingIsTungoOnly(t *testing.T) {
	ep := NewTunEntryPoint(
		tp.IDOption("tun-no-sniffing"),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.0.2/24"),
	)
	s := ep.(*tunEntryPoint)
	if err := s.init(); err != nil {
		t.Fatalf("init: %v", err)
	}

	if got, ok := s.config.Services[0].Handler.Metadata["sniffing"]; ok {
		t.Errorf("tun handler metadata carries sniffing (%v): domain splitting is tungo-only", got)
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

// TestTungoEntryPointRepeatInitReRegistersRules: init() runs again when the
// config is reloaded or the rules are edited, so a second pass must replace
// both the registry entry and the object the entrypoint keeps: a stale object
// would keep matching the old rule list after the new one was saved, and the
// hop resolves its bypass from the registry by name, so the name also has to
// point at the fresh rules.
func TestTungoEntryPointRepeatInitReRegistersRules(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	const id = "tungo-reinit"
	const rulesName = "tungo-rules-" + id
	const oldRule, newRule = "old.example", "new.example"
	tungoCleanup(t, id)

	ep := NewTungoEntryPoint(
		tp.IDOption(id),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.100.250/32"),
		tp.RoutesOption("0.0.0.0/0"),
		tp.DNSOption("192.168.100.100"),
		tp.RulesOption(oldRule),
	)
	s := ep.(*tungoEntryPoint)

	if err := s.init(); err != nil {
		t.Fatalf("first init: %v", err)
	}
	if s.rules == nil {
		t.Fatal("the first init left no rules object on the entrypoint")
	}
	first := s.rules
	if first.Contains(context.Background(), "tcp", oldRule+":443") {
		t.Fatalf("the first init's rules do not list %s", oldRule)
	}

	// An edit replaces the rule list in place (SetRules at runtime, a reload
	// here); the entrypoint must end up holding the object of the latest init.
	newRules := []string{newRule}
	s.mu.Lock()
	s.opts.Rules = newRules
	s.mu.Unlock()

	if err := s.init(); err != nil {
		t.Fatalf("second init: %v", err)
	}
	if s.rules == nil {
		t.Fatal("the second init left no rules object on the entrypoint")
	}
	if s.rules == first {
		t.Error("the second init kept the first init's rules object")
	}

	ctx := context.Background()
	registered := registry.BypassRegistry().GetAll()[rulesName]
	if registered == nil {
		t.Fatalf("%s is not registered after the second init", rulesName)
	}
	if registered != s.rules {
		t.Error("the entrypoint holds a rules object that is not the one registered")
	}
	if !registered.Contains(ctx, "tcp", oldRule+":443") {
		t.Errorf("registered rules still match the old rule %s: they should match nothing but the new list", oldRule)
	}
	if registered.Contains(ctx, "tcp", newRule+":443") {
		t.Errorf("registered rules do not match the new rule %s", newRule)
	}
	if len(s.config.Bypasses) != 1 || len(s.config.Bypasses[0].Matchers) != 1 ||
		s.config.Bypasses[0].Matchers[0] != newRule {
		t.Errorf("config matchers = %v, want [%s]", s.config.Bypasses, newRule)
	}

	// The config describes the rules; it does not alias the caller's slice, so
	// an in-place edit after init cannot silently rewrite the description.
	newRules[0] = "edited.example"
	if got := s.config.Bypasses[0].Matchers[0]; got != newRule {
		t.Errorf("config matcher follows the caller's slice (%q, want %q)", got, newRule)
	}
	if s.rules.Contains(ctx, "tcp", newRule+":443") {
		t.Errorf("the registered rules follow the caller's slice: %s no longer matches", newRule)
	}
}

// TestTungoEntryPointRequiresPeer: without a peer key there is no chain to
// build, so the start refuses instead of producing a node nothing can be
// dialled to — before the shared host, the registry or the device are touched —
// and the refusal is the entrypoint's reported state, not only a return value:
// an API start has already answered by the time it fails.
func TestTungoEntryPointRequiresPeer(t *testing.T) {
	tungoRunConfig(t)

	const id = "tungo-no-peer"
	tungoCleanup(t, id)

	ep := NewTungoEntryPoint(tp.IDOption(id))
	s := ep.(*tungoEntryPoint)

	err := s.Run()
	if err == nil {
		t.Fatal("Run without a peer key = nil error, want a failure")
	}
	if !strings.Contains(err.Error(), "peer") {
		t.Errorf("Run error = %q, want it to say the peer key is missing", err)
	}
	if s.config != nil {
		t.Error("a peerless Run assembled a config")
	}
	if registry.BypassRegistry().IsRegistered("tungo-rules-" + id) {
		t.Error("a peerless Run registered a rule bypass")
	}
	if tp.P2PHostRunning() {
		t.Error("a peerless Run started the shared host")
	}
	if got := s.Err(); got == nil || !strings.Contains(got.Error(), "peer") {
		t.Errorf("Err() = %v, want the start failure: the list reads this field", got)
	}
	if evs := event.List(id); len(evs) == 0 || evs[len(evs)-1].Level != event.LevelError {
		t.Errorf("events = %+v, want a trailing error event", evs)
	}
	_ = ep.Close()
}

// TestTungoEntryPointAndroidAsksForTheDeviceFD: on Android the device is the
// app's VpnService one, created on the Java side, so the listener is given a
// provider that asks for a descriptor when it builds a device rather than a
// value captured at start: a rebuilt VPN or a restarted entrypoint must get a
// live fd, and a start that races the app's establish has to wait for it.
func TestTungoEntryPointAndroidAsksForTheDeviceFD(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	const id = "tungo-fd"
	tungoCleanup(t, id)
	useSharedDevice(t)

	ep := NewTungoEntryPoint(
		tp.IDOption(id),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.100.250/32"),
	)
	s := ep.(*tungoEntryPoint)
	if err := s.init(); err != nil {
		t.Fatalf("init: %v", err)
	}

	fd, ok := s.config.Services[0].Listener.Metadata["fd"].(func() int)
	if !ok || fd == nil {
		t.Fatalf("listener metadata fd = %T, want a func() int the listener calls per device",
			s.config.Services[0].Listener.Metadata["fd"])
	}
	_ = ep.Close()
}

// TestTungoEntryPointClaimsDevice: on Android the app's single VPN device is
// claimed by the entrypoint that runs on it, under its own ID and name; a
// second entrypoint is refused with the holder's name and cannot take the claim
// from under the running one; and Close gives the device back so the next start
// can have it.
func TestTungoEntryPointClaimsDevice(t *testing.T) {
	tungoRunConfig(t)
	useSharedDevice(t)
	useDeviceListener(t, loopbackDeviceListener(t))

	const (
		id      = "tungo-device"
		name    = "phone"
		otherID = "tungo-device-second"
	)
	tungoCleanup(t, id)
	tungoCleanup(t, otherID)

	newEntryPoint := func(id, name string) EntryPoint {
		ep := NewTungoEntryPoint(
			tp.IDOption(id),
			tp.NameOption(name),
			tp.PeerOption(testPeerKey),
			tp.NetOption("10.10.100.250/32"),
			tp.RoutesOption("0.0.0.0/0"),
			tp.DNSOption("192.168.100.100"),
			tp.RulesOption("example.com"),
		)
		// Close is idempotent, so a failure halfway through the test does not
		// leave the device claimed or a reference on the shared host.
		t.Cleanup(func() { _ = ep.Close() })
		return ep
	}

	// Claimed while it runs, and only by the entrypoint running on it.
	ep := newEntryPoint(id, name)
	if err := ep.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if ownerID, ownerName := tp.TunDeviceOwner(); ownerID != id || ownerName != name {
		t.Fatalf("device owner = (%q, %q), want (%q, %q)", ownerID, ownerName, id, name)
	}

	// The API refuses this up front; this is the backstop, and it has to say
	// who holds the device so the operator can stop it.
	other := newEntryPoint(otherID, "second")
	err := other.Run()
	if err == nil {
		t.Fatal("a second entrypoint started on the claimed device")
	}
	if !strings.Contains(err.Error(), name) {
		t.Errorf("Run error = %q, want the holder's name %q", err, name)
	}
	if ownerID, _ := tp.TunDeviceOwner(); ownerID != id {
		t.Errorf("a refused start left the device with %q, want the holder %q", ownerID, id)
	}

	// Close is what frees the device: a claim that outlived the run would
	// refuse every later start of it, for good.
	if err := ep.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if ownerID, ownerName := tp.TunDeviceOwner(); ownerID != "" || ownerName != "" {
		t.Fatalf("Close kept the device claimed by (%q, %q)", ownerID, ownerName)
	}

	if err := other.Run(); err != nil {
		t.Fatalf("Run after the holder closed: %v", err)
	}
	if ownerID, _ := tp.TunDeviceOwner(); ownerID != otherID {
		t.Errorf("device owner = %q, want the entrypoint that started after the release", ownerID)
	}
	if err := other.Close(); err != nil {
		t.Fatalf("Close the second: %v", err)
	}
}

// TestTungoEntryPointRunFailureReleasesDevice: a start that dies after taking
// the device has to give it back on every failure path — the next start of the
// device is otherwise refused forever — and it has to be visible in the state
// the list shows.
func TestTungoEntryPointRunFailureReleasesDevice(t *testing.T) {
	tungoRunConfig(t)
	useSharedDevice(t)

	const id = "tungo-run-fail"
	const provider = "tungo-ep-" + id
	tungoCleanup(t, id)

	ep := NewTungoEntryPoint(
		tp.IDOption(id),
		tp.NameOption("phone"),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.100.250/32"),
		tp.RoutesOption("0.0.0.0/0"),
		tp.DNSOption("192.168.100.100"),
		tp.RulesOption("example.com"),
	)
	s := ep.(*tungoEntryPoint)
	t.Cleanup(func() { _ = ep.Close() })

	// The device step fails after the claim: no VpnService fd arrived, a
	// privilege is missing. Nothing else about the start is fake.
	deviceErr := errors.New("tungo: no device fd: is the host's VPN up?")
	useDeviceListener(t, func(...listener.Option) listener.Listener {
		return &failingDeviceListener{err: deviceErr}
	})

	err := s.Run()
	if err == nil {
		t.Fatal("Run with a device that cannot be built = nil error, want a failure")
	}
	if !errors.Is(err, deviceErr) {
		t.Errorf("Run error = %v, want the device failure", err)
	}

	// The claim above all: a start that dropped its object without releasing it
	// would hold the device until the process ends.
	if ownerID, ownerName := tp.TunDeviceOwner(); ownerID != "" || ownerName != "" {
		t.Fatalf("a failed Run kept the device claimed by (%q, %q)", ownerID, ownerName)
	}
	if registry.P2PRegistry().IsRegistered(provider) {
		t.Error("a failed Run kept its p2p provider registered")
	}
	if tp.P2PHostRunning() {
		t.Error("a failed Run kept its reference on the shared host")
	}

	// Visible failure: the field the list reads, and an event for the history.
	if got := s.Err(); !errors.Is(got, deviceErr) {
		t.Errorf("Err() = %v, want the start failure", got)
	}
	if evs := event.List(id); len(evs) == 0 || evs[len(evs)-1].Level != event.LevelError {
		t.Errorf("events = %+v, want a trailing error event", evs)
	}

	// The release is what this test is about: the same entrypoint can take the
	// device again instead of being refused as its own holder.
	useDeviceListener(t, loopbackDeviceListener(t))
	if err := s.Run(); err != nil {
		t.Fatalf("Run after the failed start: %v", err)
	}
	if ownerID, _ := tp.TunDeviceOwner(); ownerID != id {
		t.Errorf("device owner = %q, want this entrypoint %q", ownerID, id)
	}
}

// TestTungoEntryPointCloseReleasesProvider: Close is the whole teardown — the
// service, the provider name and the shared host reference, the device and the
// rules — and it is idempotent, so a handler that closes a replaced entrypoint
// twice cannot take a successor's host down with the name.
func TestTungoEntryPointCloseReleasesProvider(t *testing.T) {
	tungoRunConfig(t)
	useSharedDevice(t)
	// The device listener counts into the object the service reports — the same
	// one, not a second set of counters nobody reads.
	deviceListener := loopbackDeviceListener(t)
	var listenerStats stats.Stats
	useDeviceListener(t, func(opts ...listener.Option) listener.Listener {
		ln := deviceListener(opts...)
		var o listener.Options
		for _, opt := range opts {
			opt(&o)
		}
		listenerStats = o.Stats
		return ln
	})

	const id = "tungo-close"
	const provider = "tungo-ep-" + id
	const rulesName = "tungo-rules-" + id
	tungoCleanup(t, id)

	ep := NewTungoEntryPoint(
		tp.IDOption(id),
		tp.NameOption("phone"),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.100.250/32"),
		tp.RoutesOption("0.0.0.0/0"),
		tp.DNSOption("192.168.100.100"),
		tp.RulesOption("example.com"),
	)
	s := ep.(*tungoEntryPoint)
	t.Cleanup(func() { _ = ep.Close() })

	if err := ep.Run(); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !registry.P2PRegistry().IsRegistered(provider) {
		t.Fatal("provider not registered after Run")
	}
	if !tp.P2PHostRunning() {
		t.Fatal("the shared host is not running after Run")
	}
	// The counters live on the device listener, so a running entrypoint has a
	// status — which is where the stats task reads them — and it reports the
	// counters the listener is writing.
	st := s.Status()
	if st == nil || st.Stats() == nil {
		t.Fatalf("Status() = %v, want the running service's status with its counters", st)
	}
	if st.Stats() != listenerStats {
		t.Error("the device listener counts into a different object than the service reports")
	}

	if err := ep.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := ep.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
	if registry.P2PRegistry().IsRegistered(provider) {
		t.Error("provider still registered after Close")
	}
	if tp.P2PHostRunning() {
		t.Error("shared host still running after the last reference went away")
	}
	if ownerID, _ := tp.TunDeviceOwner(); ownerID != "" {
		t.Errorf("Close kept the device claimed by %q", ownerID)
	}
	if registry.BypassRegistry().IsRegistered(rulesName) {
		t.Errorf("%s still registered after Close", rulesName)
	}
	if st := s.Status(); st != nil {
		t.Errorf("Status() = %v after Close, want nil", st)
	}
}

// TestTungoEntryPointCloseDuringInitLeavesNoRules: init() registers the rules
// entry before it hands the object to the entrypoint, so a Close landing in that
// window snapshots no rules — and closeOnce means it never looks again. The init
// has to give its own registration back, or the rules outlive the entrypoint
// under a name its replacement reuses. A closed entrypoint entering init leaves
// exactly that state, so the window is testable without racing goroutines.
func TestTungoEntryPointCloseDuringInitLeavesNoRules(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	const id = "tungo-close-init"
	const rulesName = "tungo-rules-" + id
	tungoCleanup(t, id)

	ep := NewTungoEntryPoint(
		tp.IDOption(id),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.100.250/32"),
		tp.RulesOption("example.com"),
	)
	s := ep.(*tungoEntryPoint)

	// Close's one pass is already behind it: whatever init writes from here on
	// is nobody's to clean up but init's own.
	if err := ep.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	err := s.init()
	if !errors.Is(err, ErrEntryPointClosed) {
		t.Fatalf("init after Close = %v, want %v", err, ErrEntryPointClosed)
	}
	if registry.BypassRegistry().IsRegistered(rulesName) {
		t.Errorf("%s outlived the entrypoint: a Close during init left the entry registered", rulesName)
	}
	if s.rules != nil {
		t.Errorf("init kept a rules object (%v) after giving its registration back", s.rules)
	}
}

// TestTungoStaleCloseKeepsSuccessorRules: a replacement carries the same ID, so
// the rules name is shared. A Close that arrives after the successor registered
// its own object must leave that registration alone — the hop resolves its
// bypass by name, so unregistering here would take the running split away.
func TestTungoStaleCloseKeepsSuccessorRules(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	const id = "tungo-stale-close"
	const rulesName = "tungo-rules-" + id
	tungoCleanup(t, id)

	newEntryPoint := func() *tungoEntryPoint {
		ep := NewTungoEntryPoint(
			tp.IDOption(id),
			tp.PeerOption(testPeerKey),
			tp.NetOption("10.10.100.250/32"),
			tp.RulesOption("example.com"),
		)
		s := ep.(*tungoEntryPoint)
		if err := s.init(); err != nil {
			t.Fatalf("init: %v", err)
		}
		return s
	}

	old := newEntryPoint()
	next := newEntryPoint()

	if err := old.Close(); err != nil {
		t.Fatalf("Close the replaced entrypoint: %v", err)
	}
	// The registry's own map, not Get: Get hands out a delegating wrapper whose
	// Contains would keep working either way, so only the stored object shows
	// which rules the name holds.
	if got := registry.BypassRegistry().GetAll()[rulesName]; got == nil {
		t.Fatal("a stale Close unregistered the successor's rules")
	} else if got != bypass.Bypass(next.rules) {
		t.Error("the registry no longer holds the successor's rules")
	}
	_ = next.Close()
}

// TestTungoSetRulesWhileInitKeepsTheEdit: a rule edit and init() both write the
// rule object and the options it is built from. If they are two separate
// critical sections, an edit landing between them is overwritten by init's own
// snapshot — the split reverts to the old list until the next restart, with
// nothing to say so, and the API's answer already said the edit was applied.
// Either order has to end with the edit in force: the list a running split uses
// is the last one saved.
func TestTungoSetRulesWhileInitKeepsTheEdit(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	const id = "tungo-set-rules-init"
	const rulesName = "tungo-rules-" + id
	const newRule = "new.example"
	tungoCleanup(t, id)

	// A long starting list widens the window an edit has to land in: building a
	// bypass for it is what the two-section version would do between its snapshot
	// and its assignment, with the edit free to land in the middle.
	oldRules := make([]string, 2000)
	for i := range oldRules {
		oldRules[i] = fmt.Sprintf("old%d.example", i)
	}
	oldRule := oldRules[0]

	// One round only has a small window to hit, so many are tried: no ordering
	// may lose the edit, and a round that does is a round this fails.
	for round := 0; round < 20; round++ {
		ep := NewTungoEntryPoint(
			tp.IDOption(id),
			tp.PeerOption(testPeerKey),
			tp.NetOption("10.10.100.250/32"),
			tp.RulesOption(oldRules...),
		)
		s := ep.(*tungoEntryPoint)

		var wg sync.WaitGroup
		errCh := make(chan error, 1)
		wg.Add(2)
		go func() {
			defer wg.Done()
			errCh <- s.init()
		}()
		// The edit is given a head start of a few microseconds: init only holds
		// the window for the time it takes to build a rule set for the long list
		// above, so a simultaneous start would usually have the edit done before
		// init even reads the old list — which is the easy case. Both orders are
		// valid, and this one is the one that used to lose the edit.
		time.Sleep(20 * time.Microsecond)
		go func() {
			defer wg.Done()
			s.SetRules([]string{newRule})
		}()
		wg.Wait()
		if err := <-errCh; err != nil {
			t.Fatalf("round %d: init: %v", round, err)
		}

		if got := s.Options().Rules; !slices.Equal(got, []string{newRule}) {
			t.Fatalf("round %d: options after the edit = %v, want [%s] — the edit was lost", round, got, newRule)
		}
		registered := registry.BypassRegistry().GetAll()[rulesName]
		if registered == nil {
			t.Fatalf("round %d: %s is not registered after init", round, rulesName)
		}
		if registered != bypass.Bypass(s.rules) {
			t.Fatalf("round %d: the entrypoint holds a rules object that is not the one registered", round)
		}
		ctx := context.Background()
		if registered.Contains(ctx, "tcp", newRule+":443") {
			t.Fatalf("round %d: the running split does not tunnel the edited rule %s", round, newRule)
		}
		if !registered.Contains(ctx, "tcp", oldRule+":443") {
			t.Fatalf("round %d: the running split still tunnels the replaced rule %s", round, oldRule)
		}
		if len(s.config.Bypasses) != 1 || !slices.Equal(s.config.Bypasses[0].Matchers, []string{newRule}) {
			t.Fatalf("round %d: config matchers = %v, want [%s] — the description of the split follows the edit",
				round, s.config.Bypasses, newRule)
		}
	}
}

// TestTungoRulesRoundTrip: the rule list is part of the entrypoint's saved
// configuration, so a restart — or a reload after the process was down — reads
// it back. A field that survives only in memory comes back empty, which is a
// split that sends every flow direct and reports nothing wrong.
func TestTungoRulesRoundTrip(t *testing.T) {
	t.Chdir(t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})

	const id = "tungo-rules-roundtrip"
	tungoCleanup(t, id)
	for i := Count() - 1; i >= 0; i-- {
		Delete(GetIndex(i).ID())
	}
	t.Cleanup(func() {
		for i := Count() - 1; i >= 0; i-- {
			Delete(GetIndex(i).ID())
		}
	})

	rules := []string{"example.com", "home.pi", "192.168.100.0/24"}
	ep := NewTungoEntryPoint(
		tp.IDOption(id),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.100.250/32"),
		tp.RulesOption(rules...),
	)
	Add(ep)
	if err := ep.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	if err := SaveConfig(); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	saved := cfg.Get().EntryPoints
	if len(saved) != 1 {
		t.Fatalf("saved %d entrypoints, want 1", len(saved))
	}
	if !slices.Equal(saved[0].Rules, rules) {
		t.Fatalf("persisted Rules = %v, want %v", saved[0].Rules, rules)
	}
	raw, err := os.ReadFile("wisper.yaml")
	if err != nil {
		t.Fatalf("read back the config: %v", err)
	}
	if !bytes.Contains(raw, []byte("rules:")) {
		t.Fatalf("wisper.yaml carries no rules key:\n%s", raw)
	}

	// Load it the way a restart does. The saved entrypoint is stopped, so the
	// load rebuilds the object without starting a device.
	Delete(id)
	LoadConfig()
	loaded := Get(id)
	if loaded == nil {
		t.Fatal("LoadConfig restored no entrypoint")
	}
	if !slices.Equal(loaded.Options().Rules, rules) {
		t.Fatalf("loaded Rules = %v, want %v", loaded.Options().Rules, rules)
	}
}

// stubTunnel is a p2p provider that never opens a stream: the chain only has
// to parse and route, and a route assertion must not touch the network.
type stubTunnel struct{}

func (stubTunnel) Dial(context.Context, string, string) (net.Conn, error) {
	return nil, errors.New("stub p2p tunnel: no dial")
}

func (stubTunnel) Close() error { return nil }
