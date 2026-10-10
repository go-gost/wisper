package entrypoint

import (
	"testing"
)

// TestInstalledLANRoutesEmpty: a spoke that never ran its control channel — and
// an API read in a process where no spoke has run at all — has no LAN routes.
// That has to answer with an empty list rather than a nil check, a panic, or a
// router that has to be started first: the entrypoints page asks this of every
// tun entrypoint in the list, running or not, and "no routes" is the answer a
// spoke whose hub never approved anything gives.
func TestInstalledLANRoutesEmpty(t *testing.T) {
	if got := InstalledLANRoutes(); len(got) != 0 {
		t.Fatalf("InstalledLANRoutes() = %v, want no routes on a spoke with no netview", got)
	}
}
