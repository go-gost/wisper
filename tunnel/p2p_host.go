package tunnel

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"

	"github.com/go-gost/core/logger"
	"github.com/go-gost/p2p"
	cfg "github.com/go-gost/wisper/config"
)

// p2pBacklog bounds each peer route's undelivered inbound streams; overflow is
// dropped (the transport is lossy by design).
var p2pBacklog = 64

// P2PHostKeyPath is the process-wide p2p identity: <config>/wisper/p2p/host.key
// (0600, created on first use). One host, one identity, shared by every p2p
// tunnel and entrypoint.
func P2PHostKeyPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "wisper", "p2p", "host.key"), nil
}

// p2pHostManager owns the process-wide host: refcounted lifetime, the inbound
// accept loop, and the peer-key → tunnel routes.
type p2pHostManager struct {
	mu     sync.Mutex
	host   *p2p.Host
	ln     net.Listener
	routes map[string]*peerListener
	refs   int
}

var p2pHost = &p2pHostManager{routes: make(map[string]*peerListener)}

// acquire starts the host on first use (key + relay + Listen + accept loop) and
// takes a reference. A failed relay connection is not fatal: the engine retries
// in the background, so it is logged, never returned.
func (m *p2pHostManager) acquire() (*p2p.Host, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.host == nil {
		keyPath, err := P2PHostKeyPath()
		if err != nil {
			return nil, err
		}
		settings := cfg.Get().Settings
		direct := false
		conf := &p2p.Config{
			Derp:   P2PDerpURL(settings),
			Key:    keyPath,
			Direct: &direct,
		}
		conf.TLS = P2PTLSConfig(settings)
		host, err := p2p.New(conf)
		if err != nil {
			return nil, fmt.Errorf("p2p host: %w", err)
		}
		ln, err := host.Tunnel().Listen()
		if err != nil {
			_ = host.Close()
			return nil, err
		}
		if cerr := host.Connect(); cerr != nil {
			if log := logger.Default(); log != nil {
				log.Warnf("p2p derp connect: %v", cerr)
			}
		}
		m.host, m.ln = host, ln
		go m.acceptLoop(ln)
	}
	m.refs++
	return m.host, nil
}

// release drops one reference; the last one stops the host and every route.
func (m *p2pHostManager) release() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.refs > 0 {
		m.refs--
	}
	if m.refs > 0 || m.host == nil {
		return
	}
	if m.ln != nil {
		_ = m.ln.Close()
	}
	_ = m.host.Close()
	m.host, m.ln = nil, nil
	for k, pl := range m.routes {
		pl.close()
		delete(m.routes, k)
	}
}

// register routes inbound streams from peer to the returned listener. 1:1: a
// peer key belongs to at most one tunnel.
func (m *p2pHostManager) register(peer string) (net.Listener, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.routes[peer]; ok {
		return nil, fmt.Errorf("peer %s is already used by another p2p tunnel", peer)
	}
	pl := newPeerListener(peer)
	m.routes[peer] = pl
	return pl, nil
}

// unregister drops peer's route if ln still owns it, so a stale unregister
// from a replaced tunnel cannot remove the live route.
func (m *p2pHostManager) unregister(peer string, ln net.Listener) {
	m.mu.Lock()
	pl, ok := m.routes[peer]
	if ok && pl == ln {
		delete(m.routes, peer)
	}
	m.mu.Unlock()
	if ok && pl == ln {
		pl.close()
	}
}

// PublicKey returns the host's base64 key, or "" while the host is not running.
func (m *p2pHostManager) PublicKey() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.host == nil {
		return ""
	}
	return m.host.PublicKey()
}

func (m *p2pHostManager) acceptLoop(ln net.Listener) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		m.dispatch(conn)
	}
}

// dispatch routes one inbound conn by its remote address (the peer key); an
// unregistered peer is closed (explicit allowlist, no fallback).
func (m *p2pHostManager) dispatch(conn net.Conn) {
	peer := ""
	if a := conn.RemoteAddr(); a != nil {
		peer = a.String()
	}
	m.mu.Lock()
	pl := m.routes[peer]
	m.mu.Unlock()
	if pl == nil {
		if log := logger.Default(); log != nil {
			log.Warnf("p2p inbound stream from unregistered peer %s: closed", peer)
		}
		_ = conn.Close()
		return
	}
	pl.deliver(conn)
}

// peerListener is one peer's route, exposed as a net.Listener for a gost
// service: a bounded queue, lossy on overflow.
type peerListener struct {
	peer   string
	ch     chan net.Conn
	closed chan struct{}
	once   sync.Once
}

func newPeerListener(peer string) *peerListener {
	return &peerListener{peer: peer, ch: make(chan net.Conn, p2pBacklog), closed: make(chan struct{})}
}

func (l *peerListener) deliver(conn net.Conn) {
	select {
	case l.ch <- conn:
	case <-l.closed:
		_ = conn.Close()
	default:
		if log := logger.Default(); log != nil {
			log.Warnf("p2p inbound stream for peer %s dropped (backlog full)", l.peer)
		}
		_ = conn.Close()
	}
}

func (l *peerListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.ch:
		return c, nil
	case <-l.closed:
		return nil, net.ErrClosed
	}
}

func (l *peerListener) close() {
	l.once.Do(func() {
		close(l.closed)
		for {
			select {
			case c := <-l.ch:
				_ = c.Close()
			default:
				return
			}
		}
	})
}

func (l *peerListener) Close() error { l.close(); return nil }

// Addr is the peer's key: the route's identity, not a socket.
func (l *peerListener) Addr() net.Addr { return peerRouteAddr(l.peer) }

type peerRouteAddr string

func (a peerRouteAddr) Network() string { return "p2p" }
func (a peerRouteAddr) String() string  { return string(a) }
