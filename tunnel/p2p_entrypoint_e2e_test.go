//go:build p2ppoc

// TestP2PEntryPointDialsPeerByKey is the acceptance test for the out-dial
// side: a wisper p2p entrypoint listening locally, dialing a peer host's
// target through a real derper by public key.
package tunnel_test

import (
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/go-gost/p2p"
	"github.com/go-gost/p2p/endpoint"

	cfg "github.com/go-gost/wisper/config"
	wtunnel "github.com/go-gost/wisper/tunnel"
	wep "github.com/go-gost/wisper/tunnel/entrypoint"
)

func TestP2PEntryPointDialsPeerByKey(t *testing.T) {
	// The entrypoint's key resolves through os.UserConfigDir(); keep the test
	// out of the real ~/.config/wisper/p2p/.
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	echo := startEchoServer(t) // p2p_poc_test.go (same package + tag)
	derp := startDerper(t)     // p2p_udp_poc_test.go (same package + tag)

	secure := false
	direct := false
	cfg.Set(&cfg.Config{Settings: &cfg.Settings{
		P2P: &cfg.P2PSettings{Derp: derp, Secure: &secure, Direct: &relayOnly},
	}})

	// The peer side: an in-process host holding the echo as its target.
	peer, err := endpoint.New(&p2p.Config{
		Derp: derp, KeyHex: strings.Repeat("44", 32),
		Direct: &direct, TLS: &p2p.TLSConfig{Secure: &secure},
		Targets: []string{"tcp://" + echo},
	})
	if err != nil {
		t.Fatalf("new peer host: %v", err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	if err := peer.Connect(); err != nil {
		t.Fatalf("peer connect: %v", err)
	}

	// The entrypoint listens locally and dials the peer by key. Entrypoint()
	// returns the configured listen address (tcp/udp entrypoint convention), so
	// the test binds a concrete free port instead of :0.
	ep := wep.NewP2PEntryPoint(
		wtunnel.IDOption("e2e-p2p-ep"),
		wtunnel.EndpointOption(fmt.Sprintf("127.0.0.1:%d", freePort(t))),
		wtunnel.PeerOption(peer.PublicKey()),
	)
	if err := ep.Run(); err != nil {
		t.Fatalf("run p2p entrypoint: %v", err)
	}
	t.Cleanup(func() { _ = wtunnel.RemoveP2PKey("e2e-p2p-ep") })
	t.Cleanup(func() { _ = ep.Close() })

	addr := ep.Entrypoint() // the local listen address
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		t.Fatalf("dial the local entrypoint at %s: %v", addr, err)
	}
	defer conn.Close()

	msg := []byte("hello-p2p-entrypoint")
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
