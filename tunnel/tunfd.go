package tunnel

import (
	"log/slog"
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
	// flapPending remembers a release observed while the device was claimed.
	// The next establish then restarts the still-claimed holder, whose dup'd
	// copy points at the destroyed interface. Guarded by tunFDMu. It is only
	// ever touched while holding tunFDMu, and the holder check nests
	// tunDeviceMu inside tunFDMu — the only place that order occurs.
	flapPending bool
)

// holderExistsLocked reports whether the device is currently claimed. The
// caller must hold tunFDMu.
func holderExistsLocked() bool {
	tunDeviceMu.Lock()
	defer tunDeviceMu.Unlock()
	return tunDeviceID != ""
}

// SetTunFD records the fd of a tun device created outside this process (the
// Android VpnService) and wakes anything waiting for one. The fd becomes ours:
// it is closed when it is replaced or cleared, so the caller must have given up
// its own copy. Pass a negative fd to release the device.
//
// It reports whether the hand-off left a running tun entrypoint holding a dead
// fd, in which case the caller must restart the holder rather than let it read
// a closed descriptor. That is a direct replace (live fd swapped for a
// different live one) and a flap (a release observed while the device was
// claimed, followed by a fresh establish): the poller can release and
// re-establish the VPN around a running entrypoint, and the entrypoint keeps
// the copy it dup'd at start — which points at the destroyed interface — while
// the system routes new packets to the rebuilt one. A first set, a re-set of
// the same fd, and a release all report false, as does a set after a release
// nobody held (a fresh device rather than a stale holder).
//
// reason names the call site that handed the fd over (an Android service
// method — "onRevoke", "TunVpnService.release", …). It is carried through the
// JNI so the Go line reads beside logcat's wisper-tunfd lines and "who released
// the device" has an answer on both sides; the logcat record proved unreliable
// on the device, this one did not. Empty when the caller has no name to give.
func SetTunFD(fd int, reason string) (swapped bool) {
	tunFDMu.Lock()
	prev := tunFD
	tunFD = fd
	close(tunFDSet)
	tunFDSet = make(chan struct{})

	if fd < 0 {
		// A release only matters when somebody holds the device: a running
		// entrypoint keeps its dup'd copy while the VPN goes away, so the
		// next establish must restart it. A release nobody held clears any
		// earlier flap instead of restarting a future holder.
		flapPending = holderExistsLocked()
	} else if fd > 0 {
		swapped = prev > 0 && prev != fd
		if !swapped && flapPending && holderExistsLocked() {
			// Flap: release-then-establish around a live holder. The holder
			// never saw a direct replace (prev == -1 here), but its fd is
			// just as dead.
			swapped = true
		}
		// A set consumes the flap either way: a later starter is fresh and
		// picks the current fd up via WaitTunFD.
		flapPending = false
	}
	tunFDMu.Unlock()

	// One line per hand-off, so the Go timeline reads beside logcat's
	// wisper-tunfd lines and "who has the device" has an answer on both sides:
	// the Android side says which site gave it up, this says what arrived here
	// (and which earlier copy it replaced). Released as well as set, because a
	// release is what stops the Go reader. The reason is appended only when
	// there is one, so a caller that names nothing reads exactly as before.
	op := "release"
	if fd > 0 {
		op = "set"
	}
	attrs := []any{"op", op, "fd", fd, "prev", prev}
	if reason != "" {
		attrs = append(attrs, "reason", reason)
	}
	slog.Info("tunfd", attrs...)

	// Closed through os, not syscall.Close: that one takes a Windows Handle on
	// a Windows build, and this descriptor is only ever an Android one.
	if prev > 0 && prev != fd {
		if f := os.NewFile(uintptr(prev), "tun"); f != nil {
			_ = f.Close()
		}
	}

	return
}

// The device above is one device for the whole app, and every tun entrypoint
// built from its fd reads the same packet stream: two of them would take each
// other's packets instead of getting a link each. So the device is held by one
// entrypoint at a time, claimed for as long as that entrypoint runs.
var (
	tunDeviceMu   sync.Mutex
	tunDeviceID   string
	tunDeviceName string
)

// ClaimTunDevice gives id — named name — the right to use the device, unless
// another entrypoint already holds it. It returns the holder's name when the
// claim fails, so the caller can say who to stop.
func ClaimTunDevice(id, name string) (owner string, ok bool) {
	tunDeviceMu.Lock()
	defer tunDeviceMu.Unlock()

	if tunDeviceID != "" && tunDeviceID != id {
		return tunDeviceName, false
	}
	tunDeviceID, tunDeviceName = id, name
	return "", true
}

// ReleaseTunDevice gives the device back if id holds it. A holder that has
// already lost it — a replacement reusing the ID claimed it first — keeps
// nothing.
func ReleaseTunDevice(id string) {
	tunDeviceMu.Lock()
	defer tunDeviceMu.Unlock()

	if tunDeviceID == id {
		tunDeviceID, tunDeviceName = "", ""
	}
}

// TunDeviceOwner names the entrypoint holding the device, both empty when
// nobody does. Callers that can answer a request with an error use it to refuse
// a second tun entrypoint up front instead of starting one that cannot work.
func TunDeviceOwner() (id, name string) {
	tunDeviceMu.Lock()
	defer tunDeviceMu.Unlock()
	return tunDeviceID, tunDeviceName
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
