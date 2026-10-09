package tunnel

import (
	"errors"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// runner records shareRunner invocations into ran, the fake setup tests
// inject via the spokeShareRun seam.
func runner(ran *[]string) shareRunner {
	return func(name string, args ...string) error {
		*ran = append(*ran, name+" "+strings.Join(args, " "))
		return nil
	}
}

// useShareRunner points SetupSpokeShare at a recording fake for one test.
func useShareRunner(t *testing.T, ran *[]string) {
	t.Helper()
	old := spokeShareRun
	spokeShareRun = runner(ran)
	t.Cleanup(func() { spokeShareRun = old })
}

func mustIPNet(t *testing.T, s string) *net.IPNet {
	t.Helper()
	_, ipNet, err := net.ParseCIDR(s)
	if err != nil {
		t.Fatalf("ParseCIDR(%q): %v", s, err)
	}
	return ipNet
}

// spokeStack is the spoke shim's fake ShareStackBackend. Unlike the shared
// fakeShareStack it does not mask double closes: the real shareStack closes
// ep.done (sharegvisor.go:310), which panics on a second call — so this one
// panics the same way and records its closes for the assertions.
type spokeStack struct {
	mu     sync.Mutex
	inputs [][]byte
	closes int
	out    chan []byte
}

func newSpokeStack() *spokeStack {
	return &spokeStack{out: make(chan []byte, 8)}
}

func (s *spokeStack) write(pkt []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.inputs = append(s.inputs, append([]byte(nil), pkt...))
}

func (s *spokeStack) output() <-chan []byte { return s.out }

func (s *spokeStack) close() {
	s.mu.Lock()
	s.closes++
	n := s.closes
	s.mu.Unlock()
	if n > 1 {
		panic("share stack closed more than once")
	}
}

func (s *spokeStack) closeCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closes
}

func (s *spokeStack) inputCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.inputs)
}

// The rules a spoke needs are the hub's own with the roles swapped: the
// hubNet the hub masquerades from is the hub's subnet here, the claimed
// LAN is the destination, and no route is added — the LAN is directly
// connected, so only SNAT is missing.
func TestSpokeShareRulesMatchHubShape(t *testing.T) {
	var ran []string
	useShareRunner(t, &ran)

	eff, cleanup, err := SetupSpokeShare("10.10.100.0/24",
		[]*net.IPNet{mustIPNet(t, "192.168.50.0/24")}, ShareAuto, true)
	if err != nil {
		t.Fatalf("SetupSpokeShare: %v", err)
	}
	if eff != ShareKernel {
		t.Fatalf("effective = %q, want %q", eff, ShareKernel)
	}
	if cleanup == nil {
		t.Fatal("cleanup = nil, want a teardown for the applied rules")
	}

	want := []string{
		"iptables -t nat -A POSTROUTING -s 10.10.100.0/24 -d 192.168.50.0/24 -j MASQUERADE",
		"iptables -A FORWARD -s 10.10.100.0/24 -d 192.168.50.0/24 -j ACCEPT",
		"iptables -A FORWARD -s 192.168.50.0/24 -d 10.10.100.0/24 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT",
	}
	if len(ran) != len(want) {
		t.Fatalf("applied %d commands %v, want %d", len(ran), ran, len(want))
	}
	for i, c := range ran {
		if c != want[i] {
			t.Errorf("command[%d] = %q, want %q", i, c, want[i])
		}
		if strings.Contains(c, " route ") || strings.Contains(c, "ip route") {
			t.Errorf("command[%d] = %q: a directly-connected LAN needs no route", i, c)
		}
	}

	// cleanup mirrors apply: the same rules as deletes, newest first.
	applied := len(ran)
	cleanup()
	if len(ran) != 2*applied {
		t.Fatalf("cleanup added %d commands, want %d (mirror of apply)",
			len(ran)-applied, applied)
	}
	for i, c := range ran[applied:] {
		if !strings.Contains(c, " -D ") {
			t.Errorf("cleanup command[%d] = %q, want only -D", i, c)
		}
	}
	if ran[len(ran)-1] != strings.Replace(want[0], " -A ", " -D ", 1) {
		t.Errorf("cleanup did not delete newest-first: last = %q", ran[len(ran)-1])
	}

	// The hub's downgrade semantics, on the spoke's API: a pinned kernel
	// that cannot run is a start failure, never a silent downgrade, and it
	// applies nothing on the way out.
	if _, _, err := SetupSpokeShare("10.10.100.0/24",
		[]*net.IPNet{mustIPNet(t, "192.168.50.0/24")}, ShareKernel, false); err == nil {
		t.Fatal("pinned kernel without kernel path = nil error, want start failure")
	}
	if len(ran) != 2*applied {
		t.Fatalf("failed setup ran %v, want nothing applied", ran[2*applied:])
	}
}

