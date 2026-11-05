package tunnel

import (
	"bytes"
	"io"
	"net"
	"net/netip"
	"testing"
	"time"
)

func ipv4Packet(t *testing.T, src, dst string) []byte {
	t.Helper()
	s := netip.MustParseAddr(src).As4()
	d := netip.MustParseAddr(dst).As4()
	pkt := make([]byte, 20)
	pkt[0] = 0x45 // IPv4, 5 words
	pkt[2], pkt[3] = 0, 20
	copy(pkt[12:16], s[:])
	copy(pkt[16:20], d[:])
	return pkt
}

func ipv6Packet(t *testing.T, src, dst string) []byte {
	t.Helper()
	s := netip.MustParseAddr(src).As16()
	d := netip.MustParseAddr(dst).As16()
	pkt := make([]byte, 40)
	pkt[0] = 0x60 // IPv6
	pkt[4], pkt[5] = 0, 40
	copy(pkt[8:24], s[:])
	copy(pkt[24:40], d[:])
	return pkt
}

func filterWith(t *testing.T, blocked ...string) *PeerFilter {
	t.Helper()
	f := NewPeerFilter()
	f.SetPolicy(
		[]NetviewMember{
			{IP: "10.0.0.1", Key: "a"},
			{IP: "10.0.0.2", Key: "b"},
			{IP: "10.0.0.3", Key: "c"},
			{IP: "fd00::2", Key: "b6"},
			{IP: "fd00::3", Key: "c6"},
		},
		[]NetviewClaim{
			{Prefix: "192.168.50.0/24", Origin: "b"},
			{Prefix: "192.168.50.128/25", Origin: "c"},
			{Prefix: "fd00:50::/64", Origin: "b6"},
		},
		blocked,
	)
	return f
}

func TestPeerFilterBlocksTunIP(t *testing.T) {
	f := filterWith(t, "b")

	if !f.BlockedSrc(ipv4Packet(t, "10.0.0.2", "10.0.0.1")) {
		t.Fatal("inbound packet from a blocked member must be blocked")
	}
	if !f.BlockedDst(ipv4Packet(t, "10.0.0.1", "10.0.0.2")) {
		t.Fatal("outbound packet to a blocked member must be blocked")
	}
	if f.BlockedSrc(ipv4Packet(t, "10.0.0.3", "10.0.0.1")) {
		t.Fatal("an unblocked member must pass")
	}
	if f.BlockedDst(ipv4Packet(t, "10.0.0.1", "10.0.0.3")) {
		t.Fatal("an unblocked destination must pass")
	}
}

func TestPeerFilterBlocksLANPrefix(t *testing.T) {
	f := filterWith(t, "b")

	if !f.BlockedSrc(ipv4Packet(t, "192.168.50.10", "10.0.0.1")) {
		t.Fatal("a source inside a blocked member's LAN must be blocked")
	}
	if !f.BlockedDst(ipv4Packet(t, "10.0.0.1", "192.168.50.10")) {
		t.Fatal("a destination inside a blocked member's LAN must be blocked")
	}
	// The /25 is peer c's more specific claim inside peer b's blocked /24.
	// Longest-prefix ownership says c's allowed claim wins.
	if f.BlockedSrc(ipv4Packet(t, "192.168.50.200", "10.0.0.1")) {
		t.Fatal("a more specific allowed claim must not be blocked by a broader blocked claim")
	}
	if f.BlockedDst(ipv4Packet(t, "10.0.0.1", "192.168.50.200")) {
		t.Fatal("a more specific allowed destination must not be blocked")
	}
}

func TestPeerFilterExactMemberBeatsBroaderClaim(t *testing.T) {
	f := NewPeerFilter()
	f.SetPolicy(
		[]NetviewMember{
			{IP: "10.0.0.1", Key: "a"},
			{IP: "10.0.0.3", Key: "c"},
		},
		[]NetviewClaim{{Prefix: "10.0.0.0/24", Origin: "b"}},
		[]string{"b"},
	)
	// c is allowed even though b's blocked claim covers the same address:
	// the exact member ownership is the more specific statement.
	if f.BlockedDst(ipv4Packet(t, "10.0.0.1", "10.0.0.3")) {
		t.Fatal("an exact allowed member must beat a broader blocked claim")
	}
}

func TestPeerFilterIPv6AndMalformed(t *testing.T) {
	f := filterWith(t, "b6")
	if !f.BlockedSrc(ipv6Packet(t, "fd00::2", "fd00::3")) {
		t.Fatal("an IPv6 blocked member must be blocked")
	}
	if !f.BlockedDst(ipv6Packet(t, "fd00::3", "fd00::2")) {
		t.Fatal("an IPv6 blocked destination must be blocked")
	}
	if !f.BlockedSrc(ipv6Packet(t, "fd00:50::9", "fd00::3")) {
		t.Fatal("an IPv6 blocked claim must be blocked")
	}
	for _, pkt := range [][]byte{nil, {}, {0x45}, {0x60}, []byte("not an ip packet")} {
		if f.BlockedSrc(pkt) || f.BlockedDst(pkt) {
			t.Fatalf("malformed packet %x must pass, not be blocked", pkt)
		}
	}
}

