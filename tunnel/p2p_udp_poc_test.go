//go:build p2ppoc

// UDP entrypoint over p2p: the shapes docs/p2p-integration.md left open, run
// over the stack wisper's udp entrypoint actually builds
// (tunnel/entrypoint/p2p.go with ProtocolOption("udp")): a local udp listener
// -> local forward handler -> a chain whose node is a p2p udp tunnel -> a peer
// host holding a udp target outlet.
//
// Runs:
//
//	baseline  a datagram round-trips on the FIRST send: the per-dial link
//	          buffers the datagram that triggers the dial until its
//	          presentation edge is up (p2p v0.6.0), so there is no bring-up
//	          window to absorb (R2, which the retry loop used to hide).
//	isolation two concurrent clients (keepalive=true, overlapping in-flight
//	          window): each reply comes back on its own dial. The per-peer
//	          channel's last-dial-wins edge replacement used to cross-deliver
//	          them (R3).
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
	"github.com/go-gost/p2p/endpoint"
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
func startUDPEntrypoint(t *testing.T, wrap func(xp2p.Tunnel) xp2p.Tunnel, echoDelay time.Duration, keepalive bool) string {
	t.Helper()
	derp := startDerper(t)
	echo := startUDPEcho(t, echoDelay)

	direct, secure := false, false
	newHost := func(keyHex string, targets []string) *endpoint.Endpoint {
		h, err := endpoint.New(&p2p.Config{
			Derp:    derp,
			KeyHex:  keyHex,
			Direct:  &direct,
			TLS:     &p2p.TLSConfig{Secure: &secure},
			Targets: targets,
		}, endpoint.WithLogger(slog.Default()))
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

	var pr xp2p.Tunnel = dialer
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

// TestP2PUDPBaseline: a datagram round-trips on the first send. The per-dial
// link buffers the datagram that triggers the dial until its presentation edge
// is up (p2p v0.6.0), so the session's first datagram is delivered instead of
// being dropped in a bring-up window.
func TestP2PUDPBaseline(t *testing.T) {
	entry := startUDPEntrypoint(t, nil, 0, false)

	c := udpClient(t, entry)
	udpSend(t, c, "ping-baseline")
	got, err := udpRead(t, c, 10*time.Second)
	if err != nil || got != "ping-baseline" {
		t.Fatalf("first datagram round trip: got %q, %v; want ping-baseline on the first send", got, err)
	}
}

// TestP2PUDPTwoClientsIsolated: two concurrent clients with keepalive=true and
// an engineered overlap (the echo delay holds c1's reply in flight while c2
// dials). Each client's reply comes back on its own dial — the per-dial link
// that replaced the per-peer channel, whose last-dial-wins local edge used to
// cross-deliver the in-flight reply.
func TestP2PUDPTwoClientsIsolated(t *testing.T) {
	entry := startUDPEntrypoint(t, nil, 500*time.Millisecond, true)

	c1 := udpClient(t, entry)
	c2 := udpClient(t, entry)

	udpSend(t, c1, "from-c1")
	time.Sleep(100 * time.Millisecond) // c1's request is at the outlet, reply pending
	udpSend(t, c2, "from-c2")

	// Each client reads its own reply: c1's must not land on c2, which is
	// exactly what the shared edge did.
	if got, err := udpRead(t, c1, 10*time.Second); err != nil || got != "from-c1" {
		t.Fatalf("client 1 read %q, %v; want from-c1", got, err)
	}
	if got, err := udpRead(t, c2, 10*time.Second); err != nil || got != "from-c2" {
		t.Fatalf("client 2 read %q, %v; want from-c2", got, err)
	}

	// A second round proves both links stay independent, not just the first
	// datagram's buffering.
	udpSend(t, c1, "again-c1")
	udpSend(t, c2, "again-c2")
	if got, err := udpRead(t, c1, 10*time.Second); err != nil || got != "again-c1" {
		t.Fatalf("client 1 second read %q, %v; want again-c1", got, err)
	}
	if got, err := udpRead(t, c2, 10*time.Second); err != nil || got != "again-c2" {
		t.Fatalf("client 2 second read %q, %v; want again-c2", got, err)
	}
}
