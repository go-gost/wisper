package entrypoint

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-gost/core/chain"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/listener"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/core/service"
	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/event"
	"github.com/go-gost/wisper/tunnel"
	xchain "github.com/go-gost/x/chain"
	xconfig "github.com/go-gost/x/config"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	_ "github.com/go-gost/x/connector/relay" // chain node connector: a relay request to the hub
	_ "github.com/go-gost/x/dialer/tcp"      // chain node dialer: the relay request rides a p2p tcp stream
	tungohandler "github.com/go-gost/x/handler/tungo"
	tungolistener "github.com/go-gost/x/listener/tungo"
	mdx "github.com/go-gost/x/metadata"
	xstats "github.com/go-gost/x/observer/stats"
	"github.com/go-gost/x/registry"
	xservice "github.com/go-gost/x/service"
	"github.com/google/uuid"
)

// The device step is the one part of a run a test cannot take: a real tun
// device needs CAP_NET_ADMIN, or the app's VpnService on Android, and building
// one rewrites the running host's routes. It is a package var so a test can put
// a loopback listener — or one that cannot be built — in its place and drive the
// whole lifecycle.
var newDeviceListener = tungolistener.NewListener

// sharedDevice says whether the device is the app's own — Android's single
// VpnService device — rather than one this process creates. Only that device has
// to be claimed from the other entrypoints, and only it arrives as an fd handed
// over out of band. A var, not a constant, for the same reason: a test can drive
// both on a desktop build. Production reads the build's OS, as tun.go does.
var sharedDevice = runtime.GOOS == "android"

// tungoEntryPoint is the split spoke: it owns a tun device (on Android the
// app's VpnService device) whose flows are terminated by a userspace stack by
// the tungo handler, and each flow either rides a relay request over a p2p tcp
// stream to the hub or is dialled by this device directly. The choice is a
// whitelist bypass on the chain's hop, so the rules are the same kind a
// gateway's tproxy uses and everything unlisted leaves through the phone's own
// network.
type tungoEntryPoint struct {
	opts tunnel.Options
	peer string
	// provider is the p2p registry name, unique per entrypoint.
	provider string
	// rulesName is the bypass registry name the chain hop references.
	rulesName string
	// rules is the object this instance registered under rulesName. A
	// replacement reuses the name (an update keeps the ID), so Close compares
	// this object with the registry's current one and leaves a successor's rules
	// alone; a rules edit mutates this object in place instead of
	// re-registering.
	rules  *tunnel.RuleBypass
	config *xconfig.Config

	forward  service.Service
	acquired bool // holds one reference on the shared p2p host
	claimed  bool // holds the app's single VPN device

	favorite      atomic.Bool
	stats         cfg.ServiceStats
	statsBaseline cfg.ServiceStats

	cclose    chan struct{}
	closeOnce sync.Once
	err       error
	mu        sync.RWMutex
}

// NewTungoEntryPoint creates a tungo entrypoint: a device whose listed
// destinations exit through the shared p2p host to the peer's public key and
// whose remaining destinations are dialled directly.
func NewTungoEntryPoint(opts ...tunnel.Option) EntryPoint {
	var options tunnel.Options
	for _, opt := range opts {
		opt(&options)
	}

	if options.ID == "" {
		options.ID = uuid.NewString()
	}
	if options.MTU <= 0 {
		options.MTU = tunnel.DefaultTunMTU
	}
	if options.Name == "" {
		options.Name = "tungo-ep-" + options.ID
		if len(options.ID) > 8 {
			options.Name = "tungo-ep-" + options.ID[:8]
		}
	}
	if options.CreatedAt.IsZero() {
		options.CreatedAt = time.Now()
	}

	return &tungoEntryPoint{
		opts:      options,
		peer:      options.Peer,
		provider:  "tungo-ep-" + options.ID,
		rulesName: "tungo-rules-" + options.ID,
		cclose:    make(chan struct{}),
	}
}

func (s *tungoEntryPoint) ID() string   { return s.opts.ID }
func (s *tungoEntryPoint) Type() string { return TungoEntryPoint }
func (s *tungoEntryPoint) Name() string { return s.opts.Name }