// No iptables: the mode degrades to userspace with no kernel commands, and
// the shim routes a LAN-bound TCP into the stack while a non-LAN packet
// passes through untouched; a stack reply travels back up the chain.
func TestSpokeShareFallsBackToUserspace(t *testing.T) {
	var ran []string
	useShareRunner(t, &ran)

	eff, cleanup, err := SetupSpokeShare("10.10.100.0/24",
		[]*net.IPNet{mustIPNet(t, "192.168.50.0/24")}, ShareAuto, false)
	if err != nil {
		t.Fatalf("SetupSpokeShare: %v", err)
	}
	if eff != ShareUserspace || cleanup != nil {
		t.Fatalf("setup = (%q, nil=%v), want (userspace, nil)", eff, cleanup == nil)
	}
	if len(ran) != 0 {
		t.Fatalf("userspace fallback ran %v, want no kernel commands", ran)
	}

	// Drive the shim: chain carries a LAN TCP (into the stack), an ICMP
	// (dropped), and a virtual packet (through to the caller's Read).
	st := newSpokeStack()
	shim := NewChainShareShim([]*net.IPNet{mustIPNet(t, "192.168.50.0/24")}, st)
	local, chain := net.Pipe()
	conn := shim.Wrap(chain)
	defer conn.Close()

	// LAN-bound TCP written into the chain by the hub reaches the stack.
	// net.Pipe is synchronous, so the three chain writes run ahead of the
	// shim's reads in one goroutine.
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
		t.Fatalf("Read = %x, want the non-LAN packet %x", buf[:n], virt)
	}
	if got := st.inputCount(); got != 1 {
		t.Fatalf("stack inputs = %d, want 1 LAN TCP", got)
	}

	// ICMP to the LAN is dropped and counted, never delivered: the third
	// write is consumed silently, so this Read ends in the deadline.
	if err := conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	if _, err := conn.Read(buf); err == nil {
		t.Fatal("Read delivered a packet after ICMP drop, want timeout")
	}
	if got := shim.Dropped(); got != 1 {
		t.Fatalf("dropped = %d, want 1 (ping is counted, not silent)", got)
	}
	if err := <-wrote; err != nil {
		t.Fatalf("chain writes: %v", err)
	}

	// A stack reply is merged into the chain's write side: the local end
	// reads it, because it must travel back up the chain to the hub.
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

	// Every close path — conn twice, shim twice — tears the stack down
	// exactly once. The fake panics like the real stack on a second close.
	if err := conn.Close(); err != nil {
		t.Fatalf("conn.Close: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("second conn.Close: %v", err)
	}
	if err := shim.Close(); err != nil {
		t.Fatalf("shim.Close: %v", err)
	}
	if err := shim.Close(); err != nil {
		t.Fatalf("second shim.Close: %v", err)
	}
	if got := st.closeCount(); got != 1 {
		t.Fatalf("stack closes = %d, want exactly 1", got)
	}
}

