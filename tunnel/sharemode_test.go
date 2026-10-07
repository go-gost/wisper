package tunnel

import (
	"testing"
)

// RED 4: auto tries kernel, degrades visibly; a pinned kernel that cannot
// run fails the start instead of silently degrading.
func TestResolveShareMode(t *testing.T) {
	eff, down, err := resolveShareMode(ShareAuto, true)
	if err != nil || eff != ShareKernel || down {
		t.Fatalf("auto+kernel = (%q,%v,%v), want (kernel,false,nil)", eff, down, err)
	}
	eff, down, err = resolveShareMode(ShareAuto, false)
	if err != nil || eff != ShareUserspace || !down {
		t.Fatalf("auto+no-kernel = (%q,%v,%v), want (userspace,true,nil)", eff, down, err)
	}
	if _, _, err = resolveShareMode(ShareKernel, false); err == nil {
		t.Fatal("kernel+no-kernel = nil error, want a start failure")
	}
	eff, down, err = resolveShareMode(ShareUserspace, true)
	if err != nil || eff != ShareUserspace || down {
		t.Fatalf("userspace+kernel = (%q,%v,%v), want (userspace,false,nil)", eff, down, err)
	}
	// Empty config (sharing disabled) resolves to nothing, no error.
	eff, _, err = resolveShareMode("", true)
	if err != nil || eff != "" {
		t.Fatalf("empty = (%q,%v), want (\"\",nil)", eff, err)
	}
}
