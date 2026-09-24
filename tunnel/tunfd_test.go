//go:build unix

package tunnel

import (
	"os"
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
	defer SetTunFD(-1)

	first := openTestFD(t)
	SetTunFD(first)
	if got := WaitTunFD(time.Second); got != first {
		t.Fatalf("WaitTunFD = %d, want %d", got, first)
	}

	// A replaced fd is the platform's to hand back: the old one is dead, so a
	// running device cannot be fooled into reading it.
	second := openTestFD(t)
	SetTunFD(second)
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

func TestWaitTunFDWakesOnSet(t *testing.T) {
	defer SetTunFD(-1)

	SetTunFD(-1)

	got := make(chan int, 1)
	go func() { got <- WaitTunFD(5 * time.Second) }()

	time.Sleep(50 * time.Millisecond)
	fd := openTestFD(t)
	SetTunFD(fd)

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
	defer SetTunFD(-1)

	SetTunFD(-1)
	start := time.Now()
	if got := WaitTunFD(50 * time.Millisecond); got != -1 {
		t.Fatalf("WaitTunFD = %d, want -1", got)
	}
	if elapsed := time.Since(start); elapsed < 40*time.Millisecond {
		t.Fatalf("returned after %v, before the timeout", elapsed)
	}
}
