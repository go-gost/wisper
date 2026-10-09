package tunnel

import (
	"bytes"
	"encoding/binary"
	"net"
	"net/netip"
	"sync"
	"testing"
	"time"

	"github.com/go-gost/core/handler"
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

func TestParseLanAllow(t *testing.T) {
	// Rows separated by whitespace or commas, one or more per spoke.
	rows, err := ParseLanAllow("peerA=192.168.0.0/16, peerB=10.0.0.0/8 peerA=fd00::/8")
	if err != nil {
		t.Fatalf("ParseLanAllow: %v", err)
	}
	if got := rows["peerA"]; len(got) != 2 ||
		got[0] != netip.MustParsePrefix("192.168.0.0/16") ||
		got[1] != netip.MustParsePrefix("fd00::/8") {
		t.Fatalf("peerA rows = %v, want its two supernets", got)
	}
	if got := rows["peerB"]; len(got) != 1 || got[0] != netip.MustParsePrefix("10.0.0.0/8") {
		t.Fatalf("peerB rows = %v, want 10.0.0.0/8", got)
	}

	// A spoke with an empty row is a spoke that may claim nothing, which is
	// not the same state as a spoke this hub has not configured.
	rows, err = ParseLanAllow("peerA=")
	if err != nil {
		t.Fatalf("an empty row: %v", err)
	}
	if got, ok := rows["peerA"]; !ok || len(got) != 0 {
		t.Fatalf("peerA = (%v, %v); want an empty row that is present", got, ok)
	}

	// Nothing configured is not an error: no row, nothing claimed.
	rows, err = ParseLanAllow("  ")
	if err != nil {
		t.Fatalf("an empty policy: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("an empty policy = %v, want no rows", rows)
	}

	// A row that names no network is refused: the hub would otherwise start
	// with a policy nobody typed.
	for _, bad := range []string{"peerA", "peerA=nonsense", "=192.168.0.0/16", "peerA=192.168.0.0/16 peerB"} {
		if _, err := ParseLanAllow(bad); err == nil {
			t.Fatalf("ParseLanAllow(%q) = nil error, want a refusal", bad)
		}
	}
}

// TestControlRouteRegistersPeerOnAccept: the hub learns a spoke exists from its
// tun stream, not from its control stream — the two arrive independently — so
// accepting the tun stream has to open the control channel for that spoke.
// Driving it through the route's own Accept is what keeps tun.go's wiring
// honest without a tun device.
func TestControlRouteRegistersPeerOnAccept(t *testing.T) {
	h := newFakeP2PHandler()
	ch := newControlHub("hub1", map[string][]netip.Prefix{
		"peerB": {netip.MustParsePrefix("192.168.0.0/16")},
	}, h, testLogger())

	route := &controlRoute{peerListener: newPeerListener([]string{"peerB"}), ch: ch}
	defer route.Close()

	tun, tunFar := peerPipe("peerB")
	defer tunFar.Close()
	tun.Close() // the stream's life does not matter here, only its acceptance
	route.deliver(tun)

	conn, err := route.Accept()
	if err != nil {
		t.Fatalf("Accept: %v", err)
	}
	conn.Close()

	// The spoke's control stream, which a real spoke may send before or after
	// its tun stream: the slot Register opened is what takes it.
	hub, spoke := net.Pipe()
	go func() { _, _ = spoke.Write(ControlMagic) }()
	if _, ok := consumeControlMagic(hub); !ok {
		t.Fatal("the control stream's magic must be read")
	}
	ch.deliver("peerB", hub)
	go func() {
		_, _ = spoke.Write(framed(t, claimMessage{Type: ctrlTypeClaim, V: 1, Add: []string{"192.168.50.0/24"}}))
	}()

	want := netip.MustParsePrefix("192.168.50.0/24")
	waitFor(t, "the registered spoke's claim must reach the hub", func() bool {
		_, ok := h.installed()[want]
		return ok
	})
}

// TestP2PHandlerTakesPrefixRoutes: the hub installs its LAN routes into the
// handler it builds by shape, because NewP2PHandler hands back a core
// handler.Handler. If that assertion were false the hub would start, log that
// it installs nothing, and route no LAN at all — a failure that looks exactly
// like a network that has no LANs in it, so it is worth proving against the
// real handler rather than the fake.
func TestP2PHandlerTakesPrefixRoutes(t *testing.T) {
	device, far := net.Pipe()
	defer device.Close()
	defer far.Close()

	h := tunhandler.NewP2PHandler(device, nil, handler.LoggerOption(testLogger()))
	sink, ok := h.(prefixSink)
	if !ok {
		t.Fatal("x's p2p handler must take the hub's prefix routes")
	}
	sink.SetPrefixRoutes(map[netip.Prefix]tunhandler.PrefixRoute{
		netip.MustParsePrefix("192.168.50.0/24"): {Peer: "peerB"},
	})
}

func TestSpokeAuthorizerMembers(t *testing.T) {
	a := newSpokeAuthorizer("hub1", map[string]string{
		"peerB": "10.10.100.5",
		"peerA": "10.10.100.2,::ffff:10.10.100.3",
	}, testLogger())

	members := a.Members()
	// One canonical order, so a repeated read is not a change: SetMembers
	// compares by contents to decide what to publish.
	want := []memberEntry{
		{IP: "10.10.100.2", Key: "peerA"},
		{IP: "10.10.100.3", Key: "peerA"},
		{IP: "10.10.100.5", Key: "peerB"},
	}
	if len(members) != len(want) {
		t.Fatalf("Members = %v, want %v", members, want)
	}
	for i := range want {
		if members[i] != want[i] {
			t.Fatalf("Members[%d] = %v, want %v (all: %v)", i, members[i], want[i], members)
		}
	}
	if got := a.Members(); len(got) != len(members) {
		t.Fatalf("a second read changed length: %v vs %v", got, members)
	}
}
