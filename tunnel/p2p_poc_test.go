//go:build p2ppoc

// Command p2p_poc is an opt-in proof of concept for running a wisper-style
// chain over the p2p transport instead of the gost.run relay.
//
// It is excluded from normal builds by the `p2ppoc` build tag. Run it with:
//
//	go test -tags p2ppoc -run TestP2PChainCarriesTCP -v ./tunnel/
//
// The test is self-contained on loopback: it runs the p2p host in process
// (stub mode: the peer is a plain host:port, no DERP needed) plus a raw TCP
// echo server, then builds the chain exactly the way wisper does
// (tunnel.ChainConfig) and swaps the node transport for p2p.
//
// Integration shape under test: the p2p host is imported as a library and its
// in-process Tunnel is registered directly into x's registry. There is no
// subprocess, no loopback gRPC control plane, and no token — the same
// x/p2p.Tunnel seam the gRPC plugin would have plugged into.
package tunnel_test

import (
	"context"
	"io"
	"net"
	"testing"
	"time"

	clogger "github.com/go-gost/core/logger"
	"github.com/go-gost/p2p"
	"github.com/go-gost/p2p/endpoint"
	xconfig "github.com/go-gost/x/config"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	_ "github.com/go-gost/x/connector/forward" // register the transparent connector
	_ "github.com/go-gost/x/dialer/tcp"        // register the plain TCP dialer
	xlogger "github.com/go-gost/x/logger"
	xp2p "github.com/go-gost/x/p2p"
	"github.com/go-gost/x/registry"

	wtunnel "github.com/go-gost/wisper/tunnel"
)

const p2pProviderName = "p2p-poc"

// ParseChain dereferences the logger it is handed, and wisper hands it
// clogger.Default(); set a real default so the test mirrors wisper's startup.
// This is a chain-parsing requirement, not a p2p one: the in-process Tunnel
// needs no global logger, unlike the gRPC plugin whose constructor called
// logger.Default().WithFields and panicked on a nil default.
func init() {
	clogger.SetDefault(xlogger.NewLogger(xlogger.LevelOption(clogger.DebugLevel)))
}

// The chain parser looks providers up through this interface; asserting the
// library's Tunnel against it here fails the build, not a runtime dial, if
// the two ever drift.
var _ xp2p.Tunnel = (*endpoint.Endpoint)(nil)

// p2pChainConfig builds a wisper ChainConfig whose single node is transported
// over the named p2p provider, with the peer at addr.
func p2pChainConfig(addr, provider string) *xconfig.ChainConfig {
	chCfg := wtunnel.ChainConfig("poc-id", "poc-chain", "off")
	node := chCfg.Hops[0].Nodes[0]
	node.Addr = addr
	node.Connector = &xconfig.ConnectorConfig{Type: "forward"}
	node.Dialer = &xconfig.DialerConfig{Type: "tcp"}
	node.Metadata = map[string]any{"p2p": provider} // <-- the seam
	return chCfg
}

// TestP2PUnregisteredFailsClosed guards the highest-risk failure mode: a
// metadata.p2p typo must error at parse time, never fall back to a direct
// dial that silently bypasses the tunnel.
func TestP2PUnregisteredFailsClosed(t *testing.T) {
	chCfg := p2pChainConfig("127.0.0.1:1", "does-not-exist")
	if _, err := chain_parser.ParseChain(chCfg, clogger.Default()); err == nil {
		t.Fatal("expected an error for an unregistered p2p provider")
	} else {
		t.Logf("fail-closed: %v", err)
	}
}

// TestP2PChainCarriesTCP proves the wisper integration seam: a chain built by
// wisper's own ChainConfig, whose node carries metadata.p2p, dials its target
// through a p2p tunnel served in process by the imported library.
func TestP2PChainCarriesTCP(t *testing.T) {
	echoAddr := startEchoServer(t)

	// 1. The p2p host runs in process. Stub mode (no DERP): the peer is the
	//    plain host:port the node points at. Register its Tunnel the way
	//    wisper must (programmatically, not via x/config/loader) so the chain
	//    parser can resolve metadata.p2p.
	host, err := endpoint.New(&p2p.Config{})
	if err != nil {
		t.Fatalf("new p2p host: %v", err)
	}
	t.Cleanup(func() { _ = host.Close() })
	if err := registry.P2PRegistry().Register(p2pProviderName, host); err != nil {
		t.Fatalf("register p2p provider: %v", err)
	}
	t.Cleanup(func() { registry.P2PRegistry().Unregister(p2pProviderName) })

	// 2. Start from wisper's real chain builder, then replace the relay
	//    transport with the p2p peer (stub mode bridges to node.Addr).
	ch, err := chain_parser.ParseChain(p2pChainConfig(echoAddr, p2pProviderName), clogger.Default())
	if err != nil {
		t.Fatalf("parse chain: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	rt := ch.Route(ctx, "tcp", echoAddr)
	if rt == nil {
		t.Fatal("chain returned a nil route")
	}
	if got := len(rt.Nodes()); got != 1 {
		t.Fatalf("route nodes = %d, want 1", got)
	}

	// 3. Dial through the chain. If metadata.p2p were ignored this would fail
	//    closed or, worse, bypass — so success only happens via the tunnel.
	conn, err := rt.Dial(ctx, "tcp", echoAddr)
	if err != nil {
		t.Fatalf("dial through p2p chain: %v", err)
	}
	defer conn.Close()

	msg := []byte("hello over p2p")
	if _, err := conn.Write(msg); err != nil {
		t.Fatalf("write: %v", err)
	}
	buf := make([]byte, len(msg))
	if _, err := io.ReadFull(conn, buf); err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(buf) != string(msg) {
		t.Fatalf("echo mismatch: got %q, want %q", buf, msg)
	}
	t.Logf("TCP carried over the in-process p2p transport: %q", buf)
}

func startEchoServer(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen echo: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_, _ = io.Copy(c, c)
			}(c)
		}
	}()
	return ln.Addr().String()
}
