package tunnel

import (
	"bytes"
	"encoding/binary"
	"net/netip"
	"sync"
	"testing"
	"time"

	"github.com/go-gost/core/logger"
	tunhandler "github.com/go-gost/x/handler/tun"
	xlogger "github.com/go-gost/x/logger"
)

// newFakeP2PHandler is the smallest stand-in for the hub side of x's tun
// handler: one method, the routes it was last handed, under a mutex because
// the hub installs them from a reader goroutine while the test reads them.
type fakeP2PHandler struct {
	mu     sync.Mutex
	routes map[netip.Prefix]tunhandler.PrefixRoute
	calls  int
}

func newFakeP2PHandler() *fakeP2PHandler {
	return &fakeP2PHandler{routes: map[netip.Prefix]tunhandler.PrefixRoute{}}
}

func (f *fakeP2PHandler) SetPrefixRoutes(routes map[netip.Prefix]tunhandler.PrefixRoute) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.routes = routes
	f.calls++
}

// installed copies the routes out; the hub allocates a fresh map per install,
// so what comes back is a snapshot that cannot change under the reader.
func (f *fakeP2PHandler) installed() map[netip.Prefix]tunhandler.PrefixRoute {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[netip.Prefix]tunhandler.PrefixRoute, len(f.routes))
	for p, r := range f.routes {
		out[p] = r
	}
	return out
}

func (f *fakeP2PHandler) installs() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// logger is the test logger: the hub logs its own decisions and a test wants
// them seen when it fails, not discarded.
func testLogger() logger.Logger {
	return xlogger.NewLogger()
}

// framed is writeMessage's framing without the writer: the four-byte length
// then the body, so a test can put several messages on one stream.
func framed(t *testing.T, m any) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := writeMessage(&buf, m); err != nil {
		t.Fatalf("frame %T: %v", m, err)
	}
	return buf.Bytes()
}

// waitFor polls until cond holds, failing the test with why when it never
// does. The hub's claim path is one goroutine hop from the test's write, and
// polling for it is what keeps the test from racing its own assertions.
func waitFor(t *testing.T, why string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal(why)
}

func TestControlHubRoundTripAndPublish(t *testing.T) {
	h := newFakeP2PHandler()
	ch := newControlHub("hub1", map[string][]netip.Prefix{
		"peerB": {netip.MustParsePrefix("192.168.0.0/16")},
	}, h, testLogger())

	if err := ch.Register("peerB"); err != nil {
		t.Fatal(err)
	}
	defer ch.Unregister("peerB")

	// A claim over the control stream: the spoke announced itself on connect, and
	// now sends its claim. The
	// test drives the spoke end; the hub end is delivered to the hub the way
	// the p2p host's dispatch delivers it.
	hub, ctrl := ch.dialControlForTest("peerB")
	defer hub.Close()
	defer ctrl.Close()

	go func() {
		_, _ = ctrl.Write(framed(t, claimMessage{Type: ctrlTypeClaim, V: 1, Add: []string{"192.168.50.0/24"}}))
	}()

	// The hub accepted the claim and pushed the winners back out.
	_ = ctrl.SetReadDeadline(time.Now().Add(3 * time.Second))
	n, _, err := readMessage(ctrl)
	if err != nil {
		t.Fatalf("read the netview the hub pushed: %v", err)
	}
	if n.Type != ctrlTypeNetview || n.Hub != "hub1" {
		t.Fatalf("pushed %+v, want a hub1 netview", n)
	}
	if len(n.Claims) != 1 || n.Claims[0].Prefix != "192.168.50.0/24" || n.Claims[0].Origin != "peerB" {
		t.Fatalf("pushed claims %+v, want peerB's 192.168.50.0/24", n.Claims)
	}

	// And installed it as a prefix route, naming the claiming peer.
	routes := h.installed()
	route, ok := routes[netip.MustParsePrefix("192.168.50.0/24")]
	if !ok || route.Peer != "peerB" {
		t.Fatalf("installed routes %+v, want 192.168.50.0/24 via peerB", routes)
	}
}

func TestControlHubIgnoresOversizeAndUnknownType(t *testing.T) {
	h := newFakeP2PHandler()
	ch := newControlHub("hub1", map[string][]netip.Prefix{
		"peerB": {netip.MustParsePrefix("192.168.0.0/16")},
	}, h, testLogger())

	if err := ch.Register("peerB"); err != nil {
		t.Fatal(err)
	}
	defer ch.Unregister("peerB")

	hub, ctrl := ch.dialControlForTest("peerB")
	defer hub.Close()
	defer ctrl.Close()

	var hdr [4]byte
	// A frame claiming 1 MiB: readMessage refuses it before its body is read,
	// and a hostile spoke must not make the hub stop listening.
	binary.BigEndian.PutUint32(hdr[:], uint32(1<<20))
	// A version this hub does not speak: refused the same way.
	badVersion := framed(t, netviewMessage{V: 99, Hub: "hub1", Rev: 1})
	good := framed(t, claimMessage{Type: ctrlTypeClaim, V: 1, Add: []string{"192.168.50.0/24"}})

	go func() {
		_, _ = ctrl.Write(append(append(hdr[:], badVersion...), good...))
	}()

	waitFor(t, "the claim after the refused frames must still land", func() bool {
		_, ok := h.installed()[netip.MustParsePrefix("192.168.50.0/24")]
		return ok
	})
}