// Endpoint is the "public side" value — here the hub's base64 public key, the
// counterpart of a tunnel's public URL.
func (s *tungoEntryPoint) Endpoint() string { return s.peer }

// Entrypoint is the device address. A tungo entrypoint binds no local socket,
// so the device address is what identifies it.
func (s *tungoEntryPoint) Entrypoint() string { return s.opts.Net }

// Options returns the entrypoint's configuration. Rules is copied because it is
// the one field an edit can reach in place (SetRules); the rest is immutable
// after New.
func (s *tungoEntryPoint) Options() tunnel.Options {
	s.mu.RLock()
	defer s.mu.RUnlock()
	opts := s.opts
	opts.Rules = append([]string(nil), s.opts.Rules...)
	return opts
}

func (s *tungoEntryPoint) Favorite(b bool)  { s.favorite.Store(b) }
func (s *tungoEntryPoint) IsFavorite() bool { return s.favorite.Load() }

// init builds the service description: a tungo listener over a tungo handler
// (client mode — the chain and no forwarder is what selects it), with the rule
// list on the hop as a whitelist.
//
// The hop's bypasses are resolved from the registry by name, so the rule object
// is registered here and the config's own Bypasses entry only describes it: a
// config.Bypasses entry that nothing registered is never parsed.
func (s *tungoEntryPoint) init() error {
	// Without the peer there is no node to build: the chain's one hop is the
	// link to the hub, so a peerless entrypoint has nothing to assemble.
	if s.peer == "" {
		return errors.New("tungo entrypoint requires a peer public key")
	}

	svc := &xconfig.ServiceConfig{
		Name: s.opts.Name,
		// The tungo listener binds no socket: the address only labels the service.
		Addr: ":0",
		Handler: &xconfig.HandlerConfig{
			Type:  "tungo",
			Chain: s.opts.Name,
		},
		Listener: &xconfig.ListenerConfig{
			Type: "tungo",
			Metadata: map[string]any{
				"name":   s.opts.DeviceName,
				"mtu":    s.opts.MTU,
				"net":    s.opts.Net,
				"routes": s.opts.Routes,
				"dns":    s.opts.DNS,
			},
		},
	}

	// Android: the device is a VpnService's, created and configured on the Java
	// side, and its fd reaches us outside the config. Each device asks for one
	// when it is built (so a rebuilt VPN or a restarted entrypoint gets a live
	// descriptor), and waits rather than failing: the app can only establish the
	// VPN once the backend — and this entrypoint — is already running.
	if sharedDevice {
		svc.Listener.Metadata["fd"] = func() int {
			return tunnel.WaitTunFD(vpnDeviceWait)
		}
	}

	// Patch the tunnel chain into a split chain: the node dials the peer's
	// public key through the embedded host's tunnel (metadata.p2p selects the
	// provider) and speaks the relay protocol over that stream, so the hub's
	// relay service decides the outlet. The hop carries the rule list, so a
	// listed destination selects this node and an unlisted one selects none —
	// which is the empty route that dials direct.
	chCfg := tunnel.ChainConfig(s.opts.ID, s.opts.Name, s.opts.RecordMode)
	hop := chCfg.Hops[0]
	hop.Bypasses = []string{s.rulesName}
	node := hop.Nodes[0]
	// ChainConfig describes the tunnel connector (tunnel.id, record.mode) and
	// this split swaps that connector for the relay one, so those keys move onto
	// the node rather than going away with the connector: the node still belongs
	// to this tunnel, and a key ChainConfig adds later is carried too. The p2p
	// marker is added to that map, never put in its place — which is what a
	// wholesale replacement did.
	nodeMD := make(map[string]any, len(node.Metadata)+len(node.Connector.Metadata)+1)
	for k, v := range node.Metadata {
		nodeMD[k] = v
	}
	for k, v := range node.Connector.Metadata {
		nodeMD[k] = v
	}
	nodeMD["p2p"] = s.provider
	node.Metadata = nodeMD

	node.Addr = s.peer
	node.Connector = &xconfig.ConnectorConfig{Type: "relay"}
	node.Dialer = &xconfig.DialerConfig{Type: "tcp"}

	// The rules, the object that holds them and the config that describes them
	// are written in one critical section, and only after everything that does
	// not depend on them is assembled. Two sections would leave a window a hot
	// edit (SetRules) could land in, where this init's snapshot — taken before
	// the edit — would be assigned over it: the split would answer API calls with
	// the new list and route with the old one until the next restart.
	s.mu.Lock()
	defer s.mu.Unlock()

	// The clone is this init's own copy: neither the registry object nor the
	// config below reaches the caller's slice.
	rules := slices.Clone(s.opts.Rules)
	// The logger is the service's own, so the bypass's debug line — which
	// address was decided which way, and the rule it matched — is read in the
	// same stream as the rest of this entrypoint's log.
	ruleBypass := tunnel.NewRuleBypass(rules, tunnel.RuleBypassLoggerOption(p2pLog().WithFields(map[string]any{
		"kind":    "service",
		"service": s.opts.Name,
		"rules":   s.rulesName,
	})))
	registry.BypassRegistry().Unregister(s.rulesName)
	if err := registry.BypassRegistry().Register(s.rulesName, ruleBypass); err != nil {
		// The Unregister above took whatever this name held — this entrypoint's
		// previous object, if it had one — so nothing is registered now: keeping
		// the pointer would let a later Close unregister a name this init did
		// not fill.
		s.rules = nil
		return err
	}
	s.rules = ruleBypass

	// A Close can have landed before this section: it snapshotted no rules (or a
	// previous object), and closeOnce means it never looks again, so this init is
	// the only one left to take the entry back. The identity test is the one
	// Close uses — a successor that reuses the name keeps its own rules.
	if s.IsClosed() {
		if registry.BypassRegistry().GetAll()[s.rulesName] == ruleBypass {
			registry.BypassRegistry().Unregister(s.rulesName)
		}
		s.rules = nil
		return ErrEntryPointClosed
	}

	s.config = &xconfig.Config{
		Services: []*xconfig.ServiceConfig{svc},
		Chains:   []*xconfig.ChainConfig{chCfg},
		Bypasses: []*xconfig.BypassConfig{
			{
				Name:      s.rulesName,
				Whitelist: true,
				// The registry object is the runtime authority; this copy only
				// describes it, so it keeps its own slice.
				Matchers: rules,
			},
		},
	}
	return nil
}

