package entrypoint

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"

	"github.com/go-gost/core/logger"
	"github.com/go-gost/p2p/endpoint"
	"github.com/go-gost/wisper/tunnel"
	"github.com/go-gost/x/registry"
)

// tunRouterName is the name x's tun listener resolves for its per-packet
// router (x/listener/tun/metadata.go:37).
const tunRouterName = "tun.router"

var (
	netviewOnce sync.Once
	netviewRtr  *tunnel.NetviewRouter
)

// netviewRouter is the process-wide spoke router: the listener references it
// by name rather than holding routes baked at init, so the netview can change
// under a running listener. One instance, registered once — the registry's
// Get returns a lazy wrapper, so the name may be resolved before the first
// netview arrives, and an empty router answers "no route", which is exactly
// the spoke whose control channel has not opened.
func netviewRouter() *tunnel.NetviewRouter {
	netviewOnce.Do(func() {
		netviewRtr = tunnel.NewNetviewRouter()
		// ErrDup means an operator's config router already holds the name;
		// the explicit config wins and the netviews simply have nowhere to
		// install. Not fatal, but it means this spoke routes no LAN at all, so
		// it is a warn and not a debug line.
		if err := registry.RouterRegistry().Register(tunRouterName, netviewRtr); err != nil && !errors.Is(err, registry.ErrDup) {
			if log := logger.Default(); log != nil {
				// Warn: the netviews then have nowhere to install, so this
				// spoke routes no LAN at all and the operator's own router is
				// the reason. Visible at the default level for that reason.
				log.Warnf("netview: register %s: %v", tunRouterName, err)
			}
		}
	})
	return netviewRtr
}

// startNetview is StartNetview behind a package variable so a test can watch
// the lifetime the entrypoint gives the control channel without a hub.
var startNetview = StartNetview

// StartNetview starts the spoke side of the LAN-routing control channel for
// one tun entrypoint: it claims this spoke's share_lan at the hub and hands
// every netview the hub pushes back to the router the tun listener resolves
// by name. It returns immediately; the channel runs until ctx is done,
// reconnecting every second.
//
// deviceNet is this device's own address (the entrypoint's net), the handle
// by which the kernel-route sync finds the link the routes belong on. Empty
// is fine: the sync then installs nothing and logs why.
//
// Never fatal, by construction: a channel that cannot open (or a share_lan
// that does not parse, which claims nothing) is a spoke that behaves exactly
// as it does today — it reaches every member and has no LAN routing.
func StartNetview(ctx context.Context, host *endpoint.Endpoint, hubPeer, shareLAN, deviceNet string, provider any, log logger.Logger) {
	// Registered before the channel runs, but the listener's lookup is by
	// name at query time, so there is no ordering constraint against the
	// listener's Init.
	router := netviewRouter()

	var claims []string
	if lans, err := tunnel.ParseShareLANNets(shareLAN); err != nil {
		if log != nil {
			// Warn: the spoke will run and route no LAN, and this line is the
			// only place the typo in share_lan is named.
			log.Warnf("netview: share_lan %q claims nothing: %v", shareLAN, err)
		}
	} else {
		for _, lan := range lans {
			claims = append(claims, lan.String())
		}
	}

	// The kernel, told what the hub approved. The router is a lookup table;
	// only a route makes this device's kernel hand the packet over in the
	// first place. Best-effort by construction — a sync that cannot install
	// logs its own failure and the spoke tunnels on.
	sync := newNetviewSync(parseDeviceNets(deviceNet), nil, log)

	go tunnel.RunControlChannel(ctx, tunnel.ControlChannelConfig{
		Host:      host,
		HubPeer:   hubPeer,
		ShareLAN:  claims,
		Provider:  provider,
		Router:    router,
		RouteSync: sync.Reflect,
		Log:       log,
	})
}

// parseDeviceNets turns the entrypoint's net setting into the addresses the
// sync matches a link on. The setting is a comma-separated list of CIDRs (or
// bare addresses); a value that parses to no address at all yields an empty
// list, which the sync reports honestly rather than guessing a link.
//
// The address, not the network: ParseCIDR's second return is the masked
// network (10.20.0.2/24 gives the 10.20.0.0/24 network), and a link holds the
// address it was configured with, so matching on the network would look for a
// link that has 10.20.0.0 and never find the one that has 10.20.0.2.
func parseDeviceNets(spec string) []net.IPNet {
	var out []net.IPNet
	for _, v := range strings.Split(spec, ",") {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		ip := net.ParseIP(v)
		if ip == nil {
			if parsed, _, err := net.ParseCIDR(v); err == nil {
				ip = parsed
			}
		}
		if ip == nil {
			continue
		}
		bits := 32
		if ip.To4() == nil {
			bits = 128
		}
		out = append(out, net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
	}
	return out
}

// InstalledLANRoutes lists the CIDRs the hub has approved for this spoke, exactly
// as the router the tun listener resolves by name holds them — the spoke's exit
// for the LANs it shares, and what the entrypoints page shows next to the
// share_lan it was configured with.
//
// It is a process-wide read rather than a per-entrypoint one, because the router
// is: one spoke process installs one netview, whichever entrypoint's control
// channel received it. A read in a process where no channel has ever opened
// materializes the same empty router, so the answer is an empty list rather than
// an error — a spoke whose hub approved nothing and a spoke that never asked are
// both "no routes", and asking starts nothing.
//
// Sorted, because the router sorts: the list is read by a human and by a diff.
func InstalledLANRoutes() []string {
	return netviewRouter().Prefixes()
}