// The stack is closed exactly once no matter which close path runs first
// or how often: conn.Close, shim.Close, repeated calls. Wrap is guarded —
// the same conn comes back, so no second pump starts on the chain.
func TestSpokeShareCloseClosesStackOnce(t *testing.T) {
	st := newSpokeStack()
	shim := NewChainShareShim(mustShareLans(t, "192.168.1.0/24"), st)
	local, chain := net.Pipe()
	defer local.Close()

	conn := shim.Wrap(chain)
	if again := shim.Wrap(chain); again != conn {
		t.Fatal("Wrap returned a different conn on the second call")
	}

	// Close the shim first, then the conn: reversed order, same result.
	if err := shim.Close(); err != nil {
		t.Fatalf("shim.Close: %v", err)
	}
	if err := shim.Close(); err != nil {
		t.Fatalf("second shim.Close: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("conn.Close: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("second conn.Close: %v", err)
	}
	if got := st.closeCount(); got != 1 {
		t.Fatalf("stack closes = %d, want exactly 1", got)
	}
}

// A chain write failure kills the reply pump: it must be reported, not
// swallowed. The first death error surfaces on Read and Write, and the
// stack is closed exactly once with it.
func TestSpokeSharePumpDeathSurfaces(t *testing.T) {
	st := newSpokeStack()
	shim := NewChainShareShim([]*net.IPNet{mustIPNet(t, "192.168.50.0/24")}, st)
	local, chain := net.Pipe()
	conn := shim.Wrap(chain)
	defer conn.Close()

	// The deadline must be set while the chain is still whole: a closed
	// pipe refuses SetReadDeadline. Read reports the death: EOF while the
	// pump is alive, the recorded chain write error once it died. A shim
	// that swallowed the death would loop on EOF forever — hence the cap.
	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}

	// Kill the chain from the far end: the pump's next reply write fails
	// with io.ErrClosedPipe while reads keep "working" (they see EOF).
	local.Close()
	st.out <- v4(6, "10.10.0.5")
	buf := make([]byte, 1500)
	deadline := time.Now().Add(2 * time.Second)
	var readErr error
	for {
		if _, readErr = conn.Read(buf); errors.Is(readErr, io.ErrClosedPipe) {
			break
		}
		if time.Now().After(deadline) {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if !errors.Is(readErr, io.ErrClosedPipe) {
		t.Fatalf("Read after pump death = %v, want the chain write error io.ErrClosedPipe", readErr)
	}
	// Write reports it too — nothing keeps looking healthy.
	if _, err := conn.Write(v4(6, "10.10.0.6")); !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("Write after pump death = %v, want the chain write error io.ErrClosedPipe", err)
	}
	// The counter ticked, and later close paths change nothing.
	if shim.PumpDeaths() != 1 {
		t.Fatalf("PumpDeaths = %d, want 1", shim.PumpDeaths())
	}
	if err := shim.Close(); err != nil {
		t.Fatalf("shim.Close after death: %v", err)
	}
	if got := st.closeCount(); got != 1 {
		t.Fatalf("stack closes = %d, want exactly 1", got)
	}
}

// Wrap writing chain and shutdown reading it must be ordered: two
// goroutines released by the same barrier, one Wraps while the other
// Closes. Without a shared lock this is the data race on s.chain —
// only -race can see it; the invariants below hold either way.
func TestSpokeShareWrapCloseRace(t *testing.T) {
	for i := 0; i < 20; i++ {
		st := newSpokeStack()
		shim := NewChainShareShim(mustShareLans(t, "192.168.1.0/24"), st)
		local, chain := net.Pipe()

		start := make(chan struct{})
		var wg sync.WaitGroup
		var conn net.Conn
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			conn = shim.Wrap(chain)
		}()
		go func() {
			defer wg.Done()
			<-start
			if err := shim.Close(); err != nil {
				t.Errorf("shim.Close: %v", err)
			}
		}()
		close(start)
		wg.Wait()
		local.Close()

		if conn == nil {
			t.Fatal("Wrap returned nil")
		}
		if got := st.closeCount(); got != 1 {
			t.Fatalf("iter %d: stack closes = %d, want exactly 1", i, got)
		}
		if again := shim.Wrap(chain); again != conn {
			t.Fatalf("iter %d: Wrap returned a different conn after the race", i)
		}
		if err := conn.Close(); err != nil {
			t.Fatalf("iter %d: conn.Close: %v", i, err)
		}
		if got := st.closeCount(); got != 1 {
			t.Fatalf("iter %d: stack closes after conn.Close = %d, want exactly 1", i, got)
		}
	}
}

