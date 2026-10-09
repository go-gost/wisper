package tunnel

import (
	"net"
	"strings"
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
	st := &fakeShareStack{out: make(chan []byte, 8)}
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
	st.mu.Lock()
	if len(st.inputs) != 1 || string(st.inputs[0]) != string(lanTCP) {
		st.mu.Unlock()
		t.Fatalf("stack inputs = %d, want 1 LAN TCP", len(st.inputs))
	}
	st.mu.Unlock()

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

	// Close tears the stack down with the shim.
	if err := conn.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	st.mu.Lock()
	closed := st.closed
	st.mu.Unlock()
	if !closed {
		t.Fatal("stack not closed with the shim")
	}
}
