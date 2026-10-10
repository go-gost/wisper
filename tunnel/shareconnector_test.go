package tunnel

import (
	"context"
	"net"
	"testing"
	"time"

	mdx "github.com/go-gost/x/metadata"
	"github.com/go-gost/x/registry"
)

// The spoke's engine resolves the node's connector by name from x's registry,
// so a type nobody registered is a chain that cannot be parsed at all — the
// connector has to be reachable as "tun-share" before any spoke can start on
// the userspace path.
func TestShareConnectorRegistersAndWraps(t *testing.T) {
	if registry.ConnectorRegistry().Get("tun-share") == nil {
		t.Fatal(`"tun-share" is not registered: a userspace spoke's chain cannot be parsed`)
	}

	st := newSpokeStack()
	var gotMTU int
	c := NewShareConnector().(*shareConnector)
	c.newStack = func(mtu int) ShareStackBackend {
		gotMTU = mtu
		return st
	}
	if err := c.Init(mdx.NewMetadata(map[string]any{
		"lans": "192.168.50.0/24",
		"mtu":  1420,
	})); err != nil {
		t.Fatalf("Init: %v", err)
	}

	local, chain := net.Pipe()
	defer local.Close()

	conn, err := c.Connect(context.Background(), chain, "tcp", "192.168.50.7:80")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if conn == nil {
		t.Fatal("Connect returned a nil conn")
	}
	defer conn.Close()
	if gotMTU != 1420 {
		t.Fatalf("stack mtu = %d, want 1420 (the entrypoint's device mtu)", gotMTU)
	}

	// The shim classifies reads: a LAN-bound TCP off the chain enters the
	// stack, a virtual packet is handed to the caller untouched, and a LAN
	// ping is dropped and counted. net.Pipe is synchronous, so the chain
	// writes all run in one goroutine, ahead of the shim's reads.
	lanTCP := v4(6, "192.168.50.7")
	virt := v4(6, "10.10.0.5")
	icmp := v4(1, "192.168.50.7")
	wrote := make(chan error, 1)
	go func() {
		for _, pkt := range [][]byte{lanTCP, virt, icmp} {
			if _, err := local.Write(pkt); err != nil {
				wrote <- err
				return
			}
		}
		wrote <- nil
	}()

	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	buf := make([]byte, 1500)
	n, err := conn.Read(buf)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if string(buf[:n]) != string(virt) {
		t.Fatalf("Read = %x, want the virtual packet %x", buf[:n], virt)
	}
	if got := st.inputCount(); got != 1 {
		t.Fatalf("stack inputs = %d, want 1 LAN TCP", got)
	}
	if got := st.inputs[0]; string(got) != string(lanTCP) {
		t.Errorf("stack input = %x, want the LAN TCP %x", got, lanTCP)
	}

	// The stack's replies are merged back into the chain's write side, where
	// the hub routes them by destination like any other packet.
	reply := v4(6, "10.10.0.5")
	st.out <- reply
	if err := local.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("local SetReadDeadline: %v", err)
	}
	got := make([]byte, 1500)
	m, err := local.Read(got)
	if err != nil {
		t.Fatalf("chain read stack reply: %v", err)
	}
	if string(got[:m]) != string(reply) {
		t.Fatalf("chain got %x, want the stack reply %x", got[:m], reply)
	}

	// Ping to the LAN is the same counted drop the hub shows, never a packet
	// delivered to the engine.
	if err := conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	if _, err := conn.Read(buf); err == nil {
		t.Fatal("Read delivered the LAN ping, want a timeout")
	}
	if got := conn.(*chainShareConn).s.Dropped(); got != 1 {
		t.Fatalf("dropped = %d, want 1", got)
	}

	// Closing the conn tears the stack down exactly once.
	if err := conn.Close(); err != nil {
		t.Fatalf("conn.Close: %v", err)
	}
	if got := st.closeCount(); got != 1 {
		t.Fatalf("stack closes = %d, want exactly 1", got)
	}
	if err := <-wrote; err != nil {
		t.Fatalf("chain writes: %v", err)
	}
}

