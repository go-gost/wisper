package entrypoint

import (
	"context"
	"errors"
	"net"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/go-gost/core/handler"
	md "github.com/go-gost/core/metadata"
	"github.com/go-gost/wisper/tunnel"
	tunhandler "github.com/go-gost/x/handler/tun"
)

type fakeMesh struct {
	mu           sync.Mutex
	hubLinks     []net.Conn
	devices      []net.Conn
	members      []tunhandler.MeshMember
	dialed       map[string]bool
	directNeeded func(string)
	linkClosed   func(string, tunhandler.MeshCloseReason)
	closed       bool
}

func (f *fakeMesh) Init(md.Metadata) error { return nil }

func (f *fakeMesh) Handle(context.Context, net.Conn, ...handler.HandleOption) error { return nil }

func (f *fakeMesh) RunDevice(conn net.Conn) error {
	f.mu.Lock()
	f.devices = append(f.devices, conn)
	f.mu.Unlock()
	_ = conn.Close()
	return tunhandler.ErrTun
}

func (f *fakeMesh) SetMembers(members []tunhandler.MeshMember) {
	f.mu.Lock()
	f.members = append([]tunhandler.MeshMember(nil), members...)
	f.mu.Unlock()
}
func (f *fakeMesh) SetHubLink(conn net.Conn) {
	f.mu.Lock()
	f.hubLinks = append(f.hubLinks, conn)
	f.mu.Unlock()
}
func (f *fakeMesh) AddDialedLink(peer string, _ net.Conn) {
	f.mu.Lock()
	if f.dialed == nil {
		f.dialed = make(map[string]bool)
	}
	f.dialed[peer] = true
	f.mu.Unlock()
}
func (f *fakeMesh) DropLink(peer string) {
	f.mu.Lock()
	delete(f.dialed, peer)
	f.mu.Unlock()
}
func (f *fakeMesh) SetDirectNeeded(fn func(string)) {
	f.mu.Lock()
	f.directNeeded = fn
	f.mu.Unlock()
}
func (f *fakeMesh) SetLinkClosed(fn func(string, tunhandler.MeshCloseReason)) {
	f.mu.Lock()
	f.linkClosed = fn
	f.mu.Unlock()
}
func (f *fakeMesh) MeshStatus() []tunhandler.MeshPeerStatus {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]tunhandler.MeshPeerStatus, 0, len(f.members))
	for _, m := range f.members {
		state := "hub"
		if m.Blocked {
			state = "blocked"
		} else if m.Disabled {
			state = "disabled"
		} else if !m.Direct {
			state = "direct-off"
		} else if f.dialed[m.Key] {
			state = "direct"
		}
		out = append(out, tunhandler.MeshPeerStatus{Key: m.Key, State: state})
	}
	return out
}
func (f *fakeMesh) MeshCounters() tunhandler.MeshCounters { return tunhandler.MeshCounters{} }
func (f *fakeMesh) Close() error {
	f.mu.Lock()
	f.closed = true
	for _, c := range f.hubLinks {
		_ = c.Close()
	}
	f.mu.Unlock()
	return nil
}

func (f *fakeMesh) notifyClosed(peer string) {
	f.mu.Lock()
	fn := f.linkClosed
	f.mu.Unlock()
	if fn != nil {
		fn(peer, tunhandler.MeshCloseRemote)
	}
}

func (f *fakeMesh) hubCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.hubLinks)
}

func (f *fakeMesh) deviceCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.devices)
}

func TestDirectRuntimeHubLinkRedials(t *testing.T) {
	mesh := &fakeMesh{}
	route, err := tunnel.RegisterMeshRoute(nil)
	if err != nil {
		t.Fatalf("RegisterMeshRoute: %v", err)
	}
	dialed := make(chan net.Conn, 4)
	runtime := newDirectRuntime(nil, mesh, route, "local-key", "hub-key",
		func(context.Context) (net.Conn, error) {
			a, b := net.Pipe()
			t.Cleanup(func() { _ = b.Close() })
			dialed <- a
			return a, nil
		}, nil)

	runtime.start()
	t.Cleanup(func() { _ = runtime.Close() })

	select {
	case <-dialed:
	case <-time.After(2 * time.Second):
		t.Fatal("hub link was never dialled")
	}
	mesh.notifyClosed("not-the-hub") // must not redial
	mesh.notifyClosed("hub-key")

	select {
	case <-dialed:
	case <-time.After(3 * time.Second):
		t.Fatal("hub link was not redialled after its close")
	}
	// The dial returned before the loop handed the conn to SetHubLink; wait
	// for that handoff rather than asserting on the same instant.
	deadline := time.Now().Add(2 * time.Second)
	for mesh.hubCount() != 2 {
		if time.Now().After(deadline) {
			t.Fatalf("hub links installed = %d, want 2", mesh.hubCount())
		}
		time.Sleep(10 * time.Millisecond)
	}
}

