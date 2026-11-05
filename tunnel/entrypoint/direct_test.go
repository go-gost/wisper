package entrypoint

import (
	"context"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/go-gost/core/handler"
	md "github.com/go-gost/core/metadata"
	"github.com/go-gost/wisper/tunnel"
	tunhandler "github.com/go-gost/x/handler/tun"
)

type fakeMesh struct {
	mu         sync.Mutex
	hubLinks   []net.Conn
	devices    []net.Conn
	linkClosed func(string, tunhandler.MeshCloseReason)
	closed     bool
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

func (f *fakeMesh) SetMembers([]tunhandler.MeshMember) {}
func (f *fakeMesh) SetHubLink(conn net.Conn) {
	f.mu.Lock()
	f.hubLinks = append(f.hubLinks, conn)
	f.mu.Unlock()
}
func (f *fakeMesh) AddDialedLink(string, net.Conn) {}
func (f *fakeMesh) DropLink(string)                {}
func (f *fakeMesh) SetDirectNeeded(func(string))   {}
func (f *fakeMesh) SetLinkClosed(fn func(string, tunhandler.MeshCloseReason)) {
	f.mu.Lock()
	f.linkClosed = fn
	f.mu.Unlock()
}
func (f *fakeMesh) MeshStatus() []tunhandler.MeshPeerStatus { return nil }
func (f *fakeMesh) MeshCounters() tunhandler.MeshCounters   { return tunhandler.MeshCounters{} }
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
	runtime := newDirectRuntime(nil, mesh, route, "hub-key",
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
