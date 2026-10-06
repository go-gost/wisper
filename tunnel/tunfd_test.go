//go:build unix

package tunnel

import (
	"bytes"
	"log/slog"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"
)

// openTestFD opens a real fd to hand over: the holder closes what it replaces,
// so a made-up number would close an unrelated descriptor.
func openTestFD(t *testing.T) int {
	t.Helper()
	fd, err := syscall.Open(os.DevNull, syscall.O_RDONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	return fd
}

func isOpen(fd int) bool {
	dup, err := syscall.Dup(fd)
	if err == nil {
		syscall.Close(dup)
	}
	return err == nil
}

func TestTunFDPresentAndReplaced(t *testing.T) {
	defer SetTunFD(-1, "")

	first := openTestFD(t)
	SetTunFD(first, "test.establish")
	if got := WaitTunFD(time.Second); got != first {
		t.Fatalf("WaitTunFD = %d, want %d", got, first)
	}

	// A replaced fd is the platform's to hand back: the old one is dead, so a
	// running device cannot be fooled into reading it.
	second := openTestFD(t)
	SetTunFD(second, "test.establish")
	if got := WaitTunFD(time.Second); got != second {
		t.Fatalf("WaitTunFD after replace = %d, want %d", got, second)
	}
	if isOpen(first) {
		t.Error("the replaced fd should have been closed")
	}
	if !isOpen(second) {
		t.Error("the current fd should stay open")
	}
}

// TestSetTunFDReportsSwap: a hand-off that replaces a live device is the one
// case where a running tun entrypoint is left holding a dead fd — the VpnService
// rebuilt the device under it — so the caller must be told to restart it. A
// first set, a re-set of the same fd, and a release are not swaps, and a set
// after a release is a fresh device rather than a swap either.
func TestSetTunFDReportsSwap(t *testing.T) {
	defer SetTunFD(-1, "")

	SetTunFD(-1, "")

	first := openTestFD(t)
	if swapped := SetTunFD(first, "test.establish"); swapped {
		t.Error("the first device is not a swap")
	}
	if swapped := SetTunFD(first, "test.establish"); swapped {
		t.Error("re-setting the same fd is not a swap")
	}
	second := openTestFD(t)
	if swapped := SetTunFD(second, "test.establish"); !swapped {
		t.Error("replacing a live fd with a different one is a swap")
	}
	if swapped := SetTunFD(-1, "TunVpnService.release"); swapped {
		t.Error("a release is not a swap")
	}
	third := openTestFD(t)
	if swapped := SetTunFD(third, "test.establish"); swapped {
		t.Error("setting after a release is not a swap")
	}
}

// TestSetTunFDLogsReason: the hand-off line names the call site that caused it,
// so a release can be attributed from the Go log alone — and a caller with no
// name to give reads exactly as before (no reason field).
func TestSetTunFDLogsReason(t *testing.T) {
	defer SetTunFD(-1, "")

	var buf bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })

	buf.Reset()
	SetTunFD(-1, "onRevoke")
	if got := buf.String(); !strings.Contains(got, "op=release") || !strings.Contains(got, "reason=onRevoke") {
		t.Fatalf("log = %q, want a release naming onRevoke", got)
	}

	buf.Reset()
	SetTunFD(-1, "")
	if got := buf.String(); strings.Contains(got, "reason=") {
		t.Fatalf("log = %q, want no reason field when none was given", got)
	}
}

func TestWaitTunFDWakesOnSet(t *testing.T) {
	defer SetTunFD(-1, "")

	SetTunFD(-1, "")

	got := make(chan int, 1)
	go func() { got <- WaitTunFD(5 * time.Second) }()

	time.Sleep(50 * time.Millisecond)
	fd := openTestFD(t)
	SetTunFD(fd, "test.establish")

	select {
	case n := <-got:
		if n != fd {
			t.Fatalf("waiter got %d, want %d", n, fd)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("waiter was not woken by SetTunFD")
	}
}

func TestWaitTunFDTimeout(t *testing.T) {
	defer SetTunFD(-1, "")

	SetTunFD(-1, "")
	start := time.Now()
	if got := WaitTunFD(50 * time.Millisecond); got != -1 {
		t.Fatalf("WaitTunFD = %d, want -1", got)
	}
	if elapsed := time.Since(start); elapsed < 40*time.Millisecond {
		t.Fatalf("returned after %v, before the timeout", elapsed)
	}
}

func TestClaimTunDeviceIsExclusive(t *testing.T) {
	defer ReleaseTunDevice("first")

	if owner, ok := ClaimTunDevice("first", "one"); !ok || owner != "" {
		t.Fatalf("first claim = (%q, %v), want (\"\", true)", owner, ok)
	}
	// The device is one device: a second entrypoint is told who holds it.
	if owner, ok := ClaimTunDevice("second", "two"); ok || owner != "one" {
		t.Fatalf("second claim = (%q, %v), want (\"one\", false)", owner, ok)
	}
	// A replacement reuses the ID, so the holder may claim its own device again.
	if _, ok := ClaimTunDevice("first", "one"); !ok {
		t.Fatal("the holder should be able to claim again")
	}
	// Only the holder's release frees it: a stranger's is a no-op.
	ReleaseTunDevice("second")
	if id, _ := TunDeviceOwner(); id != "first" {
		t.Fatalf("owner after stranger's release = %q, want \"first\"", id)
	}
	ReleaseTunDevice("first")
	if id, name := TunDeviceOwner(); id != "" || name != "" {
		t.Fatalf("owner after release = (%q, %q), want (\"\", \"\")", id, name)
	}
	if _, ok := ClaimTunDevice("second", "two"); !ok {
		t.Fatal("the released device should be claimable again")
	}
	ReleaseTunDevice("second")
}
