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
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
