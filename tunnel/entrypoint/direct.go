package entrypoint

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strings"
	"sync"
	"time"

	"github.com/go-gost/core/chain"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/listener"
	"github.com/go-gost/core/logger"
	"github.com/go-gost/core/observer/stats"
	"github.com/go-gost/core/service"
	"github.com/go-gost/p2p/endpoint"
	"github.com/go-gost/wisper/tunnel"
	tunhandler "github.com/go-gost/x/handler/tun"
	xservice "github.com/go-gost/x/service"
)

// directRuntime owns the opt-in mesh data path: the x mesh handler, the
// second-priority inbound route, the device supervisor, and the hub link.
//
// The hub link is deliberately dialled through the entrypoint's existing
// chain, not host.Dial: the chain is what carries record_mode and, on a
// userspace share, the tun-share connector. Direct links (Task 4) are the only
// connections that use the shared host directly, because they never carry LAN
// traffic.
// directHost is the part of the shared p2p endpoint the direct manager needs.
// Keeping it an interface lets the dial/backoff logic run without a relay.
type directHost interface {
	PunchContext(ctx context.Context, peer string) error
	Dial(ctx context.Context, network, peer string) (net.Conn, error)
}

// These are vars so a test can shorten the ready wait and the backoff without
// waiting the production five minutes.
var (
	directReadyTimeout = 10 * time.Second
	directBackoffSteps = []time.Duration{time.Second, 5 * time.Second, 30 * time.Second, 5 * time.Minute}
)

type directRuntime struct {
	host     directHost
	mesh     tunhandler.MeshHandler
	route    *tunnel.MeshRoute
	localKey string
	hubKey   string
	dialHub  func(context.Context) (net.Conn, error)
	log      logger.Logger

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	refreshMu    sync.Mutex
	mu           sync.Mutex
	allowed      map[string]bool
	inflight     map[string]bool
	backoff      map[string]time.Time
	steps        map[string]int
	backoffSteps []time.Duration
	members      []tunnel.NetviewMember
	blocked      []string

	hubLost chan struct{}
	once    sync.Once
}

func newDirectRuntime(
	host directHost,
	mesh tunhandler.MeshHandler,
	route *tunnel.MeshRoute,
	localKey, hubKey string,
	dialHub func(context.Context) (net.Conn, error),
	log logger.Logger,
) *directRuntime {
	return &directRuntime{
		host:         host,
		mesh:         mesh,
		route:        route,
		localKey:     localKey,
		hubKey:       hubKey,
		dialHub:      dialHub,
		log:          log,
		allowed:      make(map[string]bool),
		inflight:     make(map[string]bool),
		backoff:      make(map[string]time.Time),
		steps:        make(map[string]int),
		backoffSteps: append([]time.Duration(nil), directBackoffSteps...),
		hubLost:      make(chan struct{}, 1),
	}
}

func (d *directRuntime) start() {
	d.ctx, d.cancel = context.WithCancel(context.Background())
	d.mesh.SetDirectNeeded(d.onNeeded)
	d.mesh.SetLinkClosed(d.onClosed)
	d.route.SetPreempt(d.refreshLast)
	if d.dialHub != nil {
		d.wg.Add(1)
		go d.hubLoop()
	}
}

// Refresh rebuilds the mesh membership from the accepted netview and the
// local block list. The route decides which members may accept inbound direct
// streams; the mesh handler marks everyone else direct-off so its status and
// routing agree with that decision.
func (d *directRuntime) Refresh(members []tunnel.NetviewMember, claims []tunnel.NetviewClaim, blocked []string) {
	if d == nil {
		return
	}
	d.refreshMu.Lock()
	defer d.refreshMu.Unlock()
	_ = claims // direct links carry member tun IPs only, never LAN prefixes

	blockedSet := make(map[string]bool, len(blocked))
	for _, key := range blocked {
		blockedSet[key] = true
	}

	wanted := make([]string, 0, len(members))
	candidates := make([]tunhandler.MeshMember, 0, len(members))
	for _, m := range members {
		if m.Key == "" || m.Key == d.hubKey || m.Key == d.localKey {
			continue
		}
		addr, err := netip.ParseAddr(strings.TrimSpace(m.IP))
		if err != nil {
			continue
		}
		blocked := blockedSet[m.Key]
		direct := m.Direct && !m.Disabled && !blocked
		candidates = append(candidates, tunhandler.MeshMember{
			IP:       net.IP(addr.AsSlice()),
			Key:      m.Key,
			Name:     m.Name,
			Direct:   direct,
			Blocked:  blocked,
			Disabled: m.Disabled,
		})
		if direct {
			wanted = append(wanted, m.Key)
		}
	}

	claimed, _ := d.route.Reconcile(wanted)
	claimedSet := make(map[string]bool, len(claimed))
	for _, key := range claimed {
		claimedSet[key] = true
	}
	for i := range candidates {
		if candidates[i].Direct && !claimedSet[candidates[i].Key] {
			candidates[i].Direct = false
		}
	}
	d.mesh.SetMembers(candidates)

	d.mu.Lock()
	old := d.allowed
	d.allowed = claimedSet
	d.members = append([]tunnel.NetviewMember(nil), members...)
	d.blocked = append([]string(nil), blocked...)
	d.mu.Unlock()

	for key := range old {
		if !claimedSet[key] {
			d.mesh.DropLink(key)
		}
	}
}

