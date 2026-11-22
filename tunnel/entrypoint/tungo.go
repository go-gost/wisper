package entrypoint

import (
	"errors"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	cfg "github.com/go-gost/wisper/config"
	"github.com/go-gost/wisper/tunnel"
	xconfig "github.com/go-gost/x/config"
	_ "github.com/go-gost/x/connector/relay" // chain node connector: a relay request to the hub
	"github.com/go-gost/x/registry"
	xservice "github.com/go-gost/x/service"
	"github.com/google/uuid"
)

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
	// rules is the object registered under rulesName. init replaces it on every
	// run, and SetRules updates it in place, so it is guarded by mu.
	rules  *tunnel.RuleBypass
	config *xconfig.Config

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

	// Rules are read under the same lock Options() takes: a hot edit can
	// replace them while init runs. The clone is this init's own copy, so
	// neither the registry object nor the config below reaches the caller's
	// slice.
	s.mu.RLock()
	rules := slices.Clone(s.opts.Rules)
	s.mu.RUnlock()

	ruleBypass := tunnel.NewRuleBypass(rules)
	registry.BypassRegistry().Unregister(s.rulesName)
	if err := registry.BypassRegistry().Register(s.rulesName, ruleBypass); err != nil {
		return err
	}
	// Keep the object, not only its name: a rebuilt entrypoint reuses the name,
	// so a Close that unregisters must be able to tell whether this instance
	// registered anything, and a rules edit mutates this object in place
	// instead of re-registering.
	s.mu.Lock()
	s.rules = ruleBypass
	s.mu.Unlock()

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
	node.Addr = s.peer
	node.Connector = &xconfig.ConnectorConfig{Type: "relay"}
	node.Dialer = &xconfig.DialerConfig{Type: "tcp"}
	node.Metadata = map[string]any{"p2p": s.provider}

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

// Run is the lifecycle — the device claim, the shared host reference and the
// service — which this type does not build yet. It reports that rather than
// half-starting a service with no device behind it.
func (s *tungoEntryPoint) Run() error {
	return errors.New("tungo entrypoint: the run lifecycle is not implemented yet")
}

// Status has no service to report on until there is a run to serve.
func (s *tungoEntryPoint) Status() *xservice.Status { return nil }

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

// Close releases what init registered. The device claim, the shared host
// reference and the service arrive with the run lifecycle; the rules bypass is
// what exists now, and it must not outlive the entrypoint — the name is reused
// when an entrypoint is replaced. Idempotent.
func (s *tungoEntryPoint) Close() error {
	s.closeOnce.Do(func() {
		close(s.cclose)
		registry.BypassRegistry().Unregister(s.rulesName)
	})
	return nil
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
