//go:build !linux

package entrypoint

import (
	"errors"
	"net"
)

func init() {
	newKernelRoutes = func() kernelRoutes { return unsupportedRoutes{} }
}

// unsupportedRoutes is every non-Linux platform's kernelRoutes: the routes
// are not this process's to install. Android's device is the VpnService's,
// and a desktop that is not Linux is not where this spoke runs today.
//
// The failure is the honest answer — the sync logs its warning and the spoke
// tunnels, exactly as it did before the hub approved anything, which is the
// contract best-effort buys.
type unsupportedRoutes struct{}

func (unsupportedRoutes) LinkIndexFor(addrs []net.IPNet) (int, error) {
	return 0, errors.New("kernel routes are not installed on this platform")
}

func (unsupportedRoutes) AddRoute(linkIndex int, dst *net.IPNet) error {
	return errors.New("kernel routes are not installed on this platform")
}

func (unsupportedRoutes) RemoveRoute(linkIndex int, dst *net.IPNet) error {
	return errors.New("kernel routes are not installed on this platform")
}
