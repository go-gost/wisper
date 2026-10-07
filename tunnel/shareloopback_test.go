package tunnel

import (
	"net"
	"testing"
	"time"
)

// TestShareDeviceStackLoopback drives the exact objects Run wires for the
// userspace fallback — newShareDevice(deviceConn, lans, newShareStack(mtu)) —
// packet by packet: a spoke's SYN enters through the shim's Write, the stack
// dials the LAN, and the handshake plus echo come back out of the shim's
// Read addressed to the spoke. Nothing here is a fake except the device.
func TestShareDeviceStackLoopback(t *testing.T) {
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

	dev := &fakeShareDevice{}
	lans := mustShareLans(t, lanIP+"/32")
	shim := newShareDevice(dev, lans, newShareStack(1500))
	defer shim.Close()

	read := func() []byte {
		t.Helper()
		buf := make([]byte, 65535)
		if err := shim.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			t.Fatalf("SetReadDeadline: %v", err)
		}
		// The fake device ignores deadlines and blocks; run the read where a
		// timeout can interrupt the test instead of the suite.
		type result struct {
			n   int
			err error
		}
		ch := make(chan result, 1)
		go func() {
			n, err := shim.Read(buf)
			ch <- result{n, err}
		}()
		select {
		case r := <-ch:
			if r.err != nil {
				t.Fatalf("shim Read: %v", r.err)
			}
			return buf[:r.n]
		case <-time.After(5 * time.Second):
			t.Fatal("timed out waiting for a packet out of the shim")
			return nil
		}
	}

	const seq0 = uint32(1000)
	if _, err := shim.Write(tcpPacket("10.10.0.5", lanIP, 40000, port, seq0, 0, 0x02, nil)); err != nil {
		t.Fatalf("Write SYN: %v", err)
	}
	synAck := read()
	if f := tcpFlags(synAck); f&0x12 != 0x12 {
		t.Fatalf("reply flags = %#x, want SYN|ACK", f)
	}
	srvSeq, _ := tcpSeqAck(synAck)

	// The SYN must not have reached the kernel device: in userspace mode the
	// device only ever sees virtual-network traffic.
	dev.mu.Lock()
	nw := len(dev.writes)
	dev.mu.Unlock()
	if nw != 0 {
		t.Fatalf("device writes = %d, want 0 (LAN must not reach the kernel)", nw)
	}

	if _, err := shim.Write(tcpPacket("10.10.0.5", lanIP, 40000, port, seq0+1, srvSeq+1, 0x10, nil)); err != nil {
		t.Fatalf("Write ACK: %v", err)
	}
	if _, err := shim.Write(tcpPacket("10.10.0.5", lanIP, 40000, port, seq0+1, srvSeq+1, 0x18, []byte("hello"))); err != nil {
		t.Fatalf("Write data: %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	for {
		pkt := read()
		if string(tcpPayload(pkt)) == "hello" {
			if _, err := shim.Write(tcpPacket("10.10.0.5", lanIP, 40000, port, seq0+6, srvSeq+6, 0x10, nil)); err != nil {
				t.Fatalf("Write final ACK: %v", err)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("echo payload never came back through the shim")
		}
	}
}
