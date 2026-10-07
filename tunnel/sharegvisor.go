package tunnel

import (
	"context"
	"io"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/go-gost/core/logger"
	"github.com/xjasonlyu/tun2socks/v2/core"
	"github.com/xjasonlyu/tun2socks/v2/core/adapter"
	"gvisor.dev/gvisor/pkg/buffer"
	"gvisor.dev/gvisor/pkg/tcpip/header"
	"gvisor.dev/gvisor/pkg/tcpip/link/channel"
	"gvisor.dev/gvisor/pkg/tcpip/stack"
)

const (
	// shareOutQueueLen bounds stack replies waiting for the hub. Overflow
	// drops — the protocols retransmit, so a bound beats an unbounded
	// queue under load.
	shareOutQueueLen = 1 << 10
	// shareUDPTimeout closes an idle UDP relay. LAN answers arrive in
	// milliseconds; anything quieter than this is gone.
	shareUDPTimeout = 30 * time.Second
)

// shareEndpoint is the stack's link: spoke packets are injected, LAN replies
// come out of emit for the shim's read side. It is tungo's endpoint with the
// TUN conn replaced by two channels — same channel.Endpoint mechanics, no
// device of its own.
type shareEndpoint struct {
	*channel.Endpoint
	inject chan []byte
	emit   chan []byte
	done   chan struct{}
	mtu    uint32
	once   sync.Once
	wg     sync.WaitGroup
	log    logger.Logger
}

func newShareEndpoint(mtu int, log logger.Logger) *shareEndpoint {
	if mtu <= 0 {
		mtu = 1500
	}
	return &shareEndpoint{
		Endpoint: channel.New(shareOutQueueLen, uint32(mtu), ""),
		inject:   make(chan []byte, shareOutQueueLen),
		emit:     make(chan []byte, shareOutQueueLen),
		done:     make(chan struct{}),
		mtu:      uint32(mtu),
		log:      log,
	}
}

func (e *shareEndpoint) Attach(dispatcher stack.NetworkDispatcher) {
	e.Endpoint.Attach(dispatcher)
	e.once.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		e.wg.Add(2)
		go func() {
			e.outboundLoop(ctx)
			e.wg.Done()
		}()
		go func() {
			e.inboundLoop(cancel)
			e.wg.Done()
		}()
	})
}

func (e *shareEndpoint) Wait() {
	e.wg.Wait()
}

// inboundLoop feeds spoke packets into the stack. A full queue drops rather
// than wedging the hub's write path — TCP retransmits, UDP never promised.
func (e *shareEndpoint) inboundLoop(cancel context.CancelFunc) {
	defer cancel()
	for {
		select {
		case pkt := <-e.inject:
			if !e.IsAttached() {
				continue
			}
			pb := stack.NewPacketBuffer(stack.PacketBufferOptions{
				Payload: buffer.MakeWithData(pkt),
			})
			switch header.IPVersion(pkt) {
			case header.IPv4Version:
				e.InjectInbound(header.IPv4ProtocolNumber, pb)
			case header.IPv6Version:
				e.InjectInbound(header.IPv6ProtocolNumber, pb)
			}
			pb.DecRef()
		case <-e.done:
			return
		}
	}
}

// outboundLoop carries the stack's replies (LAN answers) to the shim.
func (e *shareEndpoint) outboundLoop(ctx context.Context) {
	for {
		pkt := e.ReadContext(ctx)
		if pkt == nil {
			return
		}
		func() {
			defer pkt.DecRef()
			buf := pkt.ToBuffer()
			defer buf.Release()
			flat := buf.Flatten()
			cp := append([]byte(nil), flat...)
			select {
			case e.emit <- cp:
			case <-ctx.Done():
			}
		}()
	}
}

// shareTransportHandler dials the LAN directly: the stack terminated the
// spoke's connection, so this side is an ordinary client of the LAN host —
// no privilege, no routes, just a socket the host already could open.
type shareTransportHandler struct {
	tcpQueue chan adapter.TCPConn
	udpQueue chan adapter.UDPConn
	dialer   *net.Dialer
	log      logger.Logger
}

func (h *shareTransportHandler) HandleTCP(conn adapter.TCPConn) {
	select {
	case h.tcpQueue <- conn:
	default:
		conn.Close()
	}
}

func (h *shareTransportHandler) HandleUDP(conn adapter.UDPConn) {
	select {
	case h.udpQueue <- conn:
	default:
		conn.Close()
	}
}