type oneListener struct {
	mu    sync.Mutex
	conn  net.Conn
	once  bool
	close chan struct{}
}

func newOneListener(conn net.Conn) *oneListener {
	return &oneListener{conn: conn, close: make(chan struct{})}
}

func (l *oneListener) Init(md.Metadata) error { return nil }
func (l *oneListener) Accept() (net.Conn, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.once {
		l.once = true
		return l.conn, nil
	}
	<-l.close
	return nil, net.ErrClosed
}
func (l *oneListener) Addr() net.Addr { return &net.TCPAddr{} }
func (l *oneListener) Close() error {
	select {
	case <-l.close:
	default:
		close(l.close)
	}
	return nil
}

func TestDirectSupervisorKeepsAcceptingDevices(t *testing.T) {
	a, b := net.Pipe()
	defer b.Close()
	ln := newOneListener(a)
	mesh := &fakeMesh{}
	ep := &tunEntryPoint{}

	done := make(chan struct{})
	go func() {
		ep.superviseDevice(context.Background(), ln, mesh, nil)
		close(done)
	}()
	// The fake RunDevice closes the first device, so the supervisor goes back
	// to Accept; Close releases the second Accept.
	time.Sleep(50 * time.Millisecond)
	if err := ln.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("supervisor did not stop with its listener")
	}
	if got := mesh.deviceCount(); got != 1 {
		t.Fatalf("RunDevice calls = %d, want 1", got)
	}
}

func TestDeviceIPs(t *testing.T) {
	got, err := deviceIPs("10.10.0.2/24, fd00::2/64")
	if err != nil {
		t.Fatalf("deviceIPs: %v", err)
	}
	if len(got) != 2 || got[0].String() != "10.10.0.2" || got[1].String() != "fd00::2" {
		t.Fatalf("deviceIPs = %v", got)
	}
	if _, err := deviceIPs("not-an-address/24"); err == nil {
		t.Fatal("deviceIPs accepted an invalid address")
	}
}

type fakeHost struct {
	mu      sync.Mutex
	punches int
	dials   int
	err     error
	conns   []net.Conn
}

func (f *fakeHost) PunchContext(context.Context, string) error {
	f.mu.Lock()
	f.punches++
	f.mu.Unlock()
	return nil
}

func (f *fakeHost) Dial(context.Context, string, string) (net.Conn, error) {
	f.mu.Lock()
	f.dials++
	err := f.err
	f.mu.Unlock()
	if err != nil {
		return nil, err
	}
	a, b := net.Pipe()
	f.mu.Lock()
	f.conns = append(f.conns, b)
	f.mu.Unlock()
	return a, nil
}

func (f *fakeHost) counts() (int, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.punches, f.dials
}

