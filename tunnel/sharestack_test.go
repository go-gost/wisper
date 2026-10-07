package tunnel

import (
	"encoding/binary"
	"net"
	"testing"
	"time"
)

// Packet crafting for the loopback tests: hand-rolled bytes, no stack
// library, so the test pins the wire behavior rather than the API.

func ipChecksum(b []byte) uint16 {
	var sum uint32
	for i := 0; i+1 < len(b); i += 2 {
		sum += uint32(binary.BigEndian.Uint16(b[i:]))
	}
	if len(b)%2 == 1 {
		sum += uint32(b[len(b)-1]) << 8
	}
	for sum > 0xffff {
		sum = (sum >> 16) + (sum & 0xffff)
	}
	return ^uint16(sum)
}

func tcpPacket(srcIP, dstIP string, srcPort, dstPort uint16, seq, ack uint32, flags byte, payload []byte) []byte {
	ipLen, tcpLen := 20, 20
	pkt := make([]byte, ipLen+tcpLen+len(payload))
	pkt[0] = 0x45
	binary.BigEndian.PutUint16(pkt[2:], uint16(len(pkt)))
	pkt[8] = 64
	pkt[9] = 6
	copy(pkt[12:16], net.ParseIP(srcIP).To4())
	copy(pkt[16:20], net.ParseIP(dstIP).To4())
	binary.BigEndian.PutUint16(pkt[2:], uint16(len(pkt)))
	cs := ipChecksum(pkt[:ipLen])
	binary.BigEndian.PutUint16(pkt[10:], cs)

	t := pkt[ipLen:]
	binary.BigEndian.PutUint16(t[0:], srcPort)
	binary.BigEndian.PutUint16(t[2:], dstPort)
	binary.BigEndian.PutUint32(t[4:], seq)
	binary.BigEndian.PutUint32(t[8:], ack)
	t[12] = 0x50
	t[13] = flags
	binary.BigEndian.PutUint16(t[14:], 65535)
	copy(t[tcpLen:], payload)
	// TCP checksum over the pseudo-header.
	pseudo := make([]byte, 12+tcpLen+len(payload))
	copy(pseudo[0:4], pkt[12:16])
	copy(pseudo[4:8], pkt[16:20])
	pseudo[9] = 6
	binary.BigEndian.PutUint16(pseudo[10:], uint16(tcpLen+len(payload)))
	copy(pseudo[12:], t)
	cs = ipChecksum(pseudo)
	binary.BigEndian.PutUint16(t[16:], cs)
	return pkt
}

func tcpFlags(pkt []byte) byte { return pkt[20+13] }

func tcpSeqAck(pkt []byte) (uint32, uint32) {
	return binary.BigEndian.Uint32(pkt[20+4:]), binary.BigEndian.Uint32(pkt[20+8:])
}

func tcpPayload(pkt []byte) []byte {
	hlen := int(pkt[20+12]>>4) * 4
	return pkt[20+hlen:]
}

func readShareOutput(t *testing.T, st *shareStack, timeout time.Duration) []byte {
	t.Helper()
	select {
	case pkt := <-st.output():
		return pkt
	case <-time.After(timeout):
		t.Fatal("timed out waiting for a stack reply packet")
		return nil
	}
}

// testLANIP returns the host's first non-loopback IPv4: the loopback tests'
// stand-in for a LAN address. gvisor drops loopback-destination packets as
// martian, so 127.0.0.1 can never prove the path — a real interface address
// is the closest thing to a LAN without one.
func testLANIP(t *testing.T) string {
	t.Helper()
	ifs, err := net.Interfaces()
	if err != nil {
		t.Skipf("no interfaces: %v", err)
	}
	for _, inf := range ifs {
		if inf.Flags&net.FlagUp == 0 || inf.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := inf.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip = ip.To4(); ip != nil {
				return ip.String()
			}
		}
	}
	t.Skip("no non-loopback IPv4 interface to stand in for the LAN")
	return ""
}

