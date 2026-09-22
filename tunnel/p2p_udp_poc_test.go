//go:build p2ppoc

// UDP entrypoint over p2p: the shapes docs/p2p-integration.md left open, run
// over the stack wisper's udp entrypoint actually builds
// (tunnel/entrypoint/udp.go Run()): a local udp listener -> local forward
// handler -> a chain whose node is a p2p udp tunnel -> a peer host holding a
// udp target outlet.
//
// Runs:
//
//	baseline  the provider as shipped: it frames udp conns (p2p 204e2d5), so a
//	          datagram round-trips once the channel comes up.
//	R3        two concurrent clients (keepalive=true): the second dial replaces
//	          the channel's local edge (last-dial-wins) and frames carry no
//	          client identity, so an in-flight reply is cross-delivered.
//
// The addressing hypothesis (the local handler's ":0" suffix reaching
// parsePeerKey) did NOT reproduce: the chain route dials node.Addr, the clean
// key, and the suffix lands only on the target address, which the forward
// connector ignores.
//
// Run:
//
//	TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDP -v ./tunnel/
//
// Needs docker to extract the derper binary from gogost/derper (or DERPER_BIN);
// the tests skip without it. No root, no network namespaces.
package tunnel_test

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-gost/core/chain"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/listener"
	clogger "github.com/go-gost/core/logger"
	"github.com/go-gost/p2p"
	xchain "github.com/go-gost/x/chain"
	xconfig "github.com/go-gost/x/config"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	_ "github.com/go-gost/x/connector/forward" // register the transparent connector
	_ "github.com/go-gost/x/dialer/udp"        // register the datagram dialer
	"github.com/go-gost/x/handler/forward/local"
	"github.com/go-gost/x/hop"
	xudp "github.com/go-gost/x/listener/udp"
	mdx "github.com/go-gost/x/metadata"
	xp2p "github.com/go-gost/x/p2p"
	"github.com/go-gost/x/registry"
	xservice "github.com/go-gost/x/service"

	wtunnel "github.com/go-gost/wisper/tunnel"
)

const p2pUDPProvider = "p2p-udp-poc"

// TestP2PUDPDerperUp isolates the relay: derper extracts, starts on a free
// high port and accepts a TCP connection.
func TestP2PUDPDerperUp(t *testing.T) {
	url := startDerper(t)
	if !strings.HasPrefix(url, "wss://127.0.0.1:") || !strings.HasSuffix(url, "/derp") {
		t.Fatalf("derper url = %q", url)
	}
}

// derperBin returns the derper binary to run: $DERPER_BIN if set, the p2p e2e
// cache if present, or a fresh extraction from the gogost/derper image. The
// test skips when neither a binary nor docker is available.
func derperBin(t *testing.T) string {
	t.Helper()
	if p := os.Getenv("DERPER_BIN"); p != "" {
		return p
	}
	const cache = "/tmp/p2p-e2e/derper-root/usr/local/bin/derper"
	if fi, err := os.Stat(cache); err == nil && fi.Mode()&0o111 != 0 {
		return cache
	}
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("derper unavailable: no DERPER_BIN, no cached binary, no docker")
	}
	root := filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(cache)))) // .../derper-root
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Skipf("derper cache dir: %v", err)
	}
	name := fmt.Sprintf("p2p-udp-poc-derper-%d", os.Getpid())
	if out, err := exec.Command("docker", "create", "--name", name, "gogost/derper").CombinedOutput(); err != nil {
		t.Skipf("docker create gogost/derper: %v (%s)", err, out)
	}
	defer exec.Command("docker", "rm", name).Run()
	cmd := exec.Command("sh", "-c", fmt.Sprintf("docker export %s | tar -C %s -xf -", name, root))
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("extract derper: %v (%s)", err, out)
	}
	if fi, err := os.Stat(cache); err != nil || fi.Mode()&0o111 == 0 {
		t.Skip("derper not found in the image")
	}
	return cache
}

// writeSelfSignedCert writes <dir>/<host>.crt and .key — the names derper's
// manual cert mode expects.
func writeSelfSignedCert(t *testing.T, dir, host string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: host},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IPAddresses:           []net.IP{net.ParseIP(host)},
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	if err := os.WriteFile(filepath.Join(dir, host+".crt"), certPEM, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, host+".key"), keyPEM, 0o600); err != nil {
		t.Fatal(err)
	}
}

// freePort returns a currently free loopback TCP port.
func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

