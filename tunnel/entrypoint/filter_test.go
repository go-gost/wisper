package entrypoint

import (
	"net"
	"testing"

	"github.com/go-gost/core/listener"
	"github.com/go-gost/core/metadata"
	tp "github.com/go-gost/wisper/tunnel"
)

// fakeListener is the smallest listener that can hand the filter one conn;
// the point is the wrapper Accept installs, not the tun device behind it.
type fakeListener struct {
	conn   net.Conn
	closed bool
}

func (l *fakeListener) Init(metadata.Metadata) error { return nil }
func (l *fakeListener) Accept() (net.Conn, error)    { return l.conn, nil }
func (l *fakeListener) Addr() net.Addr               { return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 1} }
func (l *fakeListener) Close() error                 { l.closed = true; return nil }

var _ listener.Listener = (*fakeListener)(nil)

func TestFilterListenerAcceptsWrappedConn(t *testing.T) {
	one, other := net.Pipe()
	defer one.Close()
	defer other.Close()

	filter := tp.NewPeerFilter()
	filter.SetPolicy(
		[]tp.NetviewMember{{IP: "10.0.0.2", Key: "blocked"}},
		nil,
		[]string{"blocked"},
	)
	inner := &fakeListener{conn: one}
	ln := &filterListener{Listener: inner, filter: filter}

	conn, err := ln.Accept()
	if err != nil {
		t.Fatalf("Accept: %v", err)
	}
	pkt := make([]byte, 20)
	pkt[0] = 0x45
	pkt[2], pkt[3] = 0, 20
	copy(pkt[12:16], []byte{10, 0, 0, 2})
	copy(pkt[16:20], []byte{10, 0, 0, 1})

	// A blocked source is dropped at the wrapper's Write boundary and must
	// not block on the pipe's reader.
	if n, err := conn.Write(pkt); err != nil || n != len(pkt) {
		t.Fatalf("Write(blocked) = (%d, %v), want (%d, nil)", n, err, len(pkt))
	}
	if got := filter.BlockedPackets(); got != 1 {
		t.Fatalf("blocked packets = %d, want 1", got)
	}
	if ln.Addr() == nil {
		t.Fatal("Addr was not delegated")
	}
	if err := ln.Close(); err != nil || !inner.closed {
		t.Fatalf("Close = %v, closed = %v", err, inner.closed)
	}
}
