//go:build p2ppoc

// The split's transport core, end to end over a real p2p link: the chain a
// tungo entrypoint assembles — a relay request on a p2p tcp stream, the hop's
// rule whitelist in front — carries TCP and relay-framed UDP to a relay
// service on the far side, and leaves an unlisted destination to a direct
// dial.
//
// The far side is a plain relay service with no chain, which is the shape the
// pi's relay listener has: the handler dials the address the request carries.
// It is also the evidence of where a flow went — each test counts the
// connections the service accepted, so a listed destination that somehow went
// direct fails, and an unlisted one that somehow reached the relay fails.
package tunnel_test

import (
	"context"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-gost/core/chain"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/listener"
	clogger "github.com/go-gost/core/logger"
	xchain "github.com/go-gost/x/chain"
	xconfig "github.com/go-gost/x/config"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	_ "github.com/go-gost/x/connector/relay" // the chain node's connector: one relay request per stream
	_ "github.com/go-gost/x/dialer/tcp"      // the chain node's dialer: the request rides a p2p tcp stream
	relayhandler "github.com/go-gost/x/handler/relay"
	tcplistener "github.com/go-gost/x/listener/tcp"
	mdx "github.com/go-gost/x/metadata"
	"github.com/go-gost/x/registry"
	xservice "github.com/go-gost/x/service"

	cfg "github.com/go-gost/wisper/config"
	wtunnel "github.com/go-gost/wisper/tunnel"
	wep "github.com/go-gost/wisper/tunnel/entrypoint"
)

// countingListener is a listener that counts the connections its service
// accepted: the service is the only place that tells "the flow went through
// the relay" from "the flow echoed some other way".
type countingListener struct {
	listener.Listener
	accepted atomic.Int64
}

func (l *countingListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err == nil {
		l.accepted.Add(1)
	}
	return conn, err
}

func (l *countingListener) count() int64 { return l.accepted.Load() }

// startRelayService starts the far side: a tcp listener under the relay
// handler and nothing else. No chain means the handler dials the address the
// relay request carries, which is the whole job of the pi's relay listener.
func startRelayService(t *testing.T) (string, *countingListener) {
	t.Helper()

	log := clogger.Default().WithFields(map[string]any{
		"kind":    "service",
		"service": "tungo-e2e-relay",
	})

	ln := tcplistener.NewListener(
		listener.AddrOption("127.0.0.1:0"),
		listener.LoggerOption(log),
	)
	if err := ln.Init(mdx.NewMetadata(nil)); err != nil {
		t.Fatalf("relay listener init: %v", err)
	}
	counting := &countingListener{Listener: ln}

	h := relayhandler.NewHandler(
		handler.RouterOption(xchain.NewRouter(chain.LoggerRouterOption(log))),
		handler.LoggerOption(log),
	)
	if err := h.Init(mdx.NewMetadata(nil)); err != nil {
		t.Fatalf("relay handler init: %v", err)
	}

	svc := xservice.NewService("tungo-e2e-relay", counting, h,
		xservice.LoggerOption(log),
	)
	go func() { _ = svc.Serve() }()
	t.Cleanup(func() { _ = svc.Close() })

	return ln.Addr().String(), counting
}

