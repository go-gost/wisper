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
//
// Lifecycle: the stack is closed exactly once, whichever path gets there
// first (conn.Close, Close, or a reply-pump death); the rest are no-ops. A
// dead reply pump is reported, not swallowed: the first chain write error
// records pumpErr, ticks pumpDeaths, and stops the shim, so the next Read
// or Write returns that error (the shareDevice devErr pattern). Close
// best-effort releases a reader blocked in the chain by expiring its read
// deadline; conn.Close is the definitive release, because it closes the
// chain itself.
type ChainShareShim struct {
	lans  []*net.IPNet
	stack ShareStackBackend

	wrapOnce sync.Once

	// mu guards chain and conn — one lock for both sides of the access
	// pair, which is what makes the ordering obvious: Wrap writes chain
	// and conn here, shutdown reads chain for the deadline poke here.
	// wrapOnce alone orders Wrap calls against each other, but shutdown
	// runs under closeDo — a different once — so without mu the poke
	// could read a chain that Wrap is concurrently writing. Lock order
	// is always once-outer, mu-inner (the closeDo and wrapOnce bodies
	// take mu; nothing holding mu ever enters a once body), so the two
	// can never deadlock against each other.
	mu    sync.Mutex
	chain net.Conn // the chain Wrap bound; nil until then
	conn  *chainShareConn

	done    chan struct{}
	closeDo sync.Once // exactly-once teardown: close(done) + stack.close()

	pumpErr    atomic.Value // error — first reply-pump death
	pumpDeaths atomic.Uint64

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

// Wrap returns a conn over chain. It is guarded: the first call binds the
// chain and starts the reply pump, later calls return the same conn — a
// second pump would interleave writes into a chain it does not own.
func (s *ChainShareShim) Wrap(chain net.Conn) net.Conn {
	s.wrapOnce.Do(func() {
		c := &chainShareConn{s: s, chain: chain, buf: make([]byte, 65535)}
		s.mu.Lock()
		s.chain, s.conn = chain, c
		s.mu.Unlock()
		go c.pumpStack()
	})
	s.mu.Lock()
	c := s.conn
	s.mu.Unlock()
	return c
}

// shutdown tears the shim down exactly once. The first caller wins the
// once: a reply-pump death records its error inside it, so a death that
// loses the race to an ordinary Close is a consequence of that Close, not
// a failure to report. The stack is closed here and only here, so no
// combination or order of close paths can close it twice.
func (s *ChainShareShim) shutdown(pumpErr error) {
	s.closeDo.Do(func() {
		if pumpErr != nil {
			s.pumpErr.Store(pumpErr)
		}
		// done closes before the counter ticks: an observer of
		// PumpDeaths() > 0 is guaranteed to see a stopped shim.
		close(s.done)
		if pumpErr != nil {
			s.pumpDeaths.Add(1)
		}
		s.stack.close()
		// Wake a reader blocked in chain.Read: without this poke the
		// recorded error could wait for the next packet to surface.
		// Best-effort — a chain that refuses deadlines still releases its
		// reader when conn.Close closes the chain itself.
		s.mu.Lock()
		chain := s.chain
		s.mu.Unlock()
		if chain != nil {
			_ = chain.SetReadDeadline(time.Now())
		}
	})
}

// stoppedErr reports why the shim stopped passing traffic: the reply
// pump's death error if it died, else net.ErrClosed. Callers reach it only
// after done is closed.
func (s *ChainShareShim) stoppedErr() error {
	if err, ok := s.pumpErr.Load().(error); ok && err != nil {
		return err
	}
	return net.ErrClosed
}

// Dropped counts LAN packets that never had a userspace fate: ping and the
// malformed — the same badge the hub shows.
func (s *ChainShareShim) Dropped() uint64 {
	return s.dropped.Load()
}

// PumpDeaths counts reply pumps that died on a chain write error. It is 0
// on a healthy shim and never decreases; the same death is also reported
// through Read and Write.
func (s *ChainShareShim) PumpDeaths() uint64 {
	return s.pumpDeaths.Load()
}

// Close tears the shim down: exactly one caller runs the teardown (stack
// closed once), and a reader blocked in the chain is released
// best-effort via a read-deadline poke. Call conn.Close to also close the
// chain — that path is the definitive reader release.
func (s *ChainShareShim) Close() error {
	s.shutdown(nil)
	return nil
}

// chainShareConn is the chain as the spoke's engine sees it.
type chainShareConn struct {
	s     *ChainShareShim
	chain net.Conn
	buf   []byte // one reader per the net.Conn contract — allocated once

	closeOnce sync.Once

	// wmu serializes chain writes: the caller's pass-through writes race
	// the stack's replies, and a packet boundary must not be crossed.
	wmu sync.Mutex
}

// Read is the chain's only reader while attached: classify each packet and
// hand LAN TCP/UDP to the stack without surfacing it to the caller.
func (c *chainShareConn) Read(b []byte) (int, error) {
	for {
		select {
		case <-c.s.done:
			return 0, c.s.stoppedErr()
		default:
		}
		n, err := c.chain.Read(c.buf)
		if err != nil {
			// A shim teardown pokes the read deadline to unblock this
			// Read; report the cause, not the poke.
			select {
			case <-c.s.done:
				return 0, c.s.stoppedErr()
			default:
			}
			return 0, err
		}
		if n == 0 {
			continue
		}
		switch shareClassify(c.buf[:n], c.s.lans) {
		case shareToStack:
			// The chain may reuse its read buffer and the stack consumes
			// asynchronously — so this copy is load-bearing.
			c.s.stack.write(append([]byte(nil), c.buf[:n]...))
		case sharePass:
			if n > len(b) {
				return 0, fmt.Errorf("chain share: packet %d bytes exceeds read buffer %d", n, len(b))
			}
			return copy(b, c.buf[:n]), nil
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
		return 0, c.s.stoppedErr()
	default:
	}
	c.wmu.Lock()
	defer c.wmu.Unlock()
	return c.chain.Write(pkt)
}

// pumpStack merges the stack's replies into the chain's write side: they
// are addressed to another spoke's virtual IP and travel back up the
// chain, where the hub routes them by dst exactly like any other packet.
// A write error ends the pump and is reported through shutdown — a pump
// that died silently would blackhole every reply with reads and writes
// still looking healthy (shareDevice's devErr pattern, sharedevice.go).
func (c *chainShareConn) pumpStack() {
	out := c.s.stack.output()
	for {
		select {
		case pkt := <-out:
			c.wmu.Lock()
			_, err := c.chain.Write(pkt)
			c.wmu.Unlock()
			if err != nil {
				c.s.shutdown(err)
				return
			}
		case <-c.s.done:
			return
		}
	}
}

// Close shuts the shim (and with it the stack, exactly once) and the
// chain, so the pump's goroutines cannot outlive the conn. Idempotent.
func (c *chainShareConn) Close() error {
	var err error
	c.closeOnce.Do(func() {
		c.s.shutdown(nil)
		err = c.chain.Close()
	})
	return err
}

func (c *chainShareConn) LocalAddr() net.Addr                { return c.chain.LocalAddr() }
func (c *chainShareConn) RemoteAddr() net.Addr               { return c.chain.RemoteAddr() }
func (c *chainShareConn) SetDeadline(t time.Time) error      { return c.chain.SetDeadline(t) }
func (c *chainShareConn) SetReadDeadline(t time.Time) error  { return c.chain.SetReadDeadline(t) }
func (c *chainShareConn) SetWriteDeadline(t time.Time) error { return c.chain.SetWriteDeadline(t) }