// SetRules replaces the split list in place. It is what an API rules edit uses:
// the run keeps its device, its counters and the flows already on the wire, and
// only the next destination decision changes.
//
// The edit and init's own writes are serialized by the same lock, so an edit can
// never be overwritten by an init that read the list before it: the rules a
// running split uses are the last ones saved.
func (s *tungoEntryPoint) SetRules(rules []string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.opts.Rules = slices.Clone(rules)
	if s.rules != nil {
		s.rules.SetRules(s.opts.Rules)
	}
	// The config only describes the split, but it is what the saved file would
	// say if this process were asked again — a description that keeps the old
	// list would be the only copy of it left after a restart.
	if s.config != nil {
		for _, bp := range s.config.Bypasses {
			if bp.Name == s.rulesName {
				bp.Matchers = slices.Clone(rules)
			}
		}
	}
}

// ChainConfig returns the chain this entrypoint's flows are dialled through —
// the config init assembles — and assembles it on first use, so a caller that
// is not Run can reach the same wiring without taking the device. The chain is
// the split itself: the relay node over the p2p link, with the rule whitelist
// on its hop. Anything that has to dial it (Run's parser, or a test carrying
// traffic over the peer) reads this one assembly instead of rebuilding a copy
// that would prove nothing about the product.
//
// On a fresh entrypoint this runs init, which registers the hop's rules bypass
// in the global registry: the caller owns that registration and must take it
// down itself (Close does, on the Run path) — nothing else will.
func (s *tungoEntryPoint) ChainConfig() (*xconfig.ChainConfig, error) {
	// The assembled config is guarded like the rules it describes: SetRules
	// updates that description in place, so init's write and this read have to be
	// ordered the same way.
	s.mu.RLock()
	cfg := s.config
	s.mu.RUnlock()

	if cfg == nil {
		if err := s.init(); err != nil {
			return nil, err
		}
		s.mu.RLock()
		cfg = s.config
		s.mu.RUnlock()
	}
	return cfg.Chains[0], nil
}

