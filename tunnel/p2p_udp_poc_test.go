//go:build p2ppoc

// UDP entrypoint over p2p: the shapes docs/p2p-integration.md left open, run
// over the stack wisper's udp entrypoint actually builds
// (tunnel/entrypoint/udp.go Run()): a local udp listener -> local forward
// handler -> a chain whose node is a p2p udp tunnel -> a peer host holding a
// udp target outlet.
//
// Runs:
//
//	R0  addressing as-is: the local handler appends ":0" to the peer key,
//	    which parsePeerKey rejects, so the tunnel dial fails before data flows.
//	R1  addressing shim only: the in-process provider's conn carries no
//	    datagram framing (the gRPC plugin's does), so the outlet's frame
//	    parser never sees a frame.
//	R2  addressing + framing shims: the baseline datagram path.
//	R3  two concurrent clients on R2: the second dial replaces the channel's
//	    local edge (last-dial-wins) and frames carry no client identity, so an
//	    in-flight reply is cross-delivered.
//
// Run:
//
//	TMPDIR=/config/tmp go test -tags p2ppoc -run TestP2PUDP -v ./tunnel/
//
// Needs docker to extract the derper binary from gogost/derper (or DERPER_BIN);
// the tests skip without it. No root, no network namespaces.
package tunnel_test

import (
	"context"
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
	"github.com/go-gost/plugin/p2p/proto"
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
	"github.com/go-gost/x/p2p/streamconn"
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

// TestP2PUDPFramedBaseline is R2: with the addressing and framing shims the
// datagram path is correct — the baseline that proves R1's failure is framing,
// not the harness. The send is retried because the channel drops the session's
// first datagram while its peer edge is attached.
func TestP2PUDPFramedBaseline(t *testing.T) {
	entry := startUDPEntrypoint(t, func(pr xp2p.TunnelProvider) xp2p.TunnelProvider {
		return framedProvider{inner: stripPortProvider{inner: pr}}
	}, 0, false)

	c := udpClient(t, entry)
	got, sends := udpRetryRoundTrip(t, c, "ping-r2", 5*time.Second)
	if got != "ping-r2" {
		t.Fatalf("round trip through the udp entrypoint: got %q after %d send(s)", got, sends)
	}
	t.Logf("R2 signature: reply after %d send(s) (the session's first datagram is dropped during channel bring-up)", sends)
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

// stripPortProvider drops a ":port" suffix from the peer before the tunnel is
// opened. Test-local: it stands in for the addressing fix the entrypoint shape
// needs (the local handler appends ":0" to a key-shaped node addr).
type stripPortProvider struct{ inner xp2p.TunnelProvider }

func (p stripPortProvider) Close() error { return p.inner.Close() }

func (p stripPortProvider) OpenTunnelStream(ctx context.Context, network, peer string) (net.Conn, error) {
	if host, _, err := net.SplitHostPort(peer); err == nil {
		peer = host
	}
	return p.inner.OpenTunnelStream(ctx, network, peer)
}

// framedProvider adapts the in-process provider's raw conn to the datagram
// framing the gRPC plugin path gets from x/p2p/streamconn. Test-local: it
// stands in for the missing production wrapper.
type framedProvider struct{ inner xp2p.TunnelProvider }

func (p framedProvider) Close() error { return p.inner.Close() }

func (p framedProvider) OpenTunnelStream(ctx context.Context, network, peer string) (net.Conn, error) {
	c, err := p.inner.OpenTunnelStream(ctx, network, peer)
	if err != nil || network != "udp" {
		return c, err
	}
	return streamconn.New(connStream{c: c}, func() { c.Close() }, "udp", c.LocalAddr(), c.RemoteAddr()), nil
}

// connStream presents a net.Conn as a streamconn.Stream.
type connStream struct{ c net.Conn }

func (s connStream) Send(ch *proto.Chunk) error {
	_, err := s.c.Write(ch.GetData())
	return err
}

func (s connStream) Recv() (*proto.Chunk, error) {
	b := make([]byte, 32*1024)
	n, err := s.c.Read(b)
	if n > 0 {
		return &proto.Chunk{Data: b[:n]}, nil
	}
	return nil, err
}

func (s connStream) Context() context.Context { return context.Background() }

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

// TestP2PUDPEntrypointAddressing is R0: the entrypoint shape as shipped cannot
// address the peer. The local handler appends ":0" to a key-shaped node addr
// (x/handler/forward/local) and p2p's parsePeerKey wants the whole string to be
// the base64 key, so the dial fails before any data flows. When the addressing
// is fixed this test should be inverted (it will then behave like R1).
func TestP2PUDPEntrypointAddressing(t *testing.T) {
	entry := startUDPEntrypoint(t, nil, 0, false)

	c := udpClient(t, entry)
	udpSend(t, c, "ping-r0")
	got, err := udpRead(t, c, 3*time.Second)
	if err == nil {
		t.Fatalf("round trip succeeded (echo=%q): the entrypoint addressing seam appears fixed", got)
	}
	t.Logf("R0 signature: no reply (%v)", err)
}
