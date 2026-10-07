package tunnel

import (
	"testing"
)

// RED 2: kernel NAT rule construction is pure (no iptables calls here) —
// MASQUERADE hides the return path so the LAN gateway needs no static route.
func TestBuildShareNATRules(t *testing.T) {
	rules, err := BuildShareNATRules("10.10.0.0/24", "192.168.1.0/24")
	if err != nil {
		t.Fatalf("BuildShareNATRules: %v", err)
	}
	if len(rules) == 0 {
		t.Fatal("BuildShareNATRules = no rules, want MASQUERADE + FORWARD")
	}
	joined := ""
	for _, r := range rules {
		joined += r + "\n"
	}
	for _, want := range []string{"MASQUERADE", "10.10.0.0/24", "192.168.1.0/24", "FORWARD"} {
		if !contains(joined, want) {
			t.Fatalf("rules miss %q:\n%s", want, joined)
		}
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}