func (d *directRuntime) refreshLast() {
	d.mu.Lock()
	members := append([]tunnel.NetviewMember(nil), d.members...)
	blocked := append([]string(nil), d.blocked...)
	d.mu.Unlock()
	d.Refresh(members, nil, blocked)
}

func (d *directRuntime) onNeeded(peer string) {
	d.mu.Lock()
	if !d.allowed[peer] || d.inflight[peer] {
		d.mu.Unlock()
		return
	}
	if until, ok := d.backoff[peer]; ok && time.Now().Before(until) {
		d.mu.Unlock()
		return
	}
	d.inflight[peer] = true
	d.mu.Unlock()

	d.wg.Add(1)
	go d.dial(peer)
}

func (d *directRuntime) dial(peer string) {
	defer d.wg.Done()
	if d.host == nil {
		d.fail(peer)
		return
	}
	_ = d.host.PunchContext(d.ctx, peer)
	conn, err := d.host.Dial(d.ctx, "ip", peer)
	if err != nil {
		d.fail(peer)
		return
	}
	d.mesh.AddDialedLink(peer, conn)

	// AddDialedLink does not report readiness. Poll the handler's view until
	// the first inbound frame proves the stream, then clear the failure
	// backoff; a link that never becomes ready is dropped and retried.
	timer := time.NewTimer(directReadyTimeout)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer timer.Stop()
	defer ticker.Stop()
	for {
		select {
		case <-d.ctx.Done():
			return
		case <-timer.C:
			d.mesh.DropLink(peer)
			d.fail(peer)
			return
		case <-ticker.C:
			if d.stateOf(peer) == "direct" {
				d.mu.Lock()
				delete(d.inflight, peer)
				delete(d.backoff, peer)
				delete(d.steps, peer)
				d.mu.Unlock()
				return
			}
		}
	}
}

func (d *directRuntime) stateOf(peer string) string {
	for _, s := range d.mesh.MeshStatus() {
		if s.Key == peer {
			return s.State
		}
	}
	return ""
}

func (d *directRuntime) onClosed(peer string, reason tunhandler.MeshCloseReason) {
	if peer == d.hubKey {
		if reason == tunhandler.MeshCloseShutdown {
			return
		}
		select {
		case d.hubLost <- struct{}{}:
		default:
		}
		return
	}

	d.mu.Lock()
	delete(d.inflight, peer)
	d.mu.Unlock()

	switch reason {
	case tunhandler.MeshCloseRemote, tunhandler.MeshCloseUnhealthy,
		tunhandler.MeshCloseWrite, tunhandler.MeshCloseDial:
		d.fail(peer)
	case tunhandler.MeshCloseIdle, tunhandler.MeshCloseDedup,
		tunhandler.MeshCloseMembership, tunhandler.MeshCloseBlocked,
		tunhandler.MeshCloseShutdown:
		// No redial: the next packet triggers onNeeded, or the member is no
		// longer eligible at all.
	}
}

func (d *directRuntime) fail(peer string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.inflight, peer)
	step := d.steps[peer]
	if step >= len(d.backoffSteps) {
		step = len(d.backoffSteps) - 1
	}
	if step < 0 {
		step = 0
	}
	d.steps[peer] = step + 1
	d.backoff[peer] = time.Now().Add(d.backoffSteps[step])
}

