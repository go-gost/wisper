package tunnel

import (
	"os"
	"sync"
	"time"
)

// The fd of a tun device the host platform created for us. On Android an
// unprivileged app cannot open /dev/net/tun, so the device belongs to the
// VpnService and arrives here out of band (JNI). The Go side only borrows it:
// every tun device takes a copy, so it stays valid for the life of the VPN
// instead of being used up by the first entrypoint that starts.
var (
	tunFDMu  sync.Mutex
	tunFD    = -1
	tunFDSet = make(chan struct{}) // closed and replaced on every set, to wake waiters
)

// SetTunFD records the fd of a tun device created outside this process (the
// Android VpnService) and wakes anything waiting for one. The fd becomes ours:
// it is closed when it is replaced or cleared, so the caller must have given up
// its own copy. Pass a negative fd to release the device.
func SetTunFD(fd int) {
	tunFDMu.Lock()
	prev := tunFD
	tunFD = fd
	close(tunFDSet)
	tunFDSet = make(chan struct{})
	tunFDMu.Unlock()

	// Closed through os, not syscall.Close: that one takes a Windows Handle on
	// a Windows build, and this descriptor is only ever an Android one.
	if prev > 0 && prev != fd {
		if f := os.NewFile(uintptr(prev), "tun"); f != nil {
			_ = f.Close()
		}
	}
}

// WaitTunFD returns the device fd, waiting up to d for one to be handed over,
// and -1 if none arrived. An entrypoint started by a restored config runs long
// before the app can establish the VPN, so it waits instead of failing.
func WaitTunFD(d time.Duration) int {
	deadline := time.Now().Add(d)
	for {
		tunFDMu.Lock()
		fd, ch := tunFD, tunFDSet
		tunFDMu.Unlock()

		if fd > 0 {
			return fd
		}

		remaining := time.Until(deadline)
		if remaining <= 0 {
			return -1
		}

		select {
		case <-ch:
		case <-time.After(remaining):
			return -1
		}
	}
}
