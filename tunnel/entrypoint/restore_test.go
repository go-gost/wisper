package entrypoint

import (
	"context"
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

// TestRestoreAsyncOnAndroidDevice: an Android device entrypoint is the one
// restore that must not wait. Its device belongs to the app's VpnService, which
// learns what device to build from this very backend's API — and this backend
// only starts listening once every restored entrypoint has been started. Waiting
// inline therefore starves the wait for the device, and every cold start marks
// the entrypoint failed. Both device types own that device, so both start in the
// background.
func TestRestoreAsyncOnAndroidDevice(t *testing.T) {
	for _, typeName := range []string{TunEntryPoint, TungoEntryPoint} {
		ep := newFakeRestoreEP(typeName)

		// The assertion is the call returning at all: Run is still blocked.
		restore(context.Background(), "android", ep)

		select {
		case <-ep.started:
		case <-time.After(2 * time.Second):
			t.Fatalf("%s: Run was never started", typeName)
		}
		close(ep.release)
	}
}

// TestRestoreAsyncPredicate: which entrypoints start off the startup path, and
// why. Only the app's device forces it, and only on Android: a device elsewhere
// is local, so a device that cannot be created is the answer at boot.
func TestRestoreAsyncPredicate(t *testing.T) {
	for _, tc := range []struct {
		goos, typeName string
		want           bool
	}{
		{"android", TunEntryPoint, true},
		{"android", TungoEntryPoint, true},
		{"linux", TunEntryPoint, false},
		{"linux", TungoEntryPoint, false},
		{"windows", TungoEntryPoint, false},
		{"darwin", TungoEntryPoint, false},
		{"android", P2PEntryPoint, false},
		{"android", TCPEntryPoint, false},
		{"android", UDPEntryPoint, false},
	} {
		if got := restoreAsync(tc.goos, newFakeRestoreEP(tc.typeName)); got != tc.want {
			t.Errorf("restoreAsync(%s, %s) = %v, want %v", tc.goos, tc.typeName, got, tc.want)
		}
	}
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
		{"linux", TungoEntryPoint},
		{"darwin", TungoEntryPoint},
		{"android", P2PEntryPoint},
		{"android", TCPEntryPoint},
	} {
		ep := newFakeRestoreEP(tc.typeName)
		done := make(chan struct{})
		go func() {
			restore(context.Background(), tc.goos, ep)
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
