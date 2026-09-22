//go:build p2ppoc

// TestP2PTunnelAcceptsPeerByKey is the acceptance test for the private p2p
// mode: a wisper p2p tunnel exposing a local echo, and a peer that dials in by
// the tunnel's public key through a real derper.
package tunnel_test

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	clogger "github.com/go-gost/core/logger"
	"github.com/go-gost/p2p"
	xconfig "github.com/go-gost/x/config"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	_ "github.com/go-gost/x/connector/forward"
	_ "github.com/go-gost/x/dialer/tcp"
	"github.com/go-gost/x/registry"

	cfg "github.com/go-gost/wisper/config"
	wtunnel "github.com/go-gost/wisper/tunnel"
)

func TestP2PTunnelAcceptsPeerByKey(t *testing.T) {
	// The tunnel's key resolves through os.UserConfigDir(); keep the test out
	// of the real ~/.config/wisper/p2p/.
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	echo := startEchoServer(t) // from p2p_poc_test.go (same package + tag)
	derp := startDerper(t)     // from p2p_udp_poc_test.go (same package + tag)

	secure := false
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{
		P2P: &cfg.P2PSettings{Derp: derp, Secure: &secure},
	}})

	tn := wtunnel.NewP2PTunnel(wtunnel.IDOption("e2e-p2p"), wtunnel.EndpointOption(echo))
	if err := tn.Run(); err != nil {
		t.Fatalf("run p2p tunnel: %v", err)
	}
	wtunnel.Add(tn)
	t.Cleanup(func() {
		wtunnel.Delete("e2e-p2p")
		// Delete keeps the key file (an update must keep the identity), so the
		// transient test tunnel removes it explicitly.
		if err := wtunnel.RemoveP2PKey("e2e-p2p"); err != nil {
			t.Errorf("remove p2p key: %v", err)
		}
	})

	key := tn.Entrypoint()
	if key == "" {
		t.Fatal("tunnel Entrypoint() = empty, want its public key")
	}

	// The peer side: an in-process host registered as the chain's provider.
	direct := false
	peer, err := p2p.New(&p2p.Config{
		Derp: derp, KeyHex: strings.Repeat("33", 32),
		Direct: &direct, TLS: &p2p.TLSConfig{Secure: &secure},
	})
	if err != nil {
		t.Fatalf("new peer host: %v", err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	if err := peer.Connect(); err != nil {
		t.Fatalf("peer connect: %v", err)
	}
	if err := registry.P2PRegistry().Register("e2e-peer", peer.Provider()); err != nil {
		t.Fatalf("register provider: %v", err)
	}
	t.Cleanup(func() { registry.P2PRegistry().Unregister("e2e-peer") })

	chCfg := wtunnel.ChainConfig("e2e-peer-chain", "e2e-peer-chain", "off")
	node := chCfg.Hops[0].Nodes[0]
	node.Addr = key
	node.Connector = &xconfig.ConnectorConfig{Type: "forward"}
	node.Dialer = &xconfig.DialerConfig{Type: "tcp"}
	node.Metadata = map[string]any{"p2p": "e2e-peer"}
	ch, err := chain_parser.ParseChain(chCfg, clogger.Default())
	if err != nil {
		t.Fatalf("parse chain: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	rt := ch.Route(ctx, "tcp", key)
	if rt == nil {
		t.Fatal("chain returned a nil route")
	}
	conn, err := rt.Dial(ctx, "tcp", key)
	if err != nil {
		t.Fatalf("dial through the p2p tunnel: %v", err)
	}
	defer conn.Close()

	msg := []byte("hello-private-p2p")
	if _, err := conn.Write(msg); err != nil {
		t.Fatal(err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, len(msg))
	if _, err := io.ReadFull(conn, buf); err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(buf) != string(msg) {
		t.Fatalf("echo = %q, want %q", buf, msg)
	}
}
