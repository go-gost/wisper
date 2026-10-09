package tunnel

import (
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ShareStackBackend is the userspace stack seam under its exported name:
// the entrypoint hands the shim a stack built in this package, tests hand a
// fake — the shim never knows which.
type ShareStackBackend = shareStackBackend

// spokeShareRun is the command runner SetupSpokeShare applies rules with.
// Production points at shareExec; tests swap in a recorder.
var spokeShareRun shareRunner = shareExec

// SetupSpokeShare applies the sharer side: masquerade from the hub's subnet
// into the claimed LAN, and the forwarding rules that let B's kernel pass
// it out eth0. B's LAN is directly connected, so no route is added — the
// kernel already knows it; only SNAT is missing, because a LAN host has no
// route back to a spoke's virtual address. Downgrade semantics are the
// hub's: a pinned kernel mode that is unavailable is a start failure, auto
// degrades to userspace and reports it as the effective mode.
func SetupSpokeShare(hubNet string, lans []*net.IPNet, mode string, kernelOK bool) (string, func(), error) {
	effective, _, cleanup, err := setupShareLAN(
		hubNet, shareLanSpec(lans), mode, kernelOK, spokeShareRun)
	return effective, cleanup, err
}

// shareLanSpec joins nets in the form ParseShareLANNets reads back.
func shareLanSpec(lans []*net.IPNet) string {
	specs := make([]string, len(lans))
	for i, lan := range lans {
		specs[i] = lan.String()
	}
	return strings.Join(specs, ",")
}

// ChainShareShim is shareDevice's spoke-side twin. The hub wraps its device
// and classifies writes; a spoke wraps the chain toward the hub and
// classifies reads: a LAN-bound packet arriving off the chain enters the
// userspace stack, whose replies are addressed to another spoke's virtual
// IP and are merged back into the chain's write side — writing them into a
// local device would send them nowhere. Everything else passes through
// untouched, LAN ping takes Dropped()'s count.
type ChainShareShim struct {
	lans  []*net.IPNet
	stack ShareStackBackend

	done    chan struct{}
	closeDo sync.Once

	dropped atomic.Uint64
}

// NewChainShareShim builds the shim; Wrap binds it to the chain conn.
func NewChainShareShim(lans []*net.IPNet, stack ShareStackBackend) *ChainShareShim {
	return &ChainShareShim{
		lans:  lans,
		stack: stack,
		done:  make(chan struct{}),
	}
}

// Wrap returns a conn over chain — call it once. Reads classify (LAN
// TCP/UDP into the stack, LAN ping counted and dropped, the rest through
// to the caller); the stack's output is pumped into chain's write side
// alongside the caller's own pass-through writes.
func (s *ChainShareShim) Wrap(chain net.Conn) net.Conn {
	c := &chainShareConn{s: s, chain: chain}
	go c.pumpStack()
	return c
}

// Dropped counts LAN packets that never had a userspace fate: ping and the
// malformed — the same badge the hub shows.
func (s *ChainShareShim) Dropped() uint64 {
	return s.dropped.Load()
}

// Close tears the stack down with the shim; idempotent.
func (s *ChainShareShim) Close() error {
	s.closeDo.Do(func() { close(s.done) })
	s.stack.close()
	return nil
}

// chainShareConn is the chain as the spoke's engine sees it.
type chainShareConn struct {
	s     *ChainShareShim
	chain net.Conn

	// wmu serializes chain writes: the caller's pass-through writes race
	// the stack's replies, and a packet boundary must not be crossed.
	wmu sync.Mutex
}

// Read is the chain's only reader while attached: classify each packet and
// hand LAN TCP/UDP to the stack without surfacing it to the caller.
func (c *chainShareConn) Read(b []byte) (int, error) {
	buf := make([]byte, 65535)
	for {
		select {
		case <-c.s.done:
			return 0, net.ErrClosed
		default:
		}
		n, err := c.chain.Read(buf)
		if err != nil {
			return 0, err
		}
		if n == 0 {
			continue
		}
		switch shareClassify(buf[:n], c.s.lans) {
		case shareToStack:
			// The chain may reuse its read buffer and the stack consumes
			// asynchronously — so this copy is load-bearing.
			c.s.stack.write(append([]byte(nil), buf[:n]...))
		case sharePass:
			if n > len(b) {
				return 0, fmt.Errorf("chain share: packet %d bytes exceeds read buffer %d", n, len(b))
			}
			return copy(b, buf[:n]), nil
		default:
			c.s.dropped.Add(1)
		}
	}
}

// Write passes the caller's packets to the chain untouched — the engine's
// own traffic up the tunnel is not this shim's business.
func (c *chainShareConn) Write(pkt []byte) (int, error) {
	select {
	case <-c.s.done:
		return 0, net.ErrClosed
	default:
	}
	c.wmu.Lock()
	defer c.wmu.Unlock()
	return c.chain.Write(pkt)
}

// pumpStack merges the stack's replies into the chain's write side: they
// are addressed to another spoke's virtual IP and travel back up the
// chain, where the hub routes them by dst exactly like any other packet.
func (c *chainShareConn) pumpStack() {
	out := c.s.stack.output()
	for {
		select {
		case pkt := <-out:
			c.wmu.Lock()
			_, err := c.chain.Write(pkt)
			c.wmu.Unlock()
			if err != nil {
				return
			}
		case <-c.s.done:
			return
		}
	}
}

// Close shuts the shim (and with it the stack) and the chain, so the
// pump's goroutines cannot outlive the conn.
func (c *chainShareConn) Close() error {
	c.s.Close()
	return c.chain.Close()
}

func (c *chainShareConn) LocalAddr() net.Addr                { return c.chain.LocalAddr() }
func (c *chainShareConn) RemoteAddr() net.Addr               { return c.chain.RemoteAddr() }
func (c *chainShareConn) SetDeadline(t time.Time) error      { return c.chain.SetDeadline(t) }
func (c *chainShareConn) SetReadDeadline(t time.Time) error  { return c.chain.SetReadDeadline(t) }
func (c *chainShareConn) SetWriteDeadline(t time.Time) error { return c.chain.SetWriteDeadline(t) }