// startDerper runs the relay on a free high port (no root) and waits for its
// listener. It returns the wss URL the hosts dial.
func startDerper(t *testing.T) string {
	t.Helper()
	bin := derperBin(t)
	dir := t.TempDir()
	certDir := filepath.Join(dir, "certs")
	writeSelfSignedCert(t, certDir, "127.0.0.1")
	addr := fmt.Sprintf("127.0.0.1:%d", freePort(t))

	logPath := filepath.Join(dir, "derper.log")
	logf, err := os.Create(logPath)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(bin,
		"-c", filepath.Join(dir, "derper.json"),
		"-hostname", "127.0.0.1",
		"-certmode", "manual",
		"-certdir", certDir,
		"-a", addr,
		"-http-port", "-1",
		"-stun=false",
	)
	cmd.Stdout, cmd.Stderr = logf, logf
	if err := cmd.Start(); err != nil {
		t.Fatalf("start derper: %v", err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
		logf.Close()
	})

	deadline := time.Now().Add(25 * time.Second)
	for {
		c, err := net.DialTimeout("tcp", addr, time.Second)
		if err == nil {
			c.Close()
			break
		}
		if time.Now().After(deadline) {
			b, _ := os.ReadFile(logPath)
			t.Fatalf("derper did not listen on %s: %v\n%s", addr, err, b)
		}
		time.Sleep(200 * time.Millisecond)
	}
	return "wss://" + addr + "/derp"
}

// startUDPEcho starts a UDP echo server; replies are delayed by d (R3 uses the
// delay to engineer the overlap).
func startUDPEcho(t *testing.T, d time.Duration) string {
	t.Helper()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pc.Close() })
	go func() {
		buf := make([]byte, 2048)
		for {
			n, addr, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			p := append([]byte(nil), buf[:n]...)
			go func() {
				if d > 0 {
					time.Sleep(d)
				}
				_, _ = pc.WriteTo(p, addr)
			}()
		}
	}()
	return pc.LocalAddr().String()
}

// startUDPEntrypoint runs the whole shape and returns the entrypoint's local
// udp address. wrap adapts the registered provider (nil = as shipped);
// keepalive mirrors the entrypoint's listener option (wisper's default false).
func startUDPEntrypoint(t *testing.T, wrap func(xp2p.TunnelProvider) xp2p.TunnelProvider, echoDelay time.Duration, keepalive bool) string {
	t.Helper()
	derp := startDerper(t)
	echo := startUDPEcho(t, echoDelay)

	direct, secure := false, false
	newHost := func(keyHex string, targets []string) *p2p.Host {
		h, err := p2p.New(&p2p.Config{
			Derp:    derp,
			KeyHex:  keyHex,
			Direct:  &direct,
			TLS:     &p2p.TLSConfig{Secure: &secure},
			Targets: targets,
		}, p2p.WithLogger(slog.Default()))
		if err != nil {
			t.Fatalf("new p2p host: %v", err)
		}
		t.Cleanup(func() { _ = h.Close() })
		if err := h.Connect(); err != nil {
			t.Fatalf("p2p connect to derper: %v", err)
		}
		return h
	}
	// B holds the udp target outlet; A dials out through the tunnel.
	outlet := newHost(strings.Repeat("11", 32), []string{"udp://" + echo})
	dialer := newHost(strings.Repeat("22", 32), nil)

	var pr xp2p.TunnelProvider = dialer.Provider()
	if wrap != nil {
		pr = wrap(pr)
	}
	if err := registry.P2PRegistry().Register(p2pUDPProvider, pr); err != nil {
		t.Fatalf("register provider: %v", err)
	}
	t.Cleanup(func() { registry.P2PRegistry().Unregister(p2pUDPProvider) })

	// Mirror tunnel/entrypoint/udp.go Run(): patch the chain node onto the p2p
	// peer, then wire the udp listener + local handler + router + hop.
	chCfg := wtunnel.ChainConfig("p2p-udp-poc", "p2p-udp-poc", "off")
	node := chCfg.Hops[0].Nodes[0]
	node.Addr = outlet.PublicKey()
	node.Connector = &xconfig.ConnectorConfig{Type: "forward"}
	node.Dialer = &xconfig.DialerConfig{Type: "udp"}
	node.Metadata = map[string]any{"p2p": p2pUDPProvider}

	log := clogger.Default().WithFields(map[string]any{"kind": "service", "service": "p2p-udp-poc"})
	ch, err := chain_parser.ParseChain(chCfg, log)
	if err != nil {
		t.Fatalf("parse chain: %v", err)
	}

	ln := xudp.NewListener(
		listener.AddrOption("127.0.0.1:0"),
		listener.LoggerOption(log),
	)
	if err := ln.Init(mdx.NewMetadata(map[string]any{"keepalive": keepalive})); err != nil {
		t.Fatalf("listener init: %v", err)
	}

	h := local.NewHandler(
		handler.RouterOption(xchain.NewRouter(
			chain.ChainRouterOption(ch),
			chain.LoggerRouterOption(log),
		)),
		handler.LoggerOption(log),
	)
	if err := h.Init(mdx.NewMetadata(nil)); err != nil {
		t.Fatalf("handler init: %v", err)
	}
	h.(handler.Forwarder).Forward(hop.NewHop(
		hop.NodeOption(chain.NewNode("p2p-udp-poc", outlet.PublicKey())),
		hop.LoggerOption(log),
	))

	svc := xservice.NewService("p2p-udp-poc", ln, h, xservice.LoggerOption(log))
	go func() { _ = svc.Serve() }()
	t.Cleanup(func() { _ = svc.Close() })

	return ln.Addr().String()
}

