package tunnel

import (
	"net"
	"testing"
)

func mustShareLans(t *testing.T, spec string) []*net.IPNet {
	t.Helper()
	lans, err := ParseShareLANNets(spec)
	if err != nil {
		t.Fatalf("ParseShareLANNets(%q): %v", spec, err)
	}
	return lans
}

// v4 builds a minimal IPv4 packet with the given protocol and dst.
func v4(proto byte, dst string) []byte {
	pkt := make([]byte, 20+8)
	pkt[0] = 0x45
	pkt[9] = proto
	copy(pkt[16:20], net.ParseIP(dst).To4())
	return pkt
}

// v6 builds a minimal IPv6 packet with the given next-header and dst.
func v6(proto byte, dst string) []byte {
	pkt := make([]byte, 40+8)
	pkt[0] = 0x60
	pkt[6] = proto
	copy(pkt[24:40], net.ParseIP(dst).To16())
	return pkt
}

// RED 8: the classifier decides every packet's fate — virtual traffic passes
// to the device, LAN TCP/UDP enters the userspace stack, LAN everything-else
// (ping) drops against the counter.
func TestShareClassify(t *testing.T) {
	lans := mustShareLans(t, "192.168.1.0/24, fd00:db8:1::/64")

	if a := shareClassify(v4(6, "192.168.1.23"), lans); a != shareToStack {
		t.Fatalf("LAN TCP = %v, want toStack", a)
	}
	if a := shareClassify(v4(17, "192.168.1.23"), lans); a != shareToStack {
		t.Fatalf("LAN UDP = %v, want toStack", a)
	}
	if a := shareClassify(v4(1, "192.168.1.23"), lans); a != shareDrop {
		t.Fatalf("LAN ICMP = %v, want drop", a)
	}
	if a := shareClassify(v4(6, "10.10.0.5"), lans); a != sharePass {
		t.Fatalf("virtual TCP = %v, want pass", a)
	}
	if a := shareClassify(v6(6, "fd00:db8:2::5"), lans); a != sharePass {
		t.Fatalf("virtual v6 TCP = %v, want pass", a)
	}
	if a := shareClassify(v6(17, "fd00:db8:2::5"), lans); a != sharePass {
		t.Fatalf("virtual v6 UDP = %v, want pass", a)
	}
	if a := shareClassify([]byte{0x45, 0x00}, lans); a != shareDrop {
		t.Fatalf("truncated = %v, want drop", a)
	}
	if a := shareClassify(nil, lans); a != shareDrop {
		t.Fatalf("nil = %v, want drop", a)
	}
}