func (s *tungoEntryPoint) Run() error { return s.RunContext(context.Background()) }

// RunContext is Run carrying the caller's action id: the shared host's
// acquisition (Listen) and the peer's punch name it in their p2p seam log lines,
// so a start that came from the UI can be joined with the p2p work it set in
// motion. Run is this with no action, for the config-load and restart paths — an
// Android restore starts from a background goroutine, where the id is still only
// ever read for a log field.
func (s *tungoEntryPoint) RunContext(ctx context.Context) (err error) {
	if s.IsClosed() {
		return ErrEntryPointClosed
	}

	// Every failure below is the entrypoint's reported state, not only a return
	// value: a restored start runs off the startup path and an API start answers
	// before a device exists, so the list has nothing but this field and the
	// event log to say why an entrypoint is not serving.
	defer func() {
		// A closed entrypoint is a deliberate stop, not a failure: the marker
		// exists so a start that raced its own Close ends like one stopped later.
		if err != nil && !errors.Is(err, ErrEntryPointClosed) {
			s.fail(err)
		}
	}()

	// Without the peer there is no node to build: the chain's one hop is the link
	// to the hub, so a peerless entrypoint has nothing to serve.
	if s.peer == "" {
		return errors.New("tungo entrypoint requires a peer public key")
	}

	if err = s.init(); err != nil {
		return
	}

	// The identity is process-wide: take a reference on the shared host. A failed
	// relay connection is not fatal: the engine retries in the background and the
	// entrypoint keeps running, so it is logged rather than failing the Run.
	host, err := tunnel.AcquireP2PHost(ctx)
	if err != nil {
		return
	}
	// Until the service is wired, Run owns the reference, the provider
	// registration and the device claim; afterwards Close gives them back. A
	// failure from here on rolls all three back: a claim left behind refuses
	// every later start of this device, and a dropped object cannot release what
	// it no longer points at.
	started := false
	defer func() {
		if !started {
			registry.P2PRegistry().Unregister(s.provider)
			tunnel.ReleaseP2PHost()
			s.releaseDevice()
		}
	}()

	// One device at a time: on Android the app has a single VpnService device, and
	// every device built from its fd reads the same packets, so a second
	// entrypoint would take them from the first instead of adding a link. The web
	// API checks the same thing before it answers a start.
	if err = s.claimDevice(); err != nil {
		return
	}

	// Register the provider before parsing the chain: the chain node resolves
	// metadata.p2p by name at parse time. The Unregister clears a stale
	// registration left by a previous Run in this process.
	registry.P2PRegistry().Unregister(s.provider)
	if err = registry.P2PRegistry().Register(s.provider, p2pProvider{host}); err != nil {
		return
	}

	log := p2pLog().WithFields(map[string]any{
		"kind":    "service",
		"service": s.opts.Name,
	})

	// The peer is known up front and this side is the one that dials out, so bring
	// its path up and punch now: the direct path is being arranged (and visible in
	// the status) before the first flow, instead of waiting for traffic. Punch
	// failures are logged, never fatal.
	if err := host.PunchContext(ctx, s.peer); err != nil {
		slog.Warn("tungo entrypoint: punch peer", "peer", s.peer, "err", err)
		event.Record(s.ID(), event.LevelWarn, "punch %s failed: %v", s.peer, err)
	}

	var forward service.Service
	{
		var (
			ch       chain.Chainer
			chainCfg *xconfig.ChainConfig
		)
		// init above already assembled this, and the seam is read rather than
		// rebuilt so a test dials the chain Run parses. A failure is still not
		// something to swallow: ParseChain(nil) yields a nil chain, and x's
		// router then falls back to DefaultRoute — every destination would leave
		// the phone unmasked while the entrypoint still reported running.
		chainCfg, err = s.ChainConfig()
		if err != nil {
			return
		}
		ch, err = chain_parser.ParseChain(chainCfg, log)
		if err != nil {
			log.Error(err)
			return
		}

		// The device listener counts, like every other spoke's listener: x adds
		// handler errors to the service's counters and nothing else, so the
		// listener is the only writer of the connections and bytes and there is no
		// double count. (A device is one conn for the entrypoint's lifetime; that
		// reading belongs to the hub's device handler, not to these totals.)
		pStats := xstats.NewStats(false)
		{
			// The totals a restarted entrypoint already displayed carry over: the
			// counters are the run's, the display is the entrypoint's.
			prev := s.Stats()
			pStats.Add(stats.KindInputBytes, int64(prev.InputBytes))
			pStats.Add(stats.KindOutputBytes, int64(prev.OutputBytes))
			pStats.Add(stats.KindTotalConns, int64(prev.TotalConns))
			pStats.Add(stats.KindTotalErrs, int64(prev.TotalErrs))
		}

		// Under the same lock init writes it with: SetRules edits this config in
		// place, so an unguarded read here would be an unsynchronized read of the
		// very struct an edit is rewriting.
		s.mu.RLock()
		svcCfg := s.config.Services[0]
		s.mu.RUnlock()
		lnLogger := log.WithFields(map[string]any{"kind": "listener", "listener": "tungo"})
		ln := newDeviceListener(
			listener.AddrOption(svcCfg.Addr),
			listener.LoggerOption(lnLogger),
			listener.StatsOption(pStats),
		)
		// Init builds the device (and waits for the VpnService's fd on Android), so
		// a failure here fails the whole Run. The listener must be closed on the way
		// out: its loop retries a device creation that cannot succeed — one line per
		// second, forever, for an object that is about to be discarded.
		if err = ln.Init(mdx.NewMetadata(svcCfg.Listener.Metadata)); err != nil {
			ln.Close()
			return
		}

		handlerLogger := log.WithFields(map[string]any{"kind": "handler", "handler": "tungo"})
		// The chain (and no forwarder hop) is the client-mode switch: the stack's
		// flows are dialled through the chain node, which is the peer, and the hop's
		// whitelist bypass decides between that node and the direct route.
		h := tungohandler.NewHandler(
			handler.RouterOption(xchain.NewRouter(
				chain.ChainRouterOption(ch),
				chain.LoggerRouterOption(handlerLogger),
			)),
			handler.LoggerOption(handlerLogger),
		)
		if err = h.Init(mdx.NewMetadata(svcCfg.Handler.Metadata)); err != nil {
			ln.Close()
			return
		}

		forward = xservice.NewService(s.opts.Name, ln, h,
			xservice.LoggerOption(log),
			xservice.StatsOption(pStats),
		)
	}

	s.mu.Lock()
	// A restored Android entrypoint is started off the startup path, so Close can
	// land while this Run is still waiting for its device. Under this lock is the
	// only place that can be told apart: Close closes cclose before it takes the
	// lock, so a Run that sees it here must not publish its service — nothing
	// would ever close it.
	closed := s.IsClosed()
	if !closed {
		s.forward, s.acquired = forward, true
	}
	s.mu.Unlock()

	if closed {
		_ = forward.Close()
		return ErrEntryPointClosed // the deferred rollback releases the claim and the rest
	}

	started = true // the service, the reference, the provider and the claim are Close's now

	go func() {
		serveErr := forward.Serve()
		if tunnel.CleanStop(serveErr) {
			log.Info("tungo entrypoint stopped")
			s.setErr(nil)
		} else {
			log.Errorf("tungo entrypoint stopped with error: %v", serveErr)
			s.fail(serveErr)
		}
	}()

	return nil
}

