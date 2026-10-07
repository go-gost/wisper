package tunnel

import (
	"testing"
)

// RED 1: share-LAN mode + nets parsing (pure function, no system calls).
func TestParseShareLANMode(t *testing.T) {
	if got := NormalizeShareMode(""); got != ShareAuto {
		t.Fatalf("NormalizeShareMode(\"\") = %q, want %q", got, ShareAuto)
	}
	if got := NormalizeShareMode("kernel"); got != ShareKernel {
		t.Fatalf("NormalizeShareMode(kernel) = %q, want %q", got, ShareKernel)
	}
	if got := NormalizeShareMode("bogus"); got != ShareAuto {
		t.Fatalf("NormalizeShareMode(bogus) = %q, want fallback %q", got, ShareAuto)
	}
}

func TestParseShareLANNets(t *testing.T) {
	nets, err := ParseShareLANNets("192.168.1.0/24, 10.0.0.0/8")
	if err != nil {
		t.Fatalf("ParseShareLANNets: %v", err)
	}
	if len(nets) != 2 {
		t.Fatalf("ParseShareLANNets = %d nets, want 2", len(nets))
	}
	if _, err := ParseShareLANNets("not-a-cidr"); err == nil {
		t.Fatal("ParseShareLANNets(not-a-cidr) = nil error, want a failure")
	}
	if _, err := ParseShareLANNets(""); err != nil {
		t.Fatalf("ParseShareLANNets(\"\") = %v, want nil (sharing disabled)", err)
	}
}
