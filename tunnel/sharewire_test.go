package tunnel

import (
	"testing"
)

// RED 7: bad share-LAN fails the start fast; the badge state derives from
// what Run recorded.
func TestTunInitRefusesBadShareLAN(t *testing.T) {
	tn := NewTunTunnel(
		NetOption("10.10.0.1/24"),
		ShareLANOption("not-a-cidr"),
	).(*tunTunnel)
	if err := tn.init(); err == nil {
		t.Fatal("init with bad share_lan = nil, want a start failure naming the LAN")
	}
}

func TestShareStateDerivesDowngrade(t *testing.T) {
	hub := &tunTunnel{opts: Options{ShareLAN: "192.168.1.0/24", ShareMode: ShareAuto}}
	hub.shareEffective = ShareUserspace
	_, _, eff, down := hub.ShareState()
	if eff != ShareUserspace || !down {
		t.Fatalf("ShareState = (%q,%v), want (userspace,true)", eff, down)
	}

	hub.shareEffective = ShareKernel
	_, _, eff, down = hub.ShareState()
	if eff != ShareKernel || down {
		t.Fatalf("ShareState = (%q,%v), want (kernel,false)", eff, down)
	}

	quiet := &tunTunnel{}
	if spec, _, eff, _ := quiet.ShareState(); spec != "" || eff != "" {
		t.Fatalf("ShareState unconfigured = (%q,%q), want (\"\",\"\")", spec, eff)
	}
}