// claimDevice takes the app's single VPN device for this entrypoint. The claim is
// taken under the lock Close reads it with, so a Close that lands while a start is
// claiming either sees the claim (and releases it) or is seen here (and refuses
// to claim): the device cannot be left claimed by a run whose Close has already
// returned. A device that is not the app's is this process's own — one per
// entrypoint — and needs no claim.
func (s *tungoEntryPoint) claimDevice() error {
	if !sharedDevice {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.IsClosed() {
		return ErrEntryPointClosed
	}
	if owner, ok := tunnel.ClaimTunDevice(s.opts.ID, s.opts.Name); !ok {
		return fmt.Errorf("tun device is in use by entrypoint %q: stop it first", owner)
	}
	s.claimed = true
	return nil
}

// releaseDevice gives the app's device back if this run took it. A start that was
// refused never took it and must not release what the holder has — an update
// keeps the ID, so both carry the same one.
func (s *tungoEntryPoint) releaseDevice() {
	s.mu.Lock()
	claimed := s.claimed
	s.claimed = false
	s.mu.Unlock()

	if claimed {
		tunnel.ReleaseTunDevice(s.opts.ID)
	}
}

// fail records a failure where the list can show it: the field the row reads, and
// an event for the history. Without both, a start that died before serving reads
// as a silently stopped entrypoint.
func (s *tungoEntryPoint) fail(err error) {
	s.setErr(err)
	event.Record(s.ID(), event.LevelError, "tungo entrypoint: %v", err)
}

func (s *tungoEntryPoint) Status() *xservice.Status {
	s.mu.RLock()
	forward := s.forward
	s.mu.RUnlock()

	if ss, _ := forward.(tunnel.ServiceStatus); ss != nil {
		return ss.Status()
	}
	return nil
}

func (s *tungoEntryPoint) Stats() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stats
}

