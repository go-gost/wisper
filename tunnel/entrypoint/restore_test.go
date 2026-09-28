package entrypoint

import (
	"testing"
	"time"

	"github.com/go-gost/wisper/tunnel"
)

// fakeRestoreEP is a restored entrypoint whose Run blocks until it is released,
// so a test can tell an inline restore from a background one.
type fakeRestoreEP struct {
	tunnel.Tunnel // the rest of the interface is not exercised here
	typeName      string
	started       chan struct{}
	release       chan struct{}
}

func newFakeRestoreEP(typeName string) *fakeRestoreEP {
	return &fakeRestoreEP{
		typeName: typeName,
		started:  make(chan struct{}),
		release:  make(chan struct{}),
	}
}

func (f *fakeRestoreEP) Type() string { return f.typeName }
func (f *fakeRestoreEP) Name() string { return "fake" }
func (f *fakeRestoreEP) Close() error { return nil }

func (f *fakeRestoreEP) Run() error {
	close(f.started)
	<-f.release
	return nil
}

// TestRestoreAsyncOnAndroidTun: an Android tun entrypoint is the one restore
// that must not wait. Its device belongs to the app's VpnService, which learns
// what device to build from this very backend's API — and this backend only
// starts listening once every restored entrypoint has been started. Waiting
// inline therefore starves the wait for the device, and every cold start marks
// the entrypoint failed.
func TestRestoreAsyncOnAndroidTun(t *testing.T) {
	ep := newFakeRestoreEP(TunEntryPoint)

	// The assertion is the call returning at all: Run is still blocked.
	restore("android", ep)

	select {
	case <-ep.started:
	case <-time.After(2 * time.Second):
		t.Fatal("Run was never started")
	}
	close(ep.release)
}

// TestRestoreWaitsEverywhereElse: a tun device elsewhere is local, so the wait
// belongs on the startup path — a device that cannot be created is then the
// answer at boot, not a surprise a second later. A p2p entrypoint binds a
// socket and has no device to wait for.
func TestRestoreWaitsEverywhereElse(t *testing.T) {
	for _, tc := range []struct{ goos, typeName string }{
		{"linux", TunEntryPoint},
		{"windows", TunEntryPoint},
		{"darwin", TunEntryPoint},
		{"android", P2PEntryPoint},
		{"android", TCPEntryPoint},
	} {
		ep := newFakeRestoreEP(tc.typeName)
		done := make(chan struct{})
		go func() {
			restore(tc.goos, ep)
			close(done)
		}()

		<-ep.started
		// Run is executing and unreleased, so an inline restore cannot have
		// returned: only a background one could have.
		select {
		case <-done:
			t.Fatalf("restore(%s, %s) returned before Run finished", tc.goos, tc.typeName)
		default:
		}

		close(ep.release)
		<-done
	}
}
