package tunnel

import (
	"net"
	"testing"
	"time"
)

func v4From(proto byte, src, dst string) []byte {
	pkt := v4(proto, dst)
	copy(pkt[12:16], net.ParseIP(src).To4())
	return pkt
}

// TestShareShimBlocksInboundLAN: a packet from a locally blocked peer must be
// dropped before the userspace stack sees it. The block is enforced at the
// chain boundary, not left to the device filter, because the stack path never
// goes through the device filter on its way down.
func TestShareShimBlocksInboundLAN(t *testing.T) {
	st := newSpokeStack()
	filter := filterWith(t, "b")
	shim := NewChainShareShim([]*net.IPNet{mustIPNet(t, "192.168.50.0/24")}, st, filter)
	local, chain := net.Pipe()
	conn := shim.Wrap(chain)
	defer conn.Close()
	defer local.Close()

	blocked := v4From(6, "10.0.0.2", "192.168.50.7")
	allowed := v4From(6, "10.0.0.3", "192.168.50.7")
	wrote := make(chan error, 1)
	go func() {
		if _, err := local.Write(blocked); err != nil {
			wrote <- err
			return
		}
		_, err := local.Write(allowed)
		wrote <- err
	}()

	// Both are LAN TCP, so both are consumed by the stack loop and the
	// caller's Read ends in the deadline; the assertion is what the stack
	// received, not what Read returned.
	if err := conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	buf := make([]byte, 1500)
	if _, err := conn.Read(buf); err == nil {
		t.Fatal("Read returned a packet, want the deadline after both LAN packets")
	}
	if err := <-wrote; err != nil {
		t.Fatalf("chain writes: %v", err)
	}
	if got := st.inputCount(); got != 1 {
		t.Fatalf("stack inputs = %d, want only the allowed packet", got)
	}
	if got := shim.Dropped(); got != 1 {
		t.Fatalf("dropped = %d, want the blocked packet counted", got)
	}
	if got := filter.BlockedPackets(); got != 1 {
		t.Fatalf("filter blocked packets = %d, want 1", got)
	}
}

// TestShareShimBlocksOutbound: both a device write and a stack reply addressed
// to a blocked peer are refused before they reach the chain.
func TestShareShimBlocksOutbound(t *testing.T) {
	st := newSpokeStack()
	filter := filterWith(t, "b")
	shim := NewChainShareShim([]*net.IPNet{mustIPNet(t, "192.168.50.0/24")}, st, filter)
	local, chain := net.Pipe()
	conn := shim.Wrap(chain)
	defer conn.Close()
	defer local.Close()

	blocked := v4From(6, "10.0.0.1", "10.0.0.2")
	allowed := v4From(6, "10.0.0.1", "10.0.0.3")
	if n, err := conn.Write(blocked); err != nil || n != len(blocked) {
		t.Fatalf("Write blocked = (%d, %v), want (%d, nil)", n, err, len(blocked))
	}
	if err := local.SetReadDeadline(time.Now().Add(200 * time.Millisecond)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	buf := make([]byte, 1500)
	if _, err := local.Read(buf); err == nil {
		t.Fatal("a blocked outbound packet reached the chain")
	}
	if got := shim.Dropped(); got != 1 {
		t.Fatalf("dropped = %d, want 1 after the device write", got)
	}

	// A stack reply to the same blocked peer follows the pumpStack path.
	st.out <- blocked
	if err := local.SetReadDeadline(time.Now().Add(300 * time.Millisecond)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	if _, err := local.Read(buf); err == nil {
		t.Fatal("a blocked stack reply reached the chain")
	}
	if got := shim.Dropped(); got != 2 {
		t.Fatalf("dropped = %d, want 2 after the stack reply", got)
	}

	// An allowed peer is still carried through. net.Pipe is synchronous, so
	// the write must run alongside the read.
	wrote := make(chan error, 1)
	go func() {
		_, err := conn.Write(allowed)
		wrote <- err
	}()
	if err := local.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	n, err := local.Read(buf)
	if err != nil {
		t.Fatalf("read allowed packet: %v", err)
	}
	if err := <-wrote; err != nil {
		t.Fatalf("Write allowed: %v", err)
	}
	if string(buf[:n]) != string(allowed) {
		t.Fatalf("chain got %x, want the allowed packet %x", buf[:n], allowed)
	}
}
