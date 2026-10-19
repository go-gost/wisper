package entrypoint

import (
	"context"
	"testing"
	"time"

	"github.com/go-gost/core/logger"
	"github.com/go-gost/p2p/endpoint"
	tp "github.com/go-gost/wisper/tunnel"
)

// TestCloseStopsTheControlChannel: the LAN-routing control channel is a
// goroutine that outlives the API request which started the entrypoint, and
// Close is the only thing that ends it. It has to be, because the two ways it
// can get this wrong are both the reported bug: bound to the request context it
// would stop the moment the click returned, and bound to nothing it would keep
// running after Close — re-asserting the share_lan a replacement had revoked,
// on a stream the hub was still reading, so the hub never withdrew the route.
//
// The channel dials a hub and a test wants none, so StartNetview is behind a
// seam; the stand-in records the context it was handed and the test watches
// that context, which is the whole subject.
func TestCloseStopsTheControlChannel(t *testing.T) {
	ep := NewTunEntryPoint(
		tp.IDOption("ep-tun-control"),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.0.2/24"),
		tp.ShareLANOption("192.168.50.0/24"),
	)
	s, ok := ep.(*tunEntryPoint)
	if !ok {
		t.Fatalf("NewTunEntryPoint returned %T, want *tunEntryPoint", ep)
	}

	orig := startNetview
	defer func() { startNetview = orig }()
	var gotCtx context.Context
	startNetview = func(ctx context.Context, _ *endpoint.Endpoint, _, _, _ string, _ any, _ logger.Logger) {
		gotCtx = ctx
	}

	s.startControlChannel(context.Background(), nil, nil)
	if gotCtx == nil {
		t.Fatal("startControlChannel started no control channel")
	}
	select {
	case <-gotCtx.Done():
		t.Fatal("the control channel was cancelled before the entrypoint was closed")
	default:
	}

	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	select {
	case <-gotCtx.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("Close left the control channel running: a replaced entrypoint would keep claiming the LAN it revoked")
	}

	// And a Close is not a stop the next run inherits: the field it cancels is
	// cleared, so the successor's own channel is not cancelled by this one.
	if s.cancelControl != nil {
		t.Fatal("Close left its cancel in place for a successor to fire")
	}
}