// "Wrap racing pump death", probed: the pump starts via `go` at the end
// of Wrap's once body, so the go statement orders every access it makes
// (including shutdown's read of chain) after Wrap's write — the pair is
// reachable only as an ordered sequence, never as a data race. This runs
// it under -race anyway and pins the invariants: the death is reported
// and the stack still closes exactly once.
func TestSpokeShareWrapPumpDeathRace(t *testing.T) {
	st := newSpokeStack()
	shim := NewChainShareShim([]*net.IPNet{mustIPNet(t, "192.168.50.0/24")}, st)
	local, chain := net.Pipe()
	local.Close() // the chain is already dead when the pump first writes

	start := make(chan struct{})
	var wg sync.WaitGroup
	var conn net.Conn
	wg.Add(1)
	go func() {
		defer wg.Done()
		<-start
		conn = shim.Wrap(chain)
	}()
	st.out <- v4(6, "10.10.0.5") // buffered: waiting for the pump, not it
	close(start)
	wg.Wait()

	deadline := time.Now().Add(2 * time.Second)
	for shim.PumpDeaths() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("pump death not reported")
		}
		time.Sleep(time.Millisecond)
	}
	if conn == nil {
		t.Fatal("Wrap returned nil")
	}
	if got := st.closeCount(); got != 1 {
		t.Fatalf("stack closes = %d, want exactly 1", got)
	}
	if err := shim.Close(); err != nil {
		t.Fatalf("shim.Close after death: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("conn.Close after death: %v", err)
	}
	if got := st.closeCount(); got != 1 {
		t.Fatalf("stack closes after close paths = %d, want exactly 1", got)
	}
}

// Close alone must release a reader blocked in chain.Read: the deadline
// is set 30s out, so only Close's poke — not the deadline itself — can
// wake it, and the reader must see the shim's cause, not the poke.
func TestSpokeShareCloseUnblocksRead(t *testing.T) {
	st := newSpokeStack()
	shim := NewChainShareShim(mustShareLans(t, "192.168.1.0/24"), st)
	local, chain := net.Pipe()
	defer local.Close()
	conn := shim.Wrap(chain)
	defer conn.Close()

	if err := conn.SetReadDeadline(time.Now().Add(30 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	res := make(chan error, 1)
	go func() {
		_, err := conn.Read(make([]byte, 1500))
		res <- err
	}()
	time.Sleep(50 * time.Millisecond) // let the reader park in chain.Read

	if err := shim.Close(); err != nil {
		t.Fatalf("shim.Close: %v", err)
	}
	select {
	case err := <-res:
		if !errors.Is(err, net.ErrClosed) {
			t.Fatalf("blocked Read after Close = %v, want net.ErrClosed (the cause, not the poke)", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not release the blocked Read within 2s")
	}
	if got := st.closeCount(); got != 1 {
		t.Fatalf("stack closes = %d, want exactly 1", got)
	}
}

// Close winning before Wrap: the reversed order must not crash, double
// close, or hand back a conn that looks alive — and under -race it must
// not race either (chain is read by shutdown only under the shared lock).
func TestSpokeShareWrapAfterClose(t *testing.T) {
	st := newSpokeStack()
	shim := NewChainShareShim(mustShareLans(t, "192.168.1.0/24"), st)
	local, chain := net.Pipe()
	defer local.Close()

	if err := shim.Close(); err != nil {
		t.Fatalf("shim.Close: %v", err)
	}
	conn := shim.Wrap(chain)
	if conn == nil {
		t.Fatal("Wrap after Close returned nil")
	}
	if _, err := conn.Read(make([]byte, 1500)); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("Read on a shim closed before Wrap = %v, want net.ErrClosed", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("conn.Close: %v", err)
	}
	if got := st.closeCount(); got != 1 {
		t.Fatalf("stack closes = %d, want exactly 1", got)
	}
}
