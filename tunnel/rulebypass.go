package tunnel

import (
	"context"
	"slices"
	"sync"

	"github.com/go-gost/core/bypass"
	xbypass "github.com/go-gost/x/bypass"
)

// RuleBypass is a whitelist bypass whose rule list can be replaced while the
// tunnel is running. It implements bypass.Bypass.
//
// The rules are the destinations that go through the tunnel; everything else
// bypasses it, so Contains returns true for an address that is NOT listed
// (x/bypass applies whitelist mode as a negation of the match). An empty rule
// list therefore bypasses every address: with nothing listed, all traffic is
// direct.
type RuleBypass struct {
	mu    sync.RWMutex
	inner bypass.Bypass
}

var _ bypass.Bypass = (*RuleBypass)(nil)

// NewRuleBypass returns a RuleBypass holding rules.
func NewRuleBypass(rules []string) *RuleBypass {
	b := &RuleBypass{}
	b.SetRules(rules)
	return b
}

// SetRules replaces the rule list. Traffic already flowing through the tunnel
// keeps its path: only the next Contains call sees the new rules, and no chain
// or goroutine is rebuilt. The rules are copied, so a caller that reuses or
// edits its own slice cannot change this rule set afterwards.
func (b *RuleBypass) SetRules(rules []string) {
	next := xbypass.NewBypass(
		xbypass.MatchersOption(slices.Clone(rules)),
		xbypass.WhitelistOption(true),
	)

	b.mu.Lock()
	b.inner = next
	b.mu.Unlock()
}

// Contains reports whether addr skips the tunnel. It is true for an address
// outside the rule list, and for every address when the list is empty.
func (b *RuleBypass) Contains(ctx context.Context, network, addr string, opts ...bypass.Option) bool {
	b.mu.RLock()
	inner := b.inner
	b.mu.RUnlock()

	// A zero RuleBypass has no inner rule set; it behaves like an empty list.
	if inner == nil {
		return true
	}
	return inner.Contains(ctx, network, addr, opts...)
}

// IsWhitelist reports that listed addresses are the ones using the tunnel.
func (b *RuleBypass) IsWhitelist() bool {
	return true
}
