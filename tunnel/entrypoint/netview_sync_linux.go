//go:build linux

package entrypoint

import (
	"errors"
	"net"
	"syscall"

	"github.com/vishvananda/netlink"
)

func init() {
	newKernelRoutes = func() kernelRoutes { return netlinkRoutes{} }
}

// errRouteGone is the kernel's answer to removing a route it does not hold.
// errors.Is, because netlink hands back the syscall errno wrapped in a
// *netlink.NetlinkError, and "the route is already gone" is the outcome the
// removal wanted regardless of how it is spelled.
var errRouteGone = errors.New("route gone")

// netlinkRoutes is the production kernelRoutes: the routes live in the
// kernel's table, so the kernel's own API is the only honest implementation.
//
// Scope link, no gateway: the tun device is directly attached to every
// prefix it carries — the hub is reachable through the device itself, and a
// gateway would send the packet somewhere else entirely.
type netlinkRoutes struct{}

func (netlinkRoutes) LinkIndexFor(addrs []net.IPNet) (int, error) {
	links, err := netlink.LinkList()
	if err != nil {
		return 0, err
	}
	for _, link := range links {
		linkAddrs, err := netlink.AddrList(link, netlink.FAMILY_ALL)
		if err != nil {
			continue
		}
		for _, linkAddr := range linkAddrs {
			if linkAddr.IP == nil {
				continue
			}
			for _, want := range addrs {
				if want.IP != nil && want.IP.Equal(linkAddr.IP) {
					return link.Attrs().Index, nil
				}
			}
		}
	}
	return 0, errors.New("no link holds the device addresses")
}

func (netlinkRoutes) AddRoute(linkIndex int, dst *net.IPNet) error {
	return netlink.RouteAdd(&netlink.Route{
		LinkIndex: linkIndex,
		Dst:       dst,
		Scope:     netlink.SCOPE_LINK,
	})
}

func (netlinkRoutes) RemoveRoute(linkIndex int, dst *net.IPNet) error {
	err := netlink.RouteDel(&netlink.Route{
		LinkIndex: linkIndex,
		Dst:       dst,
		Scope:     netlink.SCOPE_LINK,
	})
	// ESRCH: no such route. Already-gone is success for a removal, and the
	// device ends up where the hub's approval says either way. Matched by
	// errno rather than a netlink error type, because that is what this
	// version hands back.
	if errors.Is(err, syscall.ESRCH) {
		return errRouteGone
	}
	return err
}