func (s *tungoEntryPoint) SetStats(stats cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stats = stats
}

func (s *tungoEntryPoint) StatsBaseline() cfg.ServiceStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.statsBaseline
}

func (s *tungoEntryPoint) SetStatsBaseline(baseline cfg.ServiceStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.statsBaseline = baseline
}

// Close stops the service (which closes the device), unregisters the provider and
// the rules bypass, gives the shared host reference and the app's device back,
// and is idempotent. The shared identity file is kept so stop/start keeps the
// same key.
func (s *tungoEntryPoint) Close() error {
	var err error
	s.closeOnce.Do(func() {
		close(s.cclose)

		s.mu.Lock()
		forward, acquired := s.forward, s.acquired
		s.forward, s.acquired = nil, false
		rules := s.rules
		s.mu.Unlock()

		if forward != nil {
			err = forward.Close()
		}
		// Only the first Close may touch the shared registry: a replacement
		// reuses the name (the ID survives an update), and Unregister closes the
		// value it finds, so a repeat call would take the successor's p2p host
		// down with the name. Unregistering by name — not by identity, as the
		// rules below are — is safe because every swap path (Restart,
		// restartRunning, handleStartEntrypoint) closes the old instance before a
		// same-ID successor is constructed, so the name cannot hold one here.
		registry.P2PRegistry().Unregister(s.provider)
		if acquired {
			tunnel.ReleaseP2PHost()
		}
		// A start that was refused never claimed the device; releasing it anyway
		// would free what another entrypoint — same ID across an update — holds.
		s.releaseDevice()
		// The rules are the whole split, and their name is reused by a
		// replacement: unregister it only while the name still holds this
		// instance's object, so a Close arriving after a successor registered its
		// own leaves the successor's rules (and its split) in place. Get hands out
		// a delegating wrapper, so the identity test reads the registry's map.
		if rules != nil && registry.BypassRegistry().GetAll()[s.rulesName] == rules {
			registry.BypassRegistry().Unregister(s.rulesName)
		}
	})
	return err
}

func (s *tungoEntryPoint) IsClosed() bool {
	select {
	case <-s.cclose:
		return true
	default:
		return false
	}
}

func (s *tungoEntryPoint) setErr(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.err = err
}

func (s *tungoEntryPoint) Err() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.err
}