func TestDirectManagerDialsOnDemand(t *testing.T) {
	mesh := &fakeMesh{}
	route, err := tunnel.RegisterMeshRoute(nil)
	if err != nil {
		t.Fatalf("RegisterMeshRoute: %v", err)
	}
	host := &fakeHost{}
	runtime := newDirectRuntime(host, mesh, route, "local-key", "hub-key", nil, nil)
	runtime.start()
	t.Cleanup(func() { _ = runtime.Close() })

	runtime.Refresh([]tunnel.NetviewMember{
		{Key: "peer", IP: "10.0.0.2", Direct: true},
	}, nil, nil)
	if got := route.Peers(); !slices.Equal(got, []string{"peer"}) {
		t.Fatalf("route peers = %v, want [peer]", got)
	}

	runtime.onNeeded("peer")
	deadline := time.Now().Add(2 * time.Second)
	for {
		mesh.mu.Lock()
		dialed := mesh.dialed["peer"]
		mesh.mu.Unlock()
		if dialed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("AddDialedLink was not called")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, dials := host.counts(); dials != 1 {
		t.Fatalf("dials = %d, want 1", dials)
	}
	runtime.onNeeded("peer")
	time.Sleep(100 * time.Millisecond)
	if _, dials := host.counts(); dials != 1 {
		t.Fatalf("a second onNeeded dialled again: %d", dials)
	}
}

func TestDirectManagerSkipsBlockedDisabledSelfHub(t *testing.T) {
	mesh := &fakeMesh{}
	route, err := tunnel.RegisterMeshRoute(nil)
	if err != nil {
		t.Fatalf("RegisterMeshRoute: %v", err)
	}
	host := &fakeHost{}
	runtime := newDirectRuntime(host, mesh, route, "self", "hub-key", nil, nil)
	runtime.start()
	t.Cleanup(func() { _ = runtime.Close() })

	runtime.Refresh([]tunnel.NetviewMember{
		{Key: "blocked", IP: "10.0.0.2", Direct: true},
		{Key: "disabled", IP: "10.0.0.3", Direct: true, Disabled: true},
		{Key: "self", IP: "10.0.0.4", Direct: true},
		{Key: "hub-key", IP: "10.0.0.1", Direct: true},
	}, nil, []string{"blocked"})
	for _, key := range []string{"blocked", "disabled", "self", "hub-key"} {
		runtime.onNeeded(key)
	}
	time.Sleep(100 * time.Millisecond)
	if _, dials := host.counts(); dials != 0 {
		t.Fatalf("ineligible peers dialled: %d", dials)
	}
	if got := route.Peers(); len(got) != 0 {
		t.Fatalf("route claimed ineligible peers: %v", got)
	}
	// "self" is a netview member key equal to the local key, not the hub's
	// address; the local key is skipped by Refresh.
	for _, m := range mesh.members {
		if m.Key == "self" && m.Direct {
			t.Fatalf("local member was marked direct: %+v", m)
		}
	}
}

func TestDirectManagerBacksOff(t *testing.T) {
	mesh := &fakeMesh{}
	route, err := tunnel.RegisterMeshRoute(nil)
	if err != nil {
		t.Fatalf("RegisterMeshRoute: %v", err)
	}
	host := &fakeHost{err: errors.New("dial failed")}
	runtime := newDirectRuntime(host, mesh, route, "local-key", "hub-key", nil, nil)
	runtime.backoffSteps = []time.Duration{20 * time.Millisecond, time.Hour}
	runtime.start()
	t.Cleanup(func() { _ = runtime.Close() })
	runtime.Refresh([]tunnel.NetviewMember{{Key: "peer", IP: "10.0.0.2", Direct: true}}, nil, nil)

	runtime.onNeeded("peer")
	deadline := time.Now().Add(time.Second)
	for {
		if _, dials := host.counts(); dials == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("first dial did not happen")
		}
		time.Sleep(5 * time.Millisecond)
	}
	// The first failure schedules the short backoff; a second signal before it
	// expires must not dial again.
	runtime.onNeeded("peer")
	time.Sleep(5 * time.Millisecond)
	if _, dials := host.counts(); dials != 1 {
		t.Fatalf("dial before backoff expiry: %d", dials)
	}
	time.Sleep(30 * time.Millisecond)
	runtime.onNeeded("peer")
	deadline = time.Now().Add(time.Second)
	for {
		if _, dials := host.counts(); dials == 2 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("dial after backoff expiry did not happen")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestDirectManagerRefreshesMembership(t *testing.T) {
	mesh := &fakeMesh{}
	route, err := tunnel.RegisterMeshRoute(nil)
	if err != nil {
		t.Fatalf("RegisterMeshRoute: %v", err)
	}
	host := &fakeHost{}
	runtime := newDirectRuntime(host, mesh, route, "local-key", "hub-key", nil, nil)
	runtime.start()
	t.Cleanup(func() { _ = runtime.Close() })

	members := []tunnel.NetviewMember{{Key: "peer", IP: "10.0.0.2", Direct: true}}
	runtime.Refresh(members, nil, nil)
	runtime.onNeeded("peer")
	waitFor(t, func() bool {
		mesh.mu.Lock()
		defer mesh.mu.Unlock()
		return mesh.dialed["peer"]
	}, "peer was not dialled")

	runtime.Refresh(members, nil, []string{"peer"})
	if got := route.Peers(); len(got) != 0 {
		t.Fatalf("blocked peer stayed in the mesh route: %v", got)
	}
	mesh.mu.Lock()
	blocked := len(mesh.members) == 1 && mesh.members[0].Blocked && !mesh.members[0].Direct
	dialed := mesh.dialed["peer"]
	mesh.mu.Unlock()
	if !blocked {
		t.Fatalf("mesh member was not marked blocked: %+v", mesh.members)
	}
	if dialed {
		t.Fatal("blocked peer kept its direct link")
	}
}

func waitFor(t *testing.T, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal(msg)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
