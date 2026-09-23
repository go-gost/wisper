package tunnel

import (
	"encoding/base64"
	"errors"
	"io"
	"math/rand/v2"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/core/chain"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/logger"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/core/service"
	"github.com/go-gost/p2p"
	cfg "github.com/go-gost/wisper/config"
	xchain "github.com/go-gost/x/chain"
	"github.com/go-gost/x/handler/forward/local"
	"github.com/go-gost/x/hop"
	xlogger "github.com/go-gost/x/logger"
	mdx "github.com/go-gost/x/metadata"
	xstats "github.com/go-gost/x/observer/stats"
	xservice "github.com/go-gost/x/service"
	"github.com/google/uuid"
)

// A p2p tunnel is exactly what the per-peer stats consumers look for.
var (
	_ PeerStatsReporter = (*p2pTunnel)(nil)
	_ PeerStatsUpdater  = (*p2pTunnel)(nil)
	_ PeerSetter        = (*p2pTunnel)(nil)
)

// PeerSetter is implemented by a tunnel whose inbound allowlist can change
// without a restart.
type PeerSetter interface {
	SetPeers(peers []string, aliases map[string]string) error
}

// p2pTunnel exposes a local service to peers over the process-wide p2p host:
// the peer dials the host by its base64 public key through the DERP relay, the
// manager routes the inbound stream to this tunnel's peer route, and a
// standard gost service serves it, so stats come from the service stack.
type p2pTunnel struct {
	opts          Options
	favorite      atomic.Bool
	stats         cfg.ServiceStats
	statsBaseline cfg.ServiceStats

	forward service.Service
	ln      net.Listener // the peer route, held for teardown
	cclose  chan struct{}

	// peerStats is the last per-peer snapshot the stats task took, with rates;
	// peerStatsAt times the window those rates average over.
	peerStats   []PeerStat
	peerStatsAt time.Time

	err error
	mu  sync.RWMutex
}

// NewP2PTunnel creates a private p2p tunnel.
func NewP2PTunnel(opts ...Option) Tunnel {
	var options Options
	for _, opt := range opts {
		opt(&options)
	}
	if options.ID == "" {
		options.ID = uuid.NewString()
	}
	if options.Endpoint == "" {
		options.Endpoint = "localhost:8080"
	}
	if options.Name == "" {
		options.Name = "p2p-" + options.ID
		if len(options.ID) > 8 {
			options.Name = "p2p-" + options.ID[:8]
		}
	}
	if options.CreatedAt.IsZero() {
		options.CreatedAt = time.Now()
	}
	return &p2pTunnel{opts: options, cclose: make(chan struct{})}
}

func (s *p2pTunnel) ID() string       { return s.opts.ID }
func (s *p2pTunnel) Type() string     { return P2PTunnel }
func (s *p2pTunnel) Name() string     { return s.opts.Name }
func (s *p2pTunnel) Endpoint() string { return s.opts.Endpoint }
func (s *p2pTunnel) Options() Options {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.opts
}
func (s *p2pTunnel) Favorite(b bool)  { s.favorite.Store(b) }
func (s *p2pTunnel) IsFavorite() bool { return s.favorite.Load() }

func (s *p2pTunnel) Stats() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stats
}

func (s *p2pTunnel) SetStats(stats cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stats = stats
}

func (s *p2pTunnel) StatsBaseline() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.statsBaseline
}

func (s *p2pTunnel) SetStatsBaseline(b cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.statsBaseline = b
}

// Entrypoint is the value the tunnel page shows: the allowlist, "this link's
// other ends" (comma-joined). This host's own identity is process-wide — see
// EnsureP2PIdentity and the settings page.
func (s *p2pTunnel) Entrypoint() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return strings.Join(s.opts.Peers, ", ")
}

// Status is the underlying gost service's status (state and live stats).
func (s *p2pTunnel) Status() *xservice.Status {
	s.mu.RLock()
	forward := s.forward
	s.mu.RUnlock()

	if ss, _ := forward.(ServiceStatus); ss != nil {
		return ss.Status()
	}
	return nil
}

// p2pLog returns the process default logger, or a discarding one when none is
// set (unit tests run without config.Init).
func p2pLog() logger.Logger {
	if log := logger.Default(); log != nil {
		return log
	}
	return xlogger.NewLogger(xlogger.OutputOption(io.Discard))
}

