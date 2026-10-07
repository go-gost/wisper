package tunnel

import (
	"errors"
	"net"
	"strings"
)

// Share-mode for a tun hub's LAN sharing: try the kernel first (full
// protocol incl. ICMP), fall back to a userspace TCP/UDP NAT when the
// kernel path is unavailable (no iptables/nft, no privilege).
const (
	ShareAuto      = "auto"
	ShareKernel    = "kernel"
	ShareUserspace = "userspace"
)

// NormalizeShareMode maps "" and unknown values to auto: an empty field
// means "not configured", and a typo must not silently pin a mode.
func NormalizeShareMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case ShareKernel:
		return ShareKernel
	case ShareUserspace:
		return ShareUserspace
	default:
		return ShareAuto
	}
}

// ParseShareLANNets parses a comma-separated list of CIDRs ("192.168.1.0/24").
// Empty means sharing is disabled (nil, nil). Anything unparseable fails:
// a half-understood list would NAT the wrong LAN.
func ParseShareLANNets(spec string) ([]*net.IPNet, error) {
	if strings.TrimSpace(spec) == "" {
		return nil, nil
	}
	var out []*net.IPNet
	for _, s := range strings.Split(spec, ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		_, ipNet, err := net.ParseCIDR(s)
		if err != nil {
			return nil, err
		}
		out = append(out, ipNet)
	}
	return out, nil
}

// resolveShareMode picks the effective sharing implementation. Empty means
// sharing is disabled ("", false, nil). Auto prefers the kernel and reports
// a downgrade when it is unavailable, so the UI can say why ping does not
// work. A pinned kernel that cannot run is a start failure, never a silent
// downgrade — the operator asked for it explicitly.
func resolveShareMode(configured string, kernelOK bool) (string, bool, error) {
	if strings.TrimSpace(configured) == "" {
		return "", false, nil
	}
	switch NormalizeShareMode(configured) {
	case ShareKernel:
		if !kernelOK {
			return "", false, errors.New("share mode kernel requested but the kernel path is unavailable (need ip_forward + iptables/nft)")
		}
		return ShareKernel, false, nil
	case ShareUserspace:
		return ShareUserspace, false, nil
	default: // auto: prefer the kernel, degrade visibly
		if kernelOK {
			return ShareKernel, false, nil
		}
		return ShareUserspace, true, nil
	}
}

// the virtual net hubNet. Pure strings — applying them (iptables/nft) lives
// elsewhere so this is unit-testable without privilege.
// shareRunner runs one command; setupShareLAN takes it as a parameter so
// tests inject a fake and production passes exec.
type shareRunner func(name string, args ...string) error

// setupShareLAN resolves the mode and applies the kernel NAT rules through
// run. It returns the effective mode ("kernel", "userspace", or "" when
// sharing is disabled), whether auto downgraded, and a cleanup removing
// exactly what was applied (nil when nothing was). A failed apply stops at
// the first error and removes what it already added, so a half-built rule
// set never survives a failed start.
func setupShareLAN(hubNet, lanSpec, mode string, kernelOK bool, run shareRunner) (string, bool, func(), error) {
	if strings.TrimSpace(lanSpec) == "" {
		return "", false, nil, nil
	}
	effective, downgraded, err := resolveShareMode(mode, kernelOK)
	if err != nil {
		return "", false, nil, err
	}
	if effective == ShareUserspace {
		return ShareUserspace, downgraded, nil, nil
	}
	rules, err := BuildShareNATRules(hubNet, lanSpec)
	if err != nil {
		return "", false, nil, err
	}
	var applied []string
	for _, rule := range rules {
		name, args := shareRuleArgv(rule)
		if err := run(name, args...); err != nil {
			removeShareNATRules(applied, run)
			return "", false, nil, err
		}
		applied = append(applied, rule)
	}
	return ShareKernel, downgraded, func() {
		removeShareNATRules(applied, run)
	}, nil
}

// shareRuleArgv splits a rendered rule into argv. The renderer emits no
// quoted spaces, so Fields is exact — and the round trip is pinned by test.
func shareRuleArgv(rule string) (string, []string) {
	f := strings.Fields(rule)
	return f[0], f[1:]
}

// shareDeleteRule mirrors one apply rule into its delete.
func shareDeleteRule(rule string) string {
	return strings.Replace(rule, " -A ", " -D ", 1)
}

// removeShareNATRules deletes rules newest-first; teardown errors are
// best-effort (logged by the caller), never fatal.
func removeShareNATRules(rules []string, run shareRunner) {
	for i := len(rules) - 1; i >= 0; i-- {
		name, args := shareRuleArgv(shareDeleteRule(rules[i]))
		_ = run(name, args...)
	}
}

// BuildShareNATRules renders the kernel NAT rules for sharing lanSpec with
func BuildShareNATRules(hubNet, lanSpec string) ([]string, error) {
	_, hub, err := net.ParseCIDR(strings.TrimSpace(hubNet))
	if err != nil {
		return nil, err
	}
	lans, err := ParseShareLANNets(lanSpec)
	if err != nil {
		return nil, err
	}
	var rules []string
	for _, lan := range lans {
		rules = append(rules,
			"iptables -t nat -A POSTROUTING -s "+hub.String()+" -d "+lan.String()+" -j MASQUERADE",
			"iptables -A FORWARD -s "+hub.String()+" -d "+lan.String()+" -j ACCEPT",
			"iptables -A FORWARD -s "+lan.String()+" -d "+hub.String()+" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT",
		)
	}
	return rules, nil
}
