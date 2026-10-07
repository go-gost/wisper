package tunnel

import (
	"context"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"

	xctx "github.com/go-gost/x/ctx"
)

// shareStackBackend terminates LAN TCP/UDP in userspace: spoke packets in,
// reply packets out. The gvisor backend lives in sharegvisor.go; tests use
// a fake — the shim never knows which.
type shareStackBackend interface {
	write(pkt []byte)
	output() <-chan []byte
	close()
}

// shareDevice is the tun device the hub's handler reads, split in two: it
// implements net.Conn over the real device, diverting LAN-bound TCP/UDP the
// handler writes into a userspace stack and merging that stack's replies
// back into the read side, where the hub routes them to spokes by
// destination exactly like packets off the device.
//
// Only the write path classifies. The read path (kernel → hub) carries
// spoke-to-spoke traffic the kernel routed back out of the device; nothing
// LAN-bound normally appears there, so everything passes through.
type shareDevice struct {
	dev   net.Conn
	lans  []*net.IPNet
	stack shareStackBackend

	readQ   chan []byte
	done    chan struct{}
	closeDo sync.Once

	devErr atomic.Value // error — the device pump's death, if it died first

	dropped atomic.Uint64
}

func newShareDevice(dev net.Conn, lans []*net.IPNet, stack shareStackBackend) *shareDevice {
	s := &shareDevice{
		dev:   dev,
		lans:  lans,
		stack: stack,
		readQ: make(chan []byte, 1024),
		done:  make(chan struct{}),
	}
	go s.pumpDevice()
	go s.pumpStack()
	return s
}

// pumpDevice is the device's only reader: it owns the read side the way the
// hub's engine requires (one reader — the device shares its buffers).
func (s *shareDevice) pumpDevice() {
	buf := make([]byte, 65535)
	for {
		n, err := s.dev.Read(buf)
		if err != nil {
			s.devErr.Store(err)
			s.closeDo.Do(func() { close(s.done) })
			return
		}
		if n == 0 {
			continue
		}
		pkt := append([]byte(nil), buf[:n]...)
		select {
		case s.readQ <- pkt:
		case <-s.done:
			return
		}
	}
}

// pumpStack merges the userspace stack's replies into the same queue, so the
// hub cannot tell a reply from a device packet — both are routed by dst.
func (s *shareDevice) pumpStack() {
	out := s.stack.output()
	for {
		select {
		case pkt := <-out:
			select {
			case s.readQ <- pkt:
			case <-s.done:
				return
			}
		case <-s.done:
			return
		}
	}
}

func (s *shareDevice) Read(b []byte) (int, error) {
	select {
	case pkt := <-s.readQ:
		if len(pkt) > len(b) {
			return 0, fmt.Errorf("share device: packet %d bytes exceeds read buffer %d", len(pkt), len(b))
		}
		return copy(b, pkt), nil
	case <-s.done:
		if err, ok := s.devErr.Load().(error); ok && err != nil {
			return 0, err
		}
		return 0, net.ErrClosed
	}
}

func (s *shareDevice) Write(pkt []byte) (int, error) {
	select {
	case <-s.done:
		return 0, net.ErrClosed
	default:
	}
	switch shareClassify(pkt, s.lans) {
	case shareToStack:
		// The caller reuses its buffer (the hub's loop buffer), and the
		// stack consumes asynchronously — so this copy is load-bearing.
		s.stack.write(append([]byte(nil), pkt...))
	case sharePass:
		return s.dev.Write(pkt)
	default:
		s.dropped.Add(1)
	}
	return len(pkt), nil
}

// Dropped counts LAN packets that never had a userspace fate: ping and the
// malformed. It is the number the badge explains — "ping will not reach the
// LAN" is this counter climbing.
func (s *shareDevice) Dropped() uint64 {
	return s.dropped.Load()
}

func (s *shareDevice) Close() error {
	s.closeDo.Do(func() { close(s.done) })
	s.stack.close()
	return s.dev.Close()
}

func (s *shareDevice) LocalAddr() net.Addr                { return s.dev.LocalAddr() }
func (s *shareDevice) RemoteAddr() net.Addr               { return s.dev.RemoteAddr() }
func (s *shareDevice) SetDeadline(t time.Time) error      { return s.dev.SetDeadline(t) }
func (s *shareDevice) SetReadDeadline(t time.Time) error  { return s.dev.SetReadDeadline(t) }
func (s *shareDevice) SetWriteDeadline(t time.Time) error { return s.dev.SetWriteDeadline(t) }

// Context carries the real device's context, which is where the listener
// puts the parsed device config — without it the hub's self-route guard
// silently disables (see deviceNets), so the shim must not swallow it.
func (s *shareDevice) Context() context.Context {
	if c, ok := s.dev.(xctx.Context); ok {
		return c.Context()
	}
	return nil
}
