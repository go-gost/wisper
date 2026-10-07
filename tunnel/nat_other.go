//go:build !linux

package tunnel

// Non-Linux hosts have no kernel NAT path: sharing always resolves to the
// userspace fallback (or stays disabled). The decision logic in natlan.go is
// unchanged — only the probe answers no.
func probeShareKernel() bool {
	return false
}

// shareExec is unreachable without a kernel path, but setupShareLAN takes a
// runner unconditionally, so the symbol exists on every platform.
func shareExec(name string, args ...string) error {
	return nil
}
