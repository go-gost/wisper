package tunnel

import (
	"errors"
	"net"
	"sync"
	"testing"
	"time"
)

// fakeShareDevice is a packet-boundary net.Conn: reads serve queued packets,
type fakeShareDevice struct {
	mu     sync.Mutex
	reads  [][]byte
	writes [][]byte
	closed bool
	readCh chan struct{}
}

func (f *fakeShareDevice) Read(b []byte) (int, error) {
	for {
		f.mu.Lock()
		if len(f.reads) > 0 {
			pkt := f.reads[0]
			f.reads = f.reads[1:]
			f.mu.Unlock()
			return copy(b, pkt), nil
		}
		if f.closed {
			f.mu.Unlock()
			return 0, net.ErrClosed
		}
		ch := f.readCh
		if ch == nil {
			ch = make(chan struct{}, 1)
			f.readCh = ch
		}
		f.mu.Unlock()
		<-ch
	}
}

func (f *fakeShareDevice) Write(b []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return 0, net.ErrClosed
	}
	cp := append([]byte(nil), b...)
	f.writes = append(f.writes, cp)
	return len(b), nil
}

func (f *fakeShareDevice) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
	if f.readCh != nil {
		select {
		case f.readCh <- struct{}{}:
		default:
		}
	}
	return nil
}

func (f *fakeShareDevice) feed(pkt []byte) {
	f.mu.Lock()
	f.reads = append(f.reads, pkt)
	if f.readCh != nil {
		select {
		case f.readCh <- struct{}{}:
		default:
		}
	}
	f.mu.Unlock()
}

func (f *fakeShareDevice) LocalAddr() net.Addr                { return nil }
func (f *fakeShareDevice) RemoteAddr() net.Addr               { return nil }
func (f *fakeShareDevice) SetDeadline(t time.Time) error      { return nil }
func (f *fakeShareDevice) SetReadDeadline(t time.Time) error  { return nil }
func (f *fakeShareDevice) SetWriteDeadline(t time.Time) error { return nil }

// fakeShareStack records what the shim feeds it and plays scripted replies.
type fakeShareStack struct {
	mu     sync.Mutex
	inputs [][]byte
	out    chan []byte
	closed bool
}

func (f *fakeShareStack) write(pkt []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.inputs = append(f.inputs, append([]byte(nil), pkt...))
}

func (f *fakeShareStack) output() <-chan []byte { return f.out }

func (f *fakeShareStack) close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
}

// RED 9: the shim splits one device into two fates — virtual traffic straight
// through, LAN TCP/UDP into the stack, LAN ping into the counter.
func TestShareDeviceRoutes(t *testing.T) {
	dev := &fakeShareDevice{}
	st := &fakeShareStack{out: make(chan []byte, 8)}
	lans := mustShareLans(t, "192.168.1.0/24")
	shim := newShareDevice(dev, lans, st)
	defer shim.Close()

	lanTCP := v4(6, "192.168.1.23")
	if _, err := shim.Write(lanTCP); err != nil {
		t.Fatalf("Write LAN TCP: %v", err)
	}
	st.mu.Lock()
	if len(st.inputs) != 1 {
		st.mu.Unlock()
		t.Fatalf("stack inputs = %d, want 1", len(st.inputs))
	}
	st.mu.Unlock()
	dev.mu.Lock()
	if len(dev.writes) != 0 {
		dev.mu.Unlock()
		t.Fatalf("device writes = %d, want 0 (LAN must not reach the kernel)", len(dev.writes))
	}
	dev.mu.Unlock()

	if _, err := shim.Write(v4(1, "192.168.1.23")); err != nil {
		t.Fatalf("Write LAN ICMP: %v", err)
	}
	if got := shim.Dropped(); got != 1 {
		t.Fatalf("dropped = %d, want 1 (ping is counted, not silent)", got)
	}

	virt := v4(6, "10.10.0.5")
	if _, err := shim.Write(virt); err != nil {
		t.Fatalf("Write virtual: %v", err)
	}
	dev.mu.Lock()
	if len(dev.writes) != 1 {
		dev.mu.Unlock()
		t.Fatalf("device writes = %d, want 1 (virtual passes through)", len(dev.writes))
	}
	dev.mu.Unlock()

	// Stack replies come out of Read, addressed to the spoke.
	reply := v4(6, "10.10.0.5")
	st.out <- reply
	buf := make([]byte, 1500)
	shim.SetReadDeadline(time.Now().Add(2 * time.Second))
	n, err := shim.Read(buf)
	if err != nil {
		t.Fatalf("Read stack reply: %v", err)
	}
	if string(buf[:n]) != string(reply) {
		t.Fatal("Read did not return the stack reply")
	}

	// Device reads pass through too.
	fromDev := v4(6, "10.10.0.6")
	dev.feed(fromDev)
	n, err = shim.Read(buf)
	if err != nil {
		t.Fatalf("Read device packet: %v", err)
	}
	if string(buf[:n]) != string(fromDev) {
		t.Fatal("Read did not return the device packet")
	}
}

func TestShareDeviceClose(t *testing.T) {
	dev := &fakeShareDevice{}
	st := &fakeShareStack{out: make(chan []byte, 8)}
	shim := newShareDevice(dev, lansOf(t), st)

	if err := shim.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if _, err := shim.Write(v4(6, "10.10.0.5")); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("Write after Close = %v, want ErrClosed", err)
	}
	if _, err := shim.Read(make([]byte, 1500)); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("Read after Close = %v, want ErrClosed", err)
	}
	st.mu.Lock()
	closed := st.closed
	st.mu.Unlock()
	if !closed {
		t.Fatal("stack not closed with the shim")
	}
	dev.mu.Lock()
	dclosed := dev.closed
	dev.mu.Unlock()
	if !dclosed {
		t.Fatal("device not closed with the shim")
	}
}

func lansOf(t *testing.T) []*net.IPNet {
	t.Helper()
	return mustShareLans(t, "192.168.1.0/24")
}