// udpClient dials the entrypoint with a distinct source port.
func udpClient(t *testing.T, entry string) net.Conn {
	t.Helper()
	c, err := net.Dial("udp", entry)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	return c
}

// udpSend sends one datagram.
func udpSend(t *testing.T, c net.Conn, payload string) {
	t.Helper()
	if err := c.SetWriteDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Write([]byte(payload)); err != nil {
		t.Fatalf("send %q: %v", payload, err)
	}
}

// udpRead waits for one datagram.
func udpRead(t *testing.T, c net.Conn, timeout time.Duration) (string, error) {
	t.Helper()
	if err := c.SetReadDeadline(time.Now().Add(timeout)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 2048)
	n, err := c.Read(buf)
	if err != nil {
		return "", err
	}
	return string(buf[:n]), nil
}

// udpRetryRoundTrip sends payload until a reply arrives or the budget runs
// out, returning the reply and the number of sends it took. The channel drops
// the session's first datagram while its peer edge is attached, and with
// keepalive=false each reply also closes the session, so the retry opens a
// fresh session — the loop absorbs both outcomes of that race.
func udpRetryRoundTrip(t *testing.T, c net.Conn, payload string, budget time.Duration) (string, int) {
	t.Helper()
	deadline := time.Now().Add(budget)
	for sends := 1; ; sends++ {
		udpSend(t, c, payload)
		got, err := udpRead(t, c, time.Second)
		if err == nil {
			return got, sends
		}
		if time.Now().After(deadline) {
			return "", sends
		}
	}
}

// TestP2PUDPBaseline is the as-shipped baseline: the in-process provider frames
// udp conns itself (p2p's frameConn, so both carriers hand the inner dialer the
// same conn shape), and a datagram round-trips. The send is retried because the
// channel drops the session's first datagram while its peer edge is attached.
func TestP2PUDPBaseline(t *testing.T) {
	entry := startUDPEntrypoint(t, nil, 0, false)

	c := udpClient(t, entry)
	got, sends := udpRetryRoundTrip(t, c, "ping-baseline", 5*time.Second)
	if got != "ping-baseline" {
		t.Fatalf("round trip through the udp entrypoint: got %q after %d send(s)", got, sends)
	}
	t.Logf("baseline signature: reply after %d send(s) (the session's first datagram is dropped during channel bring-up)", sends)
}

// TestP2PUDPTwoClientsCollide is R3: two concurrent clients on the baseline,
// with keepalive=true so the session (and the tunnel) survives its
// first reply — under the default keepalive=false every reply tears the tunnel
// down and there is no state to collide over. The second dial replaces the
// channel's local edge (last-dial-wins) and the frames carry no client
// identity, so the first client's in-flight reply is cross-delivered. The echo
// delay engineers the overlap.
func TestP2PUDPTwoClientsCollide(t *testing.T) {
	entry := startUDPEntrypoint(t, nil, 500*time.Millisecond, true)

	c1 := udpClient(t, entry)
	c2 := udpClient(t, entry)

	// Warm c1: the first datagram is dropped during bring-up, the retry gets a
	// reply, and keepalive keeps the session — and with it the tunnel — alive.
	if got, sends := udpRetryRoundTrip(t, c1, "warm-c1", 5*time.Second); got != "warm-c1" {
		t.Fatalf("client 1 warm-up: got %q after %d send(s)", got, sends)
	}
	udpSend(t, c1, "from-c1")

	time.Sleep(100 * time.Millisecond) // c1's request is at the outlet, reply pending

	// c2's datagram triggers its dial, which replaces the channel's local edge
	// (last-dial-wins). The peer edge is already up (c1's tunnel kept the
	// channel alive), so this datagram is forwarded too.
	udpSend(t, c2, "from-c2")

	// The frames carry no client identity: both replies land on the current
	// edge, so c2 receives c1's in-flight reply as well as its own.
	first, err := udpRead(t, c2, 5*time.Second)
	if err != nil {
		t.Fatalf("client 2 read: %v", err)
	}
	second, err := udpRead(t, c2, 5*time.Second)
	if err != nil {
		t.Fatalf("client 2 second read: %v (got %q first)", err, first)
	}
	seen := map[string]bool{first: true, second: true}
	if !seen["from-c1"] || !seen["from-c2"] {
		t.Fatalf("client 2 received %q + %q, want the cross-delivered from-c1 and its own from-c2", first, second)
	}

	// c1's edge was replaced: its reply went to the other client and it gets
	// nothing of its own.
	reply, err := udpRead(t, c1, 1*time.Second)
	if err == nil {
		t.Fatalf("client 1 received %q; the edge replacement did not drop its reply", reply)
	}
	t.Logf("R3 signature: client 2 received %q then %q (cross-delivery); client 1 got no reply (%v)", first, second, err)
}
