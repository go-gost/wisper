package entrypoint

import (
	"context"
	"errors"
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
		// install. Not an error, just a debug line.
		if err := registry.RouterRegistry().Register(tunRouterName, netviewRtr); err != nil && !errors.Is(err, registry.ErrDup) {
			if log := logger.Default(); log != nil {
				log.Debugf("netview: register %s: %v", tunRouterName, err)
			}
		}
	})
	return netviewRtr
}

// StartNetview starts the spoke side of the LAN-routing control channel for
// one tun entrypoint: it claims this spoke's share_lan at the hub and hands
// every netview the hub pushes back to the router the tun listener resolves
// by name. It returns immediately; the channel runs until ctx is done,
// reconnecting every second.
//
// Never fatal, by construction: a channel that cannot open (or a share_lan
// that does not parse, which claims nothing) is a spoke that behaves exactly
// as it does today — it reaches every member and has no LAN routing.
func StartNetview(ctx context.Context, host *endpoint.Endpoint, hubPeer, shareLAN string, provider any, log logger.Logger) {
	// Registered before the channel runs, but the listener's lookup is by
	// name at query time, so there is no ordering constraint against the
	// listener's Init.
	router := netviewRouter()

	var claims []string
	if lans, err := tunnel.ParseShareLANNets(shareLAN); err != nil {
		if log != nil {
			log.Debugf("netview: share_lan %q claims nothing: %v", shareLAN, err)
		}
	} else {
		for _, lan := range lans {
			claims = append(claims, lan.String())
		}
	}

	go tunnel.RunControlChannel(ctx, tunnel.ControlChannelConfig{
		Host:     host,
		HubPeer:  hubPeer,
		ShareLAN: claims,
		Provider: provider,
		Router:   router,
		Log:      log,
	})
}