// P2PKeyPath is the legacy per-tunnel key file:
// <UserConfigDir>/wisper/p2p/<id>.key (hex, 0600). The p2p identity is
// process-wide now (P2PHostKeyPath); this only locates files left by older
// versions so they can be cleaned up.
func P2PKeyPath(id string) (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "wisper", "p2p", id+".key"), nil
}

// RemoveP2PKey deletes a legacy per-tunnel key file; called by the API's
// delete handlers so files left by older versions do not pile up.
func RemoveP2PKey(id string) error {
	path, err := P2PKeyPath(id)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// ValidPeerKey reports whether k is a base64 (raw URL) 32-byte curve25519
// public key — the only shape a p2p allowlist entry can match. An entry that is
// not a key is a silent no-op route (nothing ever matches it), so the API
// rejects one up front.
func ValidPeerKey(k string) bool {
	b, err := base64.RawURLEncoding.DecodeString(k)
	return err == nil && len(b) == 32
}

// P2PDerpURL returns the configured DERP relay, falling back to the public
// gost.run relay — the same read-time-default pattern as GetServerName.
func P2PDerpURL(s *cfg.Settings) string {
	if s != nil && s.P2P != nil && s.P2P.Derp != "" {
		return s.P2P.Derp
	}
	return defaultP2PDerp
}

// P2PStunAddr returns the STUN server for the IPv4 direct path. An explicit
// settings.p2p.stun wins; otherwise it is the relay's host on the standard STUN
// port, since a derper serves STUN from the same host (unless it was started
// with -stun=false). Empty when the relay cannot be parsed — the direct path
// then has only IPv6 to work with.
func P2PStunAddr(s *cfg.Settings) string {
	if s != nil && s.P2P != nil && s.P2P.Stun != "" {
		return s.P2P.Stun
	}
	u, err := url.Parse(P2PDerpURL(s))
	if err != nil || u.Hostname() == "" {
		return ""
	}
	return net.JoinHostPort(u.Hostname(), "3478")
}

// P2PDirect reports whether the direct (hole-punched) path is enabled. A
// missing setting means on, matching p2p's own default.
func P2PDirect(s *cfg.Settings) bool {
	return s == nil || s.P2P == nil || s.P2P.Direct == nil || *s.P2P.Direct
}

// P2PTLSConfig returns the relay TLS options, or nil to keep p2p's defaults
// (verify against the system roots) when settings.p2p is unset.
func P2PTLSConfig(s *cfg.Settings) *p2p.TLSConfig {
	if s == nil || s.P2P == nil {
		return nil
	}
	if s.P2P.Secure == nil && s.P2P.CAFile == "" {
		return nil
	}
	return &p2p.TLSConfig{Secure: s.P2P.Secure, CAFile: s.P2P.CAFile}
}

// Run joins the process-wide p2p host, claims this tunnel's peer routes on it
// and serves them with a standard gost service forwarding to Endpoint. Peers
// is an allowlist, not a requirement: an empty list runs the tunnel, it just
// never receives a stream.
func (s *p2pTunnel) Run() (err error) {
	if s.IsClosed() {
		return ErrTunnelClosed
	}
	defer func() {
		if err != nil {
			s.setErr(err)
		}
	}()

	// The manager owns the host (identity, DERP connection, accept loop); this
	// tunnel holds one reference and its routes on it.
	if _, err = p2pHost.acquire(); err != nil {
		return
	}
	ln, err := p2pHost.register(s.opts.Peers)
	if err != nil {
		p2pHost.release()
		return
	}
	// register hands the route back as a net.Listener; it is always a
	// *peerListener, the gost listener the service needs.
	peerLn := ln.(*peerListener)

	log := p2pLog().WithFields(map[string]any{
		"kind":    "service",
		"service": s.opts.Name,
	})

	// Warm every allowlisted peer: the paths are then being arranged (and each
	// peer's state is visible on the peers page) from the start, instead of
	// only once a peer dials in — which, for the reverse direction, may be
	// never until traffic.
	if err == nil {
		p2pHost.warmPeers(s.opts.Peers)
	}

	// Stats carry over across a restart, like the other tunnel types.
	pStats := xstats.NewStats(false)
	{
		prev := s.Stats()
		pStats.Add(stats.KindInputBytes, int64(prev.InputBytes))
		pStats.Add(stats.KindOutputBytes, int64(prev.OutputBytes))
		pStats.Add(stats.KindTotalConns, int64(prev.TotalConns))
		pStats.Add(stats.KindTotalErrs, int64(prev.TotalErrs))
	}
	// The route is a plain listener, not an x listener, so it does not wrap
	// accepted conns itself: hand it the stats the service reports.
	peerLn.setStats(pStats)

	// Every inbound stream is forwarded straight to the backend endpoint: no
	// chain, the peer's stream is the whole path (the entrypoint wiring minus
	// the chain).
	h := local.NewHandler(
		handler.RouterOption(xchain.NewRouter(chain.LoggerRouterOption(log))),
		handler.LoggerOption(log),
	)
	if err = h.Init(mdx.NewMetadata(nil)); err != nil {
		p2pHost.unregister(ln)
		p2pHost.release()
		return
	}
	if fwd, ok := h.(handler.Forwarder); ok {
		fwd.Forward(hop.NewHop(
			hop.NodeOption(chain.NewNode(s.opts.Name, s.opts.Endpoint)),
			hop.LoggerOption(log),
		))
	}
	forward := xservice.NewService(s.opts.Name, peerLn, h,
		xservice.LoggerOption(log),
		xservice.StatsOption(pStats),
	)

	s.mu.Lock()
	s.forward, s.ln = forward, ln
	s.mu.Unlock()

	go func() {
		serveErr := forward.Serve()
		if serveErr != nil {
			log.Error("p2p tunnel serve error", "err", serveErr)
		}
		s.setErr(serveErr)
	}()

	return nil
}

// normalizePeerAliases fills in a display name for every allowlisted key:
// known aliases are kept, a key without one gets a random one, and aliases of
// keys no longer listed are dropped. Nil means no peers, hence no aliases.
func NormalizePeerAliases(peers []string, known map[string]string) map[string]string {
	if len(peers) == 0 {
		return nil
	}

	used := make(map[string]bool, len(peers))
	aliases := make(map[string]string, len(peers))
	for _, p := range peers {
		if a := known[p]; a != "" {
			aliases[p] = a
			used[a] = true
		}
	}
	for _, p := range peers {
		if aliases[p] != "" {
			continue
		}
		a := randomPeerAlias(used)
		aliases[p] = a
		used[a] = true
	}
	return aliases
}

// peerAliasAlphabet keeps aliases typeable: lowercase letters and digits.
const peerAliasAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

// randomPeerAlias returns a short "peer-xxxx" label no name in used repeats.
func randomPeerAlias(used map[string]bool) string {
	for {
		b := make([]byte, 4)
		for i := range b {
			b[i] = peerAliasAlphabet[rand.IntN(len(peerAliasAlphabet))]
		}
		a := "peer-" + string(b)
		if !used[a] {
			return a
		}
	}
}

// PeerStatsReporter is implemented by tunnels that account for traffic per
// peer (the tunnel page and the API list what it returns).
type PeerStatsReporter interface {
	PeerStats() []PeerStat
}

// PeerStatsUpdater is implemented by tunnels whose per-peer counters need a
// tick to turn into rates (the stats task calls it, like SetStats).
type PeerStatsUpdater interface {
	UpdatePeerStats()
}

// PeerStat is one peer's traffic through a p2p tunnel, as the tunnel page
// lists it. The counters cover the tunnel's current run — a restart starts
// them over, unlike the tunnel-wide totals.
type PeerStat struct {
	Key             string
	CurrentConns    uint64
	TotalConns      uint64
	InputBytes      uint64
	OutputBytes     uint64
	InputRateBytes  uint64
	OutputRateBytes uint64
}

// PeerStats reports each allowlisted peer's traffic, in allowlist order; a
// peer that never connected reports zeros. Counters are live, the rates are
// the ones UpdatePeerStats derived for its last window (zero until it ticks).
// Nil while the tunnel is not running (there is no route to count on).
func (s *p2pTunnel) PeerStats() []PeerStat {
	s.mu.RLock()
	ln, snapshot := s.ln, s.peerStats
	peers := append([]string(nil), s.opts.Peers...)
	s.mu.RUnlock()

	pl, _ := ln.(*peerListener)
	if pl == nil {
		return nil
	}

	out := peerCounters(pl, peers)
	for i := range out {
		// The snapshot is in allowlist order too, so the rates line up by
		// position.
		if i < len(snapshot) {
			out[i].InputRateBytes = snapshot[i].InputRateBytes
			out[i].OutputRateBytes = snapshot[i].OutputRateBytes
		}
	}
	return out
}

// UpdatePeerStats snapshots the live per-peer counters, deriving each rate
// from the previous snapshot; the stats task calls it on every tick, the way
// it refreshes the tunnel's own stats.
func (s *p2pTunnel) UpdatePeerStats() {
	s.mu.Lock()
	defer s.mu.Unlock()

	pl, _ := s.ln.(*peerListener)
	if pl == nil {
		s.peerStats, s.peerStatsAt = nil, time.Time{}
		return
	}

	now := time.Now()
	d := now.Sub(s.peerStatsAt)
	prev := make(map[string]PeerStat, len(s.peerStats))
	for _, p := range s.peerStats {
		prev[p.Key] = p
	}

	snapshot := peerCounters(pl, s.opts.Peers)
	if d > 0 {
		for i, p := range snapshot {
			before := prev[p.Key]
			snapshot[i].InputRateBytes = rate(p.InputBytes, before.InputBytes, d)
			snapshot[i].OutputRateBytes = rate(p.OutputBytes, before.OutputBytes, d)
		}
	}
	s.peerStats, s.peerStatsAt = snapshot, now
}

// peerCounters pairs every peer in the allowlist snapshot with its live
// counters, in allowlist order.
func peerCounters(pl *peerListener, peers []string) []PeerStat {
	traffic := pl.peerTraffic()
	out := make([]PeerStat, 0, len(peers))
	for _, k := range peers {
		st := PeerStat{Key: k}
		if c := traffic[k]; c != nil {
			st.CurrentConns = c.Get(stats.KindCurrentConns)
			st.TotalConns = c.Get(stats.KindTotalConns)
			st.InputBytes = c.Get(stats.KindInputBytes)
			st.OutputBytes = c.Get(stats.KindOutputBytes)
		}
		out = append(out, st)
	}
	return out
}

// rate returns the per-second rate between two cumulative counters over d. A
// counter that went backwards (a replaced route) reads as no traffic.
func rate(current, previous uint64, d time.Duration) uint64 {
	if current <= previous || d <= 0 {
		return 0
	}
	return uint64(float64(current-previous) / d.Seconds())
}

// SetPeers applies a new inbound allowlist in place: the process-wide host's
// routes are reconciled (all-or-nothing) and the tunnel's options are swapped,
// so the service and its listener keep running and a live peer stream is not
// cut. The allowlist gates NEW streams: a removed peer's established streams
// run until they end on their own, and its counters leave the list.
func (s *p2pTunnel) SetPeers(peers []string, aliases map[string]string) error {
	if s.IsClosed() {
		return ErrTunnelClosed
	}

	s.mu.RLock()
	pl, _ := s.ln.(*peerListener)
	s.mu.RUnlock()
	if pl == nil {
		return errors.New("p2p tunnel is not running")
	}

	normalized := NormalizePeerAliases(peers, aliases)
	if err := p2pHost.reconcile(pl, peers); err != nil {
		return err
	}

	s.mu.Lock()
	s.opts.Peers = peers
	s.opts.PeerAliases = normalized
	s.mu.Unlock()

	// A peer added here must get the same head start a peer configured at Run
	// time does, or its row would stay blank until it happens to dial in.
	p2pHost.warmPeers(peers)
	return nil
}

// Close stops the service, drops the peer routes and gives the manager
// reference back. It is idempotent; the shared identity file is kept.
func (s *p2pTunnel) Close() error {
	defer func() {
		select {
		case <-s.cclose:
		default:
			close(s.cclose)
		}
	}()

	s.mu.Lock()
	forward, ln := s.forward, s.ln
	s.forward, s.ln = nil, nil
	s.mu.Unlock()

	var err error
	if forward != nil {
		err = forward.Close()
	}
	// ln is set exactly when Run claimed the routes, so a tunnel that never
	// acquired (or rolled back a failed Run) releases nothing here.
	if ln != nil {
		p2pHost.unregister(ln)
		p2pHost.release()
	}
	return err
}

func (s *p2pTunnel) IsClosed() bool {
	select {
	case <-s.cclose:
		return true
	default:
		return false
	}
}

func (s *p2pTunnel) Err() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.err
}

func (s *p2pTunnel) setErr(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil && s.err == nil {
		s.err = err
	}
}