func TestPeerFilterEmptyPassthrough(t *testing.T) {
	pkt := ipv4Packet(t, "10.0.0.2", "10.0.0.1")
	under := &scriptConn{reads: [][]byte{pkt}}
	wrapped := NewPeerFilter().Wrap(under)

	var buf [64]byte
	n, err := wrapped.Read(buf[:])
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if !bytes.Equal(buf[:n], pkt) {
		t.Fatalf("Read returned %x, want the untouched packet", buf[:n])
	}
	if got := under.readsSeen; got != 1 {
		t.Fatalf("underlying reads = %d, want 1 (empty filter must not drop)", got)
	}

	if _, err := wrapped.Write(pkt); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if under.writesSeen != 1 {
		t.Fatalf("underlying writes = %d, want 1", under.writesSeen)
	}
	if got := wrapped.(*filterConn).filter.BlockedPackets(); got != 0 {
		t.Fatalf("empty filter counted %d blocked packets, want 0", got)
	}

	deadline := time.Now().Add(time.Minute)
	if err := wrapped.SetReadDeadline(deadline); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	if !under.readDeadline.Equal(deadline) {
		t.Fatalf("read deadline = %v, want %v", under.readDeadline, deadline)
	}
	if wrapped.LocalAddr().String() != "local" || wrapped.RemoteAddr().String() != "remote" {
		t.Fatalf("addresses not delegated: %v/%v", wrapped.LocalAddr(), wrapped.RemoteAddr())
	}
	if err := wrapped.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if !under.closed {
		t.Fatal("Close was not delegated")
	}
}

func TestPeerFilterWrapsAndDrops(t *testing.T) {
	blockedOut := ipv4Packet(t, "10.0.0.1", "10.0.0.2") // device -> blocked peer
	allowedOut := ipv4Packet(t, "10.0.0.1", "10.0.0.3") // device -> allowed peer
	blockedIn := ipv4Packet(t, "10.0.0.2", "10.0.0.1")  // blocked peer -> device
	allowedIn := ipv4Packet(t, "10.0.0.3", "10.0.0.1")  // allowed peer -> device
	f := filterWith(t, "b")
	under := &scriptConn{reads: [][]byte{blockedOut, allowedOut}}
	wrapped := f.Wrap(under)

	var buf [64]byte
	n, err := wrapped.Read(buf[:])
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if !bytes.Equal(buf[:n], allowedOut) {
		t.Fatalf("Read returned %x, want the allowed packet after dropping the blocked one", buf[:n])
	}
	if got := f.BlockedPackets(); got != 1 {
		t.Fatalf("blocked packet count = %d, want 1", got)
	}

	if n, err := wrapped.Write(blockedIn); err != nil || n != len(blockedIn) {
		t.Fatalf("Write blocked = (%d, %v), want (%d, nil)", n, err, len(blockedIn))
	}
	if under.writesSeen != 0 {
		t.Fatal("a blocked inbound packet must not reach the device")
	}
	if _, err := wrapped.Write(allowedIn); err != nil {
		t.Fatalf("Write allowed: %v", err)
	}
	if under.writesSeen != 1 {
		t.Fatalf("underlying writes = %d, want 1", under.writesSeen)
	}
	if got := f.BlockedPackets(); got != 2 {
		t.Fatalf("blocked packet count = %d, want 2", got)
	}
}

func TestPeerFilterPolicyReplace(t *testing.T) {
	f := filterWith(t, "b")
	if !f.BlockedSrc(ipv4Packet(t, "10.0.0.2", "10.0.0.1")) {
		t.Fatal("setup: b must be blocked")
	}
	f.SetPolicy(nil, nil, nil)
	if f.BlockedSrc(ipv4Packet(t, "10.0.0.2", "10.0.0.1")) {
		t.Fatal("a cleared policy must pass the previously blocked peer")
	}
	if got := f.BlockedPackets(); got != 0 {
		t.Fatalf("clearing the policy reset or changed the cumulative counter: %d", got)
	}
}

// scriptConn is a deterministic net.Conn for filter tests: reads come from a
// fixed list, writes are recorded, and the deadline/address methods are
// delegated observably.
type scriptConn struct {
	reads         [][]byte
	readsSeen     int
	writes        [][]byte
	writesSeen    int
	readDeadline  time.Time
	writeDeadline time.Time
	closed        bool
}

func (c *scriptConn) Read(p []byte) (int, error) {
	if c.readsSeen >= len(c.reads) {
		return 0, io.EOF
	}
	pkt := c.reads[c.readsSeen]
	c.readsSeen++
	return copy(p, pkt), nil
}

func (c *scriptConn) Write(p []byte) (int, error) {
	c.writes = append(c.writes, append([]byte(nil), p...))
	c.writesSeen++
	return len(p), nil
}

func (c *scriptConn) Close() error         { c.closed = true; return nil }
func (c *scriptConn) LocalAddr() net.Addr  { return testAddr("local") }
func (c *scriptConn) RemoteAddr() net.Addr { return testAddr("remote") }
func (c *scriptConn) SetDeadline(t time.Time) error {
	c.readDeadline, c.writeDeadline = t, t
	return nil
}
func (c *scriptConn) SetReadDeadline(t time.Time) error  { c.readDeadline = t; return nil }
func (c *scriptConn) SetWriteDeadline(t time.Time) error { c.writeDeadline = t; return nil }

type testAddr string

func (a testAddr) Network() string { return "test" }
func (a testAddr) String() string  { return string(a) }

var _ net.Conn = (*scriptConn)(nil)
