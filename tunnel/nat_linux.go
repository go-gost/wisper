//go:build linux

package tunnel

import (
	"os"
	"os/exec"
	"strings"
)

// This file is the only place that touches the host's network stack: the
// kernel NAT path for LAN sharing runs here, everything else stays pure and
// tested in natlan.go. All three entry points are best-effort probes — the
// decision logic (resolve/setup) lives above them.

// ipForwardPath is the kernel's IPv4 forwarding switch. Sharing a LAN
// routes packets between the tun device and the LAN, which is forwarding,
// so this must read 1.
const ipForwardPath = "/proc/sys/net/ipv4/ip_forward"

// parseIPForward reads the switch file's content. Only "1" enables —
// garbage never does, so a weird read fails closed toward the userspace
// fallback instead of assuming the kernel will forward.
func parseIPForward(content []byte) bool {
	return strings.TrimSpace(string(content)) == "1"
}

// haveCmd reports whether a binary is on PATH.
func haveCmd(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

// probeShareKernel reports whether the kernel NAT path can run: forwarding
// on (or turnable on — enabling it is the documented requirement of
// sharing) and iptables present to install the rules with.
func probeShareKernel() bool {
	if content, err := os.ReadFile(ipForwardPath); err != nil || !parseIPForward(content) {
		if err := os.WriteFile(ipForwardPath, []byte("1\n"), 0o644); err != nil {
			return false
		}
	}
	return haveCmd("iptables")
}

// shareExec runs one rule command against the host.
func shareExec(name string, args ...string) error {
	return exec.Command(name, args...).Run()
}
