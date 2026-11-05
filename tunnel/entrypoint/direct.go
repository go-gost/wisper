package entrypoint

import (
	"context"
	"errors"
	"fmt"
	"net"
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
type directRuntime struct {
	host    *endpoint.Endpoint
	mesh    tunhandler.MeshHandler
	route   *tunnel.MeshRoute
	hubKey  string
	dialHub func(context.Context) (net.Conn, error)
	log     logger.Logger

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	hubLost chan struct{}
	once    sync.Once
}

func newDirectRuntime(
	host *endpoint.Endpoint,
	mesh tunhandler.MeshHandler,
	route *tunnel.MeshRoute,
	hubKey string,
	dialHub func(context.Context) (net.Conn, error),
	log logger.Logger,
) *directRuntime {
	return &directRuntime{
		host:    host,
		mesh:    mesh,
		route:   route,
		hubKey:  hubKey,
		dialHub: dialHub,
		log:     log,
		hubLost: make(chan struct{}, 1),
	}
}

func (d *directRuntime) start() {
	d.ctx, d.cancel = context.WithCancel(context.Background())
	d.mesh.SetLinkClosed(func(peer string, reason tunhandler.MeshCloseReason) {
		if peer != d.hubKey || reason == tunhandler.MeshCloseShutdown {
			return
		}
		select {
		case d.hubLost <- struct{}{}:
		default:
		}
	})
	d.wg.Add(1)
	go d.hubLoop()
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
		_ = d.mesh.Close()
		_ = d.route.Close()
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
	runtime := newDirectRuntime(host, mesh, route, s.peer, dialHub, log)

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