func (h *shareTransportHandler) process(ctx context.Context) {
	for {
		select {
		case conn := <-h.tcpQueue:
			go h.handleTCP(ctx, conn)
		case conn := <-h.udpQueue:
			go h.handleUDP(ctx, conn)
		case <-ctx.Done():
			return
		}
	}
}

func (h *shareTransportHandler) handleTCP(ctx context.Context, origin adapter.TCPConn) {
	defer origin.Close()
	id := origin.ID()
	dst := net.JoinHostPort(id.LocalAddress.String(), strconv.Itoa(int(id.LocalPort)))

	lan, err := h.dialer.DialContext(ctx, "tcp", dst)
	if err != nil {
		h.log.Warnf("share: dial LAN %s: %v", dst, err)
		return
	}
	defer lan.Close()

	// Half-close propagates so a LAN server's FIN reaches the spoke as FIN,
	// not as a connection reset when the copy direction ends first.
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		io.Copy(lan, origin)
		if cw, ok := lan.(interface{ CloseWrite() error }); ok {
			cw.CloseWrite()
		}
	}()
	go func() {
		defer wg.Done()
		io.Copy(origin, lan)
		if cw, ok := origin.(interface{ CloseWrite() error }); ok {
			cw.CloseWrite()
		}
	}()
	wg.Wait()
}

func (h *shareTransportHandler) handleUDP(ctx context.Context, origin adapter.UDPConn) {
	defer origin.Close()
	id := origin.ID()
	dst := net.JoinHostPort(id.LocalAddress.String(), strconv.Itoa(int(id.LocalPort)))

	lan, err := h.dialer.DialContext(ctx, "udp", dst)
	if err != nil {
		h.log.Warnf("share: dial LAN %s: %v", dst, err)
		return
	}
	defer lan.Close()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		defer cancel()
		buf := make([]byte, 65535)
		for {
			lan.SetReadDeadline(time.Now().Add(shareUDPTimeout))
			n, err := lan.Read(buf)
			if err != nil {
				return
			}
			origin.SetWriteDeadline(time.Now().Add(shareUDPTimeout))
			if _, err := origin.Write(buf[:n]); err != nil {
				return
			}
		}
	}()
	go func() {
		defer wg.Done()
		defer cancel()
		buf := make([]byte, 65535)
		for {
			origin.SetReadDeadline(time.Now().Add(shareUDPTimeout))
			n, err := origin.Read(buf)
			if err != nil {
				return
			}
			lan.SetWriteDeadline(time.Now().Add(shareUDPTimeout))
			if _, err := lan.Write(buf[:n]); err != nil {
				return
			}
		}
	}()
	wg.Wait()
}

// shareStack is a whole userspace TCP/UDP endpoint for the shared LANs: the
// shim feeds it spoke packets, it dials the LAN, and its replies return as
// packets the hub routes to spokes. ICMP never arrives — the classifier
// drops it before this point.
type shareStack struct {
	stack *stack.Stack
	ep    *shareEndpoint
	th    *shareTransportHandler
	out   chan []byte
	stop  context.CancelFunc
	wg    sync.WaitGroup
}

func newShareStack(mtu int) *shareStack {
	log := logger.Default()
	ep := newShareEndpoint(mtu, log)
	ctx, cancel := context.WithCancel(context.Background())
	th := &shareTransportHandler{
		tcpQueue: make(chan adapter.TCPConn, 64),
		udpQueue: make(chan adapter.UDPConn, 64),
		dialer:   &net.Dialer{Timeout: 10 * time.Second},
		log:      log,
	}
	st, err := core.CreateStack(&core.Config{
		LinkEndpoint:     ep,
		TransportHandler: th,
	})
	if err != nil {
		cancel()
		// CreateStack with a channel endpoint and default options does not
		// fail in practice; a nil stack would only ever dereference below,
		// so say so loudly instead.
		panic("share: create userspace stack: " + err.Error())
	}
	s := &shareStack{stack: st, ep: ep, th: th, out: ep.emit, stop: cancel}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		th.process(ctx)
	}()
	return s
}

func (s *shareStack) write(pkt []byte) {
	select {
	case s.ep.inject <- pkt:
	case <-s.ep.done:
	default:
		// Inbound overflow drops; see inboundLoop.
	}
}

func (s *shareStack) output() <-chan []byte {
	return s.out
}

func (s *shareStack) close() {
	s.stop()
	close(s.ep.done)
	s.stack.Close()
	s.wg.Wait()
}

var _ adapter.TransportHandler = (*shareTransportHandler)(nil)
