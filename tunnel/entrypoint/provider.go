package entrypoint

import "github.com/go-gost/p2p/endpoint"

// p2pProvider is the registry value for the process-wide p2p host. The host's
// lifetime belongs to tunnel.AcquireP2PHost/ReleaseP2PHost, not to the
// registry: x's Unregister closes any io.Closer it finds, and closing the
// shared host from an entrypoint that is being replaced would leave the
// replacement holding a dead endpoint. Close is therefore a no-op; the host's
// own release path decides when to stop it.
type p2pProvider struct {
	*endpoint.Endpoint
}

func (p2pProvider) Close() error { return nil }