// stack reaches a LAN listener on loopback, and the echo comes back as
// packets for the spoke.
func TestShareStackTCPLoopback(t *testing.T) {
	lanIP := testLANIP(t)
	ln, err := net.Listen("tcp", net.JoinHostPort(lanIP, "0"))
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				buf := make([]byte, 1500)
				for {
					n, err := c.Read(buf)
					if err != nil {
						return
					}
					if _, err := c.Write(buf[:n]); err != nil {
						return
					}
				}
			}()
		}
	}()
	port := uint16(ln.Addr().(*net.TCPAddr).Port)

	st := newShareStack(1500)
	defer st.close()

	const seq0 = uint32(1000)
	st.write(tcpPacket("10.10.0.5", lanIP, 40000, port, seq0, 0, 0x02, nil))
	synAck := readShareOutput(t, st, 5*time.Second)
	if f := tcpFlags(synAck); f&0x12 != 0x12 {
		t.Fatalf("reply flags = %#x, want SYN|ACK", f)
	}
	srvSeq, srvAck := tcpSeqAck(synAck)
	if srvAck != seq0+1 {
		t.Fatalf("SYN|ACK ack = %d, want %d", srvAck, seq0+1)
	}

	st.write(tcpPacket("10.10.0.5", lanIP, 40000, port, seq0+1, srvSeq+1, 0x10, nil))
	st.write(tcpPacket("10.10.0.5", lanIP, 40000, port, seq0+1, srvSeq+1, 0x18, []byte("hello")))

	deadline := time.Now().Add(5 * time.Second)
	for {
		pkt := readShareOutput(t, st, 5*time.Second)
		if string(tcpPayload(pkt)) == "hello" {
			s2, a2 := tcpSeqAck(pkt)
			if s2 != srvSeq+1 || a2 != seq0+6 {
				t.Fatalf("echo seq/ack = %d/%d, want %d/%d", s2, a2, srvSeq+1, seq0+6)
			}
			st.write(tcpPacket("10.10.0.5", lanIP, 40000, port, seq0+6, srvSeq+6, 0x10, nil))
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("echo payload never came back through the stack")
		}
	}
}

func udpPacket(srcIP, dstIP string, srcPort, dstPort uint16, payload []byte) []byte {
	pkt := make([]byte, 20+8+len(payload))
	pkt[0] = 0x45
	binary.BigEndian.PutUint16(pkt[2:], uint16(len(pkt)))
	pkt[8] = 64
	pkt[9] = 17
	copy(pkt[12:16], net.ParseIP(srcIP).To4())
	copy(pkt[16:20], net.ParseIP(dstIP).To4())
	binary.BigEndian.PutUint16(pkt[10:], ipChecksum(pkt[:20]))
	u := pkt[20:]
	binary.BigEndian.PutUint16(u[0:], srcPort)
	binary.BigEndian.PutUint16(u[2:], dstPort)
	binary.BigEndian.PutUint16(u[4:], uint16(8+len(payload)))
	// Zero UDP checksum over IPv4: no checksum, always legal.
	copy(u[8:], payload)
	return pkt
}

func udpPayload(pkt []byte) []byte { return pkt[20+8:] }

// RED 11: a spoke's UDP datagram reaches a LAN listener on loopback and the
// answer returns as a packet for the spoke.
func TestShareStackUDPLoopback(t *testing.T) {
	lanIP := testLANIP(t)
	pc, err := net.ListenPacket("udp", net.JoinHostPort(lanIP, "0"))
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer pc.Close()
	go func() {
		buf := make([]byte, 1500)
		for {
			n, addr, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			if _, err := pc.WriteTo(buf[:n], addr); err != nil {
				return
			}
		}
	}()
	port := uint16(pc.LocalAddr().(*net.UDPAddr).Port)

	st := newShareStack(1500)
	defer st.close()

	st.write(udpPacket("10.10.0.5", lanIP, 40001, port, []byte("ping")))
	pkt := readShareOutput(t, st, 5*time.Second)
	if string(udpPayload(pkt)) != "ping" {
		t.Fatalf("UDP reply payload = %q, want %q", udpPayload(pkt), "ping")
	}
}