// A "tun-share" node that names no LAN is a config that shares nothing: it
// would pass every packet through untouched, which is what the plain
// "forward" connector already does. It is refused rather than run as a
// silently pointless hop.
func TestShareConnectorInitRejectsNoLans(t *testing.T) {
	for _, tc := range []struct {
		name string
		md   map[string]any
	}{
		{"missing", map[string]any{"mtu": 1400}},
		{"empty", map[string]any{"lans": "", "mtu": 1400}},
		{"malformed", map[string]any{"lans": "not-a-cidr"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := NewShareConnector().(*shareConnector)
			if err := c.Init(mdx.NewMetadata(tc.md)); err == nil {
				t.Fatal("Init = nil error, want a refusal")
			}
		})
	}
}

// One shim and one stack per Connect: the engine re-dials a chain that died,
// and a second Connect over a shared shim would hand it the first chain's
// conn (Wrap is guarded) — so an old conn's teardown would blackhole every
// packet of the new one.
func TestShareConnectorNewShimPerConnect(t *testing.T) {
	st1, st2 := newSpokeStack(), newSpokeStack()
	c := NewShareConnector().(*shareConnector)
	if err := c.Init(mdx.NewMetadata(map[string]any{
		"lans": "192.168.50.0/24",
		"mtu":  1420,
	})); err != nil {
		t.Fatalf("Init: %v", err)
	}

	c.newStack = func(int) ShareStackBackend { return st1 }
	local1, chain1 := net.Pipe()
	defer local1.Close()
	conn1, err := c.Connect(context.Background(), chain1, "tcp", "192.168.50.7:80")
	if err != nil {
		t.Fatalf("first Connect: %v", err)
	}

	c.newStack = func(int) ShareStackBackend { return st2 }
	local2, chain2 := net.Pipe()
	defer local2.Close()
	conn2, err := c.Connect(context.Background(), chain2, "tcp", "192.168.50.8:80")
	if err != nil {
		t.Fatalf("second Connect: %v", err)
	}
	if conn1 == conn2 {
		t.Fatal("both Connects returned the same conn: the shim was reused")
	}
	defer conn2.Close()

	// The engine closing the first chain (a re-dial) must take nothing with
	// it: its stack closes, the second one stays untouched and open.
	if err := conn1.Close(); err != nil {
		t.Fatalf("first conn.Close: %v", err)
	}
	if got := st1.closeCount(); got != 1 {
		t.Fatalf("first stack closes = %d, want exactly 1", got)
	}
	if got := st2.closeCount(); got != 0 {
		t.Fatalf("second stack closes = %d, want 0 (the first teardown took it with it)", got)
	}

	// The second shim still works on its own chain: LAN TCP into its own
	// stack, a virtual packet through to the engine, and nothing (no
	// cross-talk) in the first stack.
	lanTCP := v4(6, "192.168.50.8")
	virt := v4(6, "10.10.0.5")
	wrote := make(chan error, 1)
	go func() {
		for _, pkt := range [][]byte{lanTCP, virt} {
			if _, err := local2.Write(pkt); err != nil {
				wrote <- err
				return
			}
		}
		wrote <- nil
	}()

	if err := conn2.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	buf := make([]byte, 1500)
	n, err := conn2.Read(buf)
	if err != nil {
		t.Fatalf("Read after the first chain closed: %v", err)
	}
	if string(buf[:n]) != string(virt) {
		t.Fatalf("Read = %x, want the virtual packet %x", buf[:n], virt)
	}
	if got := st2.inputCount(); got != 1 {
		t.Fatalf("second stack inputs = %d, want 1 LAN TCP", got)
	}
	if got := st1.inputCount(); got != 0 {
		t.Fatalf("first stack inputs = %d, want 0 (no cross-talk between shims)", got)
	}
	if err := <-wrote; err != nil {
		t.Fatalf("chain writes: %v", err)
	}

	if err := conn2.Close(); err != nil {
		t.Fatalf("second conn.Close: %v", err)
	}
	if got := st2.closeCount(); got != 1 {
		t.Fatalf("second stack closes = %d, want exactly 1", got)
	}
	if got := st1.closeCount(); got != 1 {
		t.Fatalf("first stack closes = %d, want still exactly 1", got)
	}
}
