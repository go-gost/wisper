//go:build p2ppoc

// TestP2PTunnelAcceptsPeerByKey is the acceptance test for the private p2p
// mode in its peer-routed shape: a wisper p2p tunnel exposing a local echo on
// the process-wide host, a named peer dialing in by the host's key through a
// real derper, and the tunnel's stats counting what crossed.
package tunnel_test

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	clogger "github.com/go-gost/core/logger"
	"github.com/go-gost/core/observer/stats"
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
	// The host key resolves through os.UserConfigDir(); keep the test out of
	// the real ~/.config/wisper/p2p/.
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	echo := startEchoServer(t) // from p2p_poc_test.go (same package + tag)
	derp := startDerper(t)     // from p2p_udp_poc_test.go (same package + tag)

	secure := false
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{
		P2P: &cfg.P2PSettings{Derp: derp, Secure: &secure},
	}})

	// The dialing side: an in-process host with a fixed key. Its public key is
	// the credential the tunnel admits (PeerOption); its Tunnel() is the
	// provider whose dial opens the tunnel to the wisper host's key.
	direct := false
	peer, err := p2p.New(&p2p.Config{
		Derp: derp, KeyHex: strings.Repeat("44", 32),
		Direct: &direct, TLS: &p2p.TLSConfig{Secure: &secure},
	})
	if err != nil {
		t.Fatalf("new peer host: %v", err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	if err := peer.Connect(); err != nil {
		t.Fatalf("peer connect: %v", err)
	}
	peerKey := peer.PublicKey()
	if peerKey == "" {
		t.Fatal("peer PublicKey() = empty, want its base64 key")
	}

	// The wisper side: the peer route key is this tunnel's peer, so an inbound
	// stream from exactly this key is delivered to the tunnel's service.
	tn := wtunnel.NewP2PTunnel(
		wtunnel.IDOption("e2e-p2p"),
		wtunnel.EndpointOption(echo),
		wtunnel.PeerOption(peerKey),
	)
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

	// Run started the process-wide host: its key is what the peer dials.
	key := wtunnel.P2PHostPublicKey()
	if key == "" {
		t.Fatal("P2PHostPublicKey() = empty after Run, want the host's base64 key")
	}

	if err := registry.P2PRegistry().Register("e2e-peer", peer.Tunnel()); err != nil {
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

	// The tunnel serves its peer route with a standard gost service, so the
	// round trip above must show up in the service's live stats — the same
	// numbers runner/task/stats.go copies into Tunnel.Stats() in production.
	status := tn.Status()
	if status == nil {
		t.Fatal("tunnel Status() = nil, want the service status")
	}
	s := status.Stats()
	if s == nil {
		t.Fatal("service status has no stats")
	}
	if got := s.Get(stats.KindTotalConns); got < 1 {
		t.Errorf("stats TotalConns = %d, want >= 1", got)
	}
	if got := s.Get(stats.KindInputBytes); got < uint64(len(msg)) {
		t.Errorf("stats InputBytes = %d, want >= %d", got, len(msg))
	}
	if got := s.Get(stats.KindOutputBytes); got < uint64(len(msg)) {
		t.Errorf("stats OutputBytes = %d, want >= %d", got, len(msg))
	}
}
