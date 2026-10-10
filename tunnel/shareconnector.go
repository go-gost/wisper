package tunnel

import (
	"context"
	"fmt"
	"net"

	"github.com/go-gost/core/connector"
	md "github.com/go-gost/core/metadata"
	"github.com/go-gost/x/registry"
)

// The last node of a userspace spoke's chain carries this connector: it is
// what makes the Lan's packets leave the chain and enter a userspace stack.
// The hub decides the same thing with shareDevice, wrapped around the device
// it reads; a spoke has no device of its own to wrap, so the wrap belongs to
// the chain — and the chain is the engine's, which is why it is an x
// connector, resolved by name from the parsed config.
func init() {
	registry.ConnectorRegistry().Register("tun-share", NewShareConnector)
}

// NewShareConnector creates the spoke's userspace share connector.
func NewShareConnector(opts ...connector.Option) connector.Connector {
	var options connector.Options
	for _, opt := range opts {
		opt(&options)
	}

	return &shareConnector{
		options:  options,
		newStack: func(mtu int) ShareStackBackend { return newShareStack(mtu) },
	}
}

type shareConnector struct {
	options connector.Options
	lans    []*net.IPNet
	mtu     int
	// newStack builds the stack a connection's shim routes into. It is a
	// seam only for tests: production always builds a gvisor stack, one per
	// connection.
	newStack func(mtu int) ShareStackBackend
}

func (c *shareConnector) Init(md md.Metadata) error {
	spec := ""
	if v, ok := md.Get("lans").(string); ok {
		spec = v
	}
	lans, err := ParseShareLANNets(spec)
	if err != nil {
		return fmt.Errorf("tun-share: lans: %w", err)
	}
	if len(lans) == 0 {
		// An empty list is a config that shares nothing: every packet would
		// pass through untouched, which is exactly what the plain "forward"
		// connector already does — so this is a mistake, not a mode.
		return fmt.Errorf("tun-share: metadata carries no lans: the shared LANs are what this connector routes")
	}
	c.lans = lans

	if v, ok := md.Get("mtu").(int); ok {
		c.mtu = v
	}
	return nil
}

// Connect wraps the chain conn the engine just established to the hub. Every
// call builds its own shim and its own stack: the engine re-dials a chain
// that died, and the shim that dies with the old chain must not be the one
// the new conn is handed — Wrap is guarded, so a reused shim would return the
// first chain's conn and blackhole every packet of the second.
//
// The stack's lifetime is the shim's, which is the conn's: closing the conn
// (the engine dropping the chain) closes the stack exactly once, and nothing
// else ever closes it.
func (c *shareConnector) Connect(ctx context.Context, conn net.Conn, network, address string, opts ...connector.ConnectOption) (net.Conn, error) {
	if conn == nil {
		return nil, fmt.Errorf("tun-share: connect %s/%s: no chain conn to wrap", network, address)
	}
	shim := NewChainShareShim(c.lans, c.newStack(c.mtu))
	return shim.Wrap(conn), nil
}