// startSplitLink wires one split and returns the router its flows are dialled
// through, plus the relay service they arrive at. listed is what the
// entrypoint's rules admit: a flow to it must take the p2p link, a flow to any
// other address must not.
//
// The chain comes from the entrypoint — ChainConfig assembles exactly what Run
// parses — because that wiring is what this test is about: a chain rebuilt here
// would prove the test's own copy carries traffic, not the product's.
func startSplitLink(t *testing.T, id, keyHex, listed string) (*xchain.Router, *countingListener) {
	t.Helper()

	// The hosts' keys resolve through os.UserConfigDir(); keep the test out of
	// the real ~/.config/wisper/p2p/.
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	derp := startDerper(t) // p2p_udp_poc_test.go (same package + tag)

	// Relay only: these derpers serve no STUN, so a punch could only stall.
	secure, direct := false, false
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{
		P2P: &cfg.P2PSettings{Derp: derp, Secure: &secure, Direct: &direct},
	}})

	relayAddr, relay := startRelayService(t)

	// The near side, the phone in production: the host the chain dials through.
	// The far side admits it by this key, so the tunnel routes its streams to
	// the relay service.
	phone := newDialingHost(t, derp, keyHex) // p2p_e2e_test.go (same package + tag)
	runTunnel(t, "tungo-e2e-"+id, relayAddr, phone.PublicKey())

	hubKey := wtunnel.P2PHostPublicKey()
	if hubKey == "" {
		t.Fatal("P2PHostPublicKey() = empty after Run, want the hub host's base64 key")
	}

	ep := wep.NewTungoEntryPoint(
		wtunnel.IDOption(id),
		wtunnel.PeerOption(hubKey),
		wtunnel.RulesOption(listed),
	)
	configer, ok := ep.(interface {
		ChainConfig() (*xconfig.ChainConfig, error)
	})
	if !ok {
		t.Fatalf("tungo entrypoint %T does not expose the chain it assembles", ep)
	}
	chainCfg, err := configer.ChainConfig()
	if err != nil {
		t.Fatalf("assemble the tungo chain: %v", err)
	}
	hop := chainCfg.Hops[0]
	// init registered the rules bypass under the names the hop carries, and Run
	// would own them. This test never Runs the entrypoint, so it takes them down
	// itself — before the assertions below, so a failed one cannot leave the
	// names behind for the next test.
	for _, name := range hop.Bypasses {
		t.Cleanup(func() { registry.BypassRegistry().Unregister(name) })
	}
	if len(hop.Bypasses) != 1 {
		t.Fatalf("chain hop bypasses = %v, want the one rules list the entrypoint registered", hop.Bypasses)
	}

	node := hop.Nodes[0]
	provider, _ := node.Metadata["p2p"].(string)
	if provider == "" {
		t.Fatalf("chain node metadata = %v, want the p2p provider it dials through", node.Metadata)
	}
	// Run registers the shared host under this name before it parses the chain;
	// here the near-side host plays that part.
	registerProvider(t, provider, phone)

	ch, err := chain_parser.ParseChain(chainCfg, clogger.Default())
	if err != nil {
		t.Fatalf("parse the tungo chain: %v", err)
	}

	router := xchain.NewRouter(
		chain.ChainRouterOption(ch),
		chain.LoggerRouterOption(clogger.Default()),
	)
	t.Cleanup(func() { _ = router.Close() })

	return router, relay
}

// TestTungoChainRelaysOverP2P: a listed tcp destination leaves through the
// relay node, which is the phone's only way to reach the hub's relay listener.
func TestTungoChainRelaysOverP2P(t *testing.T) {
	echo := startEchoServer(t) // p2p_poc_test.go (same package + tag)

	router, relay := startSplitLink(t, "tungo-e2e-tcp", strings.Repeat("b1", 32), echo)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	conn, err := router.Dial(ctx, "tcp", echo)
	if err != nil {
		t.Fatalf("dial %s through the tungo chain: %v", echo, err)
	}
	defer conn.Close()
	mustEcho(t, conn, []byte("hello-tungo-tcp")) // p2p_e2e_test.go

	if got := relay.count(); got < 1 {
		t.Errorf("relay service accepted %d connections, want the listed flow to have gone through it", got)
	}
}

// TestTungoChainRelaysUDPOverP2P: the same link carries a datagram. The relay
// protocol frames UDP on the one tcp stream (FUDP), so a udp dial needs no
// second transport — this is the only thing DNS-in-the-tunnel depends on. The
// backend echoes what it gets, the shape of a resolver.
func TestTungoChainRelaysUDPOverP2P(t *testing.T) {
	echo := startUDPEcho(t, 0) // p2p_udp_poc_test.go (same package + tag)

	router, relay := startSplitLink(t, "tungo-e2e-udp", strings.Repeat("b2", 32), echo)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	conn, err := router.Dial(ctx, "udp", echo)
	if err != nil {
		t.Fatalf("dial %s through the tungo chain: %v", echo, err)
	}
	defer conn.Close()

	msg := []byte("tungo-udp-question")
	if _, err := conn.Write(msg); err != nil {
		t.Fatalf("write datagram: %v", err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(15 * time.Second)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, len(msg))
	n, err := conn.Read(buf)
	if err != nil {
		t.Fatalf("read the datagram back: %v", err)
	}
	if string(buf[:n]) != string(msg) {
		t.Fatalf("datagram = %q, want %q", buf[:n], msg)
	}

	if got := relay.count(); got < 1 {
		t.Errorf("relay service accepted %d connections, want the listed datagram to have gone through it", got)
	}
}

// TestTungoChainUnlistedGoesDirect: the rules admit only example.com, so the
// hop selects no node, the route is empty, and the dial leaves from this
// process — the phone's own network in production. The relay must see nothing:
// a flow that both dialled direct and reached the relay would still echo.
func TestTungoChainUnlistedGoesDirect(t *testing.T) {
	echo := startEchoServer(t)

	router, relay := startSplitLink(t, "tungo-e2e-direct", strings.Repeat("b3", 32), "example.com")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	conn, err := router.Dial(ctx, "tcp", echo)
	if err != nil {
		t.Fatalf("dial %s directly: %v", echo, err)
	}
	defer conn.Close()
	mustEcho(t, conn, []byte("hello-tungo-direct"))

	if got := relay.count(); got != 0 {
		t.Errorf("relay service accepted %d connections, want an unlisted destination to stay off the tunnel", got)
	}
}
