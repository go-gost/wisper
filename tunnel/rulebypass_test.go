package tunnel

import (
	"bytes"
	"context"
	"strings"
	"sync"
	"testing"

	clogger "github.com/go-gost/core/logger"
	xlogger "github.com/go-gost/x/logger"
)

func ruleMatches(b *RuleBypass, addr string) bool {
	return b.Contains(context.Background(), "tcp", addr)
}

func TestRuleBypassWhitelistSemantics(t *testing.T) {
	b := NewRuleBypass([]string{"example.com"})

	if ruleMatches(b, "example.com:443") {
		t.Error("a listed address must not bypass: it goes through the tunnel")
	}
	if !ruleMatches(b, "other.test:443") {
		t.Error("an unlisted address must bypass the tunnel and dial directly")
	}
	if !b.IsWhitelist() {
		t.Error("the rule bypass is a whitelist")
	}
}

func TestRuleBypassCIDRMatchesHostPort(t *testing.T) {
	b := NewRuleBypass([]string{"192.168.100.0/24"})

	if ruleMatches(b, "192.168.100.100:53") {
		t.Error("an address inside a listed CIDR must not bypass, even with a port attached")
	}
	if !ruleMatches(b, "192.168.101.1:53") {
		t.Error("an address outside every listed CIDR must bypass")
	}
}

func TestRuleBypassSwapTakesEffect(t *testing.T) {
	b := NewRuleBypass([]string{"old.test"})
	if ruleMatches(b, "old.test:443") {
		t.Fatal("old.test is listed before the swap, so it must not bypass")
	}

	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for j := 0; j < 100; j++ {
				b.Contains(context.Background(), "tcp", "old.test:443")
				b.Contains(context.Background(), "tcp", "new.test:443")
				b.IsWhitelist()
			}
		}()
	}
	close(start)
	b.SetRules([]string{"new.test"})
	wg.Wait()

	if !ruleMatches(b, "old.test:443") {
		t.Error("a rule dropped by the swap must bypass immediately")
	}
	if ruleMatches(b, "new.test:443") {
		t.Error("a rule added by the swap must go through the tunnel immediately")
	}
}

func TestRuleBypassCopiesRules(t *testing.T) {
	t.Run("constructor", func(t *testing.T) {
		rules := []string{"listed.test"}
		b := NewRuleBypass(rules)
		rules[0] = "other.test"

		if ruleMatches(b, "listed.test:443") {
			t.Error("a caller mutating its own slice must not unlist an address")
		}
		if !ruleMatches(b, "other.test:443") {
			t.Error("a caller mutating its own slice must not list an address")
		}
	})

	t.Run("set rules", func(t *testing.T) {
		rules := []string{"listed.test"}
		b := NewRuleBypass(nil)
		b.SetRules(rules)
		rules[0] = "other.test"

		if ruleMatches(b, "listed.test:443") {
			t.Error("a caller mutating its own slice must not unlist an address")
		}
		if !ruleMatches(b, "other.test:443") {
			t.Error("a caller mutating its own slice must not list an address")
		}
	})
}

func TestRuleBypassEmptyListMatchesEverything(t *testing.T) {
	for name, rules := range map[string][]string{
		"nil":   nil,
		"empty": {},
	} {
		t.Run(name, func(t *testing.T) {
			b := NewRuleBypass(rules)
			for _, addr := range []string{"example.com:443", "1.1.1.1:53", "192.168.100.100:53"} {
				if !ruleMatches(b, addr) {
					t.Errorf("%s must bypass when the list is empty: everything is direct", addr)
				}
			}
		})
	}

	b := NewRuleBypass([]string{"example.com"})
	b.SetRules(nil)
	if !ruleMatches(b, "example.com:443") {
		t.Error("clearing the list must send every address direct")
	}
}

// TestRuleBypassLogsDecisions: the inner bypass reports each verdict at debug
// through the logger it was built with, which is what makes "why did this flow
// go direct" answerable from the service's own log. The swap in SetRules must
// carry that logger too, or a hot edit would silence the split.
func TestRuleBypassLogsDecisions(t *testing.T) {
	var buf bytes.Buffer
	log := xlogger.NewLogger(
		xlogger.OutputOption(&buf),
		xlogger.LevelOption(clogger.DebugLevel),
	)
	b := NewRuleBypass([]string{"listed.test"}, RuleBypassLoggerOption(log))

	if ruleMatches(b, "listed.test:443") {
		t.Fatal("listed.test is on the list, so it must go through the tunnel")
	}
	b.SetRules([]string{"listed.test"})
	if !ruleMatches(b, "other.test:443") {
		t.Fatal("other.test is not on the list, so it must dial direct")
	}

	out := buf.String()
	if !strings.Contains(out, "proxy: listed.test:443") {
		t.Errorf("log = %q, want the listed address decided as proxy", out)
	}
	if !strings.Contains(out, "bypass: other.test:443") {
		t.Errorf("log = %q, want the unlisted address decided as bypass", out)
	}
}
