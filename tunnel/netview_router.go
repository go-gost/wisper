package tunnel

import (
	"context"
	"errors"
	"io"
	"net"
	"net/netip"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/go-gost/core/logger"
	"github.com/go-gost/core/router"
	"github.com/go-gost/p2p/endpoint"
	xconfig "github.com/go-gost/x/config"
	chain_parser "github.com/go-gost/x/config/parsing/chain"
	_ "github.com/go-gost/x/connector/forward" // chain node connector for the control chain
	_ "github.com/go-gost/x/dialer/udp"        // chain node dialer for the control chain
	xlogger "github.com/go-gost/x/logger"
)

// NetviewRouter implements core/router.Router over the newest netview, with
// longest-prefix match. Registered by name so a listener references it with
// tun.router (x/listener/tun/metadata.go:37) instead of baking routes at
// init (tun.routes, metadata.go:70-121, which builds a fresh internal router
// and cannot change afterwards).
//
// One mutex guards the whole table the way rib's does: every operation is a
// read of the whole and a write of the whole — a netview is a full snapshot,
// so there is no partial state to publish.
type NetviewRouter struct {
	mu sync.Mutex
	// hub is the id of the netview currently installed. A netview from a
	// different hub id is a restarted hub and is accepted at any rev; from
	// the same hub only a strictly newer rev is.
	hub string
	rev uint64
	// gateway is the address the hub publishes for itself in the netview's
	// members: on a spoke every approved LAN is behind the hub, so it is the
	// next hop of every route here. Empty while the netview carries no entry
	// for the hub, and an empty gateway is consumed as "no route", which is
	// the spoke's behaviour today.
	gateway string
	// routes are the approved claims, sorted longest-prefix-first at Apply so
	// GetRoute's first match is the longest match.
	routes []netviewRoute
}

// netviewRoute is one approved prefix, with the net.IPNet form built once:
// GetRoute answers per packet and must not re-parse the claim.
type netviewRoute struct {
	prefix netip.Prefix
	ipNet  *net.IPNet
}

// NewNetviewRouter builds an empty router. It answers "no route" until the
// hub's first netview arrives — a spoke whose control channel never opens
// simply has no LAN routing, exactly as before.
func NewNetviewRouter() *NetviewRouter {
	return &NetviewRouter{}
}

// Apply installs a netview. A Rev that is not newer is ignored; a new Hub
// id resets the rev and is accepted.
//
// An accepted netview replaces the whole table unconditionally: the message
// is a full snapshot, so a route absent from it has been withdrawn. A claim
// that does not parse is skipped rather than failing the netview — one bad
// entry must not throw away the rest of the hub's view.
func (r *NetviewRouter) Apply(n netviewMessage) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// A netview without a hub id cannot be versioned against anything, so it
	// must never be able to wipe the installed table.
	if n.Hub == "" {
		return
	}
	if n.Hub == r.hub && n.Rev <= r.rev {
		return // a stale or duplicate push from the same hub
	}

	routes := make([]netviewRoute, 0, len(n.Claims))
	for _, c := range n.Claims {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(c.Prefix))
		if err != nil {
			continue
		}
		prefix = prefix.Masked()
		addr := prefix.Addr().AsSlice()
		routes = append(routes, netviewRoute{
			prefix: prefix,
			ipNet: &net.IPNet{
				IP:   addr,
				Mask: net.CIDRMask(prefix.Bits(), len(addr)*8),
			},
		})
	}
	// The hub's snapshot already arrives longest-first; sorting here means a
	// hand-built message gets longest-prefix match too.
	slices.SortFunc(routes, func(a, b netviewRoute) int {
		if a.prefix.Bits() != b.prefix.Bits() {
			return b.prefix.Bits() - a.prefix.Bits()
		}
		return strings.Compare(a.prefix.String(), b.prefix.String())
	})

	gateway := ""
	for _, m := range n.Members {
		if m.Key == n.Hub {
			gateway = strings.TrimSpace(m.IP)
			break
		}
	}

	r.hub, r.rev, r.gateway, r.routes = n.Hub, n.Rev, gateway, routes
}

