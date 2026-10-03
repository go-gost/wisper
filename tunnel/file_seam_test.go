package tunnel

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-gost/core/auth"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/listener"
	"github.com/go-gost/core/metadata"
	xauth "github.com/go-gost/x/auth"
	"github.com/go-gost/x/handler/file"
	xlogger "github.com/go-gost/x/logger"
	mdx "github.com/go-gost/x/metadata"
	xstats "github.com/go-gost/x/observer/stats"
	xservice "github.com/go-gost/x/service"
)

// tcpListener is the rtcp listener's role reduced to a socket: accept, serve.
// Everything the file tunnel's seam adds is the handler behind it.
type tcpListener struct {
	net.Listener
}

func (l *tcpListener) Init(md metadata.Metadata) error { return nil }

var _ listener.Listener = (*tcpListener)(nil)

// serveFile runs the tunnel's data path — relay listener, file handler, service —
// and returns the address to knock on. The relay hop itself is the only part
// left out; it is what creates the conns this path serves.
func serveFile(t *testing.T, dir, user, pass string) string {
	t.Helper()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	var auther auth.Authenticator
	if user != "" {
		auther = xauth.NewAuthenticator(xauth.AuthsOption(map[string]string{user: pass}))
	}
	h := file.NewHandler(
		handler.LoggerOption(xlogger.Nop()),
		handler.AutherOption(auther),
	)
	if err := h.Init(mdx.NewMetadata(map[string]any{"file.dir": dir})); err != nil {
		t.Fatal(err)
	}

	svc := xservice.NewService("file", &tcpListener{ln}, h, xservice.StatsOption(xstats.NewStats(false)))
	// Serve returns when the service closes, which the cleanup below does; there
	// is nothing to assert on it here.
	go func() { _ = svc.Serve() }()
	t.Cleanup(func() { svc.Close() })

	return ln.Addr().String()
}

func get(t *testing.T, addr, req string) string {
	t.Helper()

	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatal(err)
	}

	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 4096)
	n, _ := conn.Read(buf)
	return string(buf[:n])
}

// A request arriving on the relay conn is served out of the directory in the
// same process: no local port, no dial back through a hop.
func TestFileHandlerServesOverTheSeam(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("in-process"), 0o644); err != nil {
		t.Fatal(err)
	}

	got := get(t, serveFile(t, dir, "", ""), "GET /hello.txt HTTP/1.0\r\n\r\n")
	if !strings.Contains(got, "200 OK") || !strings.Contains(got, "in-process") {
		t.Fatalf("file not served over the seam: %q", got)
	}
}

// The auth check lives in the handler, so it holds on the seam too.
func TestFileHandlerAuthOverTheSeam(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "secret.txt"), []byte("classified"), 0o644); err != nil {
		t.Fatal(err)
	}

	addr := serveFile(t, dir, "alice", "s3cret")

	if got := get(t, addr, "GET /secret.txt HTTP/1.0\r\n\r\n"); !strings.Contains(got, "401") {
		t.Fatalf("unauthenticated request was not rejected: %q", got)
	}

	req := "GET /secret.txt HTTP/1.0\r\nAuthorization: Basic YWxpY2U6czNjcmV0\r\n\r\n"
	if got := get(t, addr, req); !strings.Contains(got, "classified") {
		t.Fatalf("authenticated request was not served: %q", got)
	}
}