func (d *directRuntime) hubLoop() {
	defer d.wg.Done()
	for {
		select {
		case <-d.ctx.Done():
			return
		default:
		}

		conn, err := d.dialHub(d.ctx)
		if err != nil {
			if d.ctx.Err() != nil {
				return
			}
			if d.log != nil {
				d.log.Warnf("tun direct: dial hub: %v", err)
			}
			if !d.wait(time.Second) {
				return
			}
			continue
		}
		d.mesh.SetHubLink(conn)

		select {
		case <-d.ctx.Done():
			return
		case <-d.hubLost:
			// The mesh handler retired the link; wait a beat so a relay
			// rebuild does not become a tight redial loop.
			if !d.wait(time.Second) {
				return
			}
		}
	}
}

func (d *directRuntime) wait(dur time.Duration) bool {
	t := time.NewTimer(dur)
	defer t.Stop()
	select {
	case <-d.ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// Close tears the runtime down exactly once. The mesh handler closes its links
// and device; the route is removed from the shared host; the hub loop is
// already cancelled.
func (d *directRuntime) Close() error {
	if d == nil {
		return nil
	}
	d.once.Do(func() {
		if d.cancel != nil {
			d.cancel()
		}
		d.wg.Wait()
		d.refreshMu.Lock()
		_ = d.mesh.Close()
		_ = d.route.Close()
		d.refreshMu.Unlock()
	})
	return nil
}

// superviseDevice is the direct path's replacement for the tun service's
// device loop. RunDevice owns one device and returns when it closes; a new
// device is simply the next Accept. Links survive because the mesh handler is
// the same instance.
func (s *tunEntryPoint) superviseDevice(ctx context.Context, ln listener.Listener, mesh tunhandler.MeshHandler, log logger.Logger) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		if err := mesh.RunDevice(s.filter.Wrap(conn)); err != nil && ctx.Err() == nil {
			if !errors.Is(err, tunhandler.ErrTun) && log != nil {
				log.Errorf("tun direct: device: %v", err)
			}
		}
	}
}

// startDirectRuntime builds the mesh handler and service over the listener the
// entrypoint already initialized, dials the hub through the existing chain,
// and starts the device supervisor. It returns the service Run publishes and
// the runtime Close owns.
func (s *tunEntryPoint) startDirectRuntime(
	host *endpoint.Endpoint,
	ch chain.Chainer,
	pStats stats.Stats,
	ln listener.Listener,
	log logger.Logger,
) (service.Service, *directRuntime, error) {
	localIPs, err := deviceIPs(s.opts.Net)
	if err != nil {
		return nil, nil, err
	}
	if len(localIPs) == 0 {
		return nil, nil, fmt.Errorf("tun direct: %s has no device address", s.opts.Net)
	}

	handlerLogger := log.WithFields(map[string]any{"kind": "handler", "handler": "tun-mesh"})
	mesh := tunhandler.NewMeshHandler(
		tunhandler.MeshConfig{
			LocalKey: host.PublicKey(),
			HubKey:   s.peer,
			LocalIPs: localIPs,
		},
		handler.LoggerOption(handlerLogger),
	)
	route, err := tunnel.RegisterMeshRoute(nil)
	if err != nil {
		_ = mesh.Close()
		return nil, nil, err
	}

	dialHub := func(ctx context.Context) (net.Conn, error) {
		if ch == nil {
			return nil, errors.New("tun direct: no hub chain")
		}
		rt := ch.Route(ctx, "ip", s.peer)
		if rt == nil {
			return nil, fmt.Errorf("tun direct: no route to hub %s", s.peer)
		}
		return rt.Dial(ctx, "ip", s.peer)
	}
	runtime := newDirectRuntime(host, mesh, route, host.PublicKey(), s.peer, dialHub, log)

	svc := xservice.NewService(s.opts.Name, route, mesh,
		xservice.LoggerOption(log),
		xservice.StatsOption(pStats),
	)

	runtime.start()
	go s.superviseDevice(runtime.ctx, ln, mesh, log)
	return svc, runtime, nil
}

// deviceIPs turns the comma-separated "net" setting into the device's own
// addresses (not the masked networks). The mesh handler registers these with
// each peer and accepts only packets addressed to one of them.
func deviceIPs(spec string) ([]net.IP, error) {
	var out []net.IP
	for _, raw := range strings.Split(spec, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		ip, _, err := net.ParseCIDR(raw)
		if err != nil {
			if ip = net.ParseIP(raw); ip == nil {
				return nil, fmt.Errorf("tun direct: invalid device address %q", raw)
			}
		}
		out = append(out, ip)
	}
	return out, nil
}