// GetRoute returns the route for dst by longest-prefix match over the
// installed claims, or nil when no claim covers it — nil is what keeps an
// unclaimed destination on its existing fate. It satisfies core/router.Router.
func (r *NetviewRouter) GetRoute(ctx context.Context, dst string, opts ...router.Option) *router.Route {
	addr, ok := netviewDst(dst)
	if !ok {
		return nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	for _, rt := range r.routes {
		if rt.prefix.Contains(addr) {
			return &router.Route{Net: rt.ipNet, Dst: rt.ipNet.String(), Gateway: r.gateway}
		}
	}
	return nil
}

// netviewDst parses a route-lookup destination: a plain address from the
// packet paths, or a prefix from a hand-built caller. v4-mapped spellings are
// unmapped so one claim matches both; an IPv6 destination only ever matches
// an IPv6 claim, and a v4 claim can never capture it.
func netviewDst(dst string) (netip.Addr, bool) {
	dst = strings.TrimSpace(dst)
	if addr, err := netip.ParseAddr(dst); err == nil {
		return addr.Unmap(), true
	}
	if prefix, err := netip.ParsePrefix(dst); err == nil {
		return prefix.Addr().Unmap(), true
	}
	return netip.Addr{}, false
}

// controlRetryInterval is how long RunControlChannel waits between dials.
const controlRetryInterval = time.Second

// ControlChannelConfig is the spoke's control-channel wiring: the shared p2p
// host to punch and dial through, the hub's peer key, this spoke's claims,
// and the router the received netviews install into.
type ControlChannelConfig struct {
	Host     *endpoint.Endpoint // the shared p2p host, for PunchContext
	HubPeer  string             // the hub's peer key
	ShareLAN []string           // this spoke's claimed CIDRs, from share_lan
	Provider any                // the entrypoint's p2p provider, for the chain metadata
	Router   *NetviewRouter
	Log      logger.Logger
}

// controlLogger fills in a missing log with the process default, or a
// discarding one when no default is set (unit tests run without config.Init).
// Not cosmetic: chain_parser.ParseChain dereferences the logger it is handed,
// so a nil one would panic on the first dial attempt.
func controlLogger(log logger.Logger) logger.Logger {
	if log != nil {
		return log
	}
	if log := logger.Default(); log != nil {
		return log
	}
	return xlogger.NewLogger(xlogger.OutputOption(io.Discard))
}

// RunControlChannel dials the hub's peer key over a chain of the same shape
// as the tun link (forward connector, udp dialer, metadata p2p provider, no
// "p2p.network" so the stream is a byte stream), writes ControlMagic, then
// sends this spoke's share_lan as a claim and reads netviews until the conn
// dies, redialing every second. Failures are logged at debug and retried.
//
// It never returns an error and never gives up on its own: a spoke whose
// control channel never opens behaves exactly as it does without one — it
// reaches every member, claims nothing, and its LAN routing is simply absent.
// It returns only when ctx is done.
func RunControlChannel(ctx context.Context, cfg ControlChannelConfig) {
	cfg.Log = controlLogger(cfg.Log)

	if cfg.HubPeer == "" {
		cfg.Log.Debugf("control channel: no hub peer configured, LAN claims disabled")
		return
	}

	// The direct path is being arranged before the first dial, the way the
	// tun entrypoint punches. A failure is not fatal: the relay path still
	// carries the stream.
	if cfg.Host != nil {
		if err := cfg.Host.PunchContext(ctx, cfg.HubPeer); err != nil {
			cfg.Log.Debugf("control channel: punch %s: %v", cfg.HubPeer, err)
		}
	}

	for ctx.Err() == nil {
		if err := controlSession(ctx, cfg); err != nil {
			cfg.Log.Debugf("control channel: %v", err)
		}
		select {
		case <-ctx.Done():
		case <-time.After(controlRetryInterval):
		}
	}
}

// controlSession is one connect: dial, magic, claim, then netviews until the
// conn dies. A reconnect is a fresh session and re-sends the whole claim —
// that is how the hub learns the spoke survived, and a reconnect that forgot
// its claim would silently lose the spoke's LAN.
func controlSession(ctx context.Context, cfg ControlChannelConfig) error {
	// A chain per dial: a chain holds the node's connector state, so each
	// session builds its own and gives it back on the way out.
	chCfg := &xconfig.ChainConfig{
		Name: "netview",
		Hops: []*xconfig.HopConfig{
			{
				Name: "netview",
				Nodes: []*xconfig.NodeConfig{
					{
						Name:      "netview",
						Addr:      cfg.HubPeer,
						Connector: &xconfig.ConnectorConfig{Type: "forward"},
						Dialer:    &xconfig.DialerConfig{Type: "udp"},
						// No "p2p.network": that marker makes the tun link a
						// datagram tunnel session-scoped to the peer session;
						// the control stream wants a plain byte stream.
						Metadata: map[string]any{"p2p": cfg.Provider},
					},
				},
			},
		},
	}
	ch, err := chain_parser.ParseChain(chCfg, cfg.Log)
	if err != nil {
		return err
	}
	defer func() {
		if c, ok := ch.(io.Closer); ok {
			_ = c.Close()
		}
	}()

	rt := ch.Route(ctx, "ip", cfg.HubPeer)
	if rt == nil {
		return errors.New("no route to hub " + cfg.HubPeer)
	}
	conn, err := rt.Dial(ctx, "ip", cfg.HubPeer)
	if err != nil {
		return err
	}
	defer conn.Close()

	// Wake the read loop when the caller cancels: the conn is a stream read,
	// not a select, and closing it is what unblocks it.
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-stop:
		}
	}()

	if _, err := conn.Write(ControlMagic); err != nil {
		return err
	}
	// The whole claim, once per successful connect: the hub reads it as the
	// spoke's current intent, and a repeat after a reconnect refreshes it.
	if err := writeMessage(conn, claimMessage{
		Type: ctrlTypeClaim,
		V:    ctrlVersion,
		Add:  cfg.ShareLAN,
	}); err != nil {
		return err
	}

	for {
		// Exactly one of n and the claim is non-zero (ctrl.go's contract);
		// the hub sends no claims, so a claim frame is validated and dropped.
		n, _, err := readMessage(conn)
		if err != nil {
			return err
		}
		if n.Type == ctrlTypeNetview && cfg.Router != nil {
			cfg.Router.Apply(n)
		}
	}
}
