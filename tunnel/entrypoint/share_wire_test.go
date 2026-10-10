package entrypoint

import (
	"net"
	"testing"

	tp "github.com/go-gost/wisper/tunnel"
)

// shareSeams records what the spoke's share wiring did, through the two
// package vars it calls: the kernel probe and the NAT setup.
type shareSeams struct {
	kernelOK     bool   // what the probe answers
	probes       int    // times the probe was consulted
	applyCalls   int    // times the setup was consulted
	sawKernelOK  bool   // the kernelOK the setup was handed
	hubNet, mode string // the arguments the setup was handed
	lans         string // the share_lan the setup was handed, in spec form
	cleanups     int    // times the returned teardown ran
}

// useSpokeShareSeams points the spoke's two host-touching share steps at
// fakes for one test: the probe answers kernelOK and the setup reports
// effective and counts its teardown's runs.
func useSpokeShareSeams(t *testing.T, kernelOK bool, effective string) *shareSeams {
	t.Helper()

	sh := &shareSeams{kernelOK: kernelOK}
	oldProbe, oldApply := probeKernel, applySpokeShare
	probeKernel = func() bool {
		sh.probes++
		return kernelOK
	}
	applySpokeShare = func(hubNet string, lans []*net.IPNet, mode string, kernelOK bool) (string, func(), error) {
		sh.applyCalls++
		sh.sawKernelOK = kernelOK
		sh.hubNet, sh.mode = hubNet, mode
		sh.lans = tp.ShareLANSpec(lans)
		if len(lans) == 0 {
			t.Error("the setup was handed no LANs, want the spoke's share_lan")
		}
		// Only the kernel path has rules to remove, exactly as the real
		// SetupSpokeShare reports (share_spoke_test.go).
		if effective != tp.ShareKernel {
			return effective, nil, nil
		}
		return effective, func() { sh.cleanups++ }, nil
	}
	t.Cleanup(func() {
		probeKernel, applySpokeShare = oldProbe, oldApply
	})
	return sh
}

// newShareSpoke builds a tun entrypoint that shares a LAN, ready for init.
func newShareSpoke(t *testing.T, id string) *tunEntryPoint {
	t.Helper()

	ep := NewTunEntryPoint(
		tp.IDOption(id),
		tp.NameOption(id),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.20.0.2/24"),
		tp.ShareLANOption("192.168.50.0/24"),
		tp.MTUOption(1400),
	)
	s, ok := ep.(*tunEntryPoint)
	if !ok {
		t.Fatalf("NewTunEntryPoint returned %T, want *tunEntryPoint", ep)
	}
	if err := s.init(); err != nil {
		t.Fatalf("init: %v", err)
	}
	return s
}

// A spoke that shares its LAN on a host with no kernel path must run the
// chain through the userspace shim. Choosing "forward" instead is the silent
// failure: LAN packets ride to the hub and the kernel drops them, with
// nothing anywhere saying why.
func TestSpokeSelectsShareConnectorOnDowngrade(t *testing.T) {
	sh := useSpokeShareSeams(t, false, tp.ShareUserspace)

	s := newShareSpoke(t, "ep-share-down")

	node := s.config.Chains[0].Hops[0].Nodes[0]
	if node.Connector == nil || node.Connector.Type != "tun-share" {
		t.Fatalf("node connector = %+v, want tun-share on the userspace downgrade", node.Connector)
	}
	if got := node.Connector.Metadata["lans"]; got != "192.168.50.0/24" {
		t.Errorf("connector metadata lans = %v, want 192.168.50.0/24", got)
	}
	if got := node.Connector.Metadata["mtu"]; got != 1400 {
		t.Errorf("connector metadata mtu = %v (%T), want 1400 (int)", got, got)
	}

	// The kernel was probed once, and the setup saw the spoke's own net,
	// share mode and share_lan.
	if sh.probes != 1 {
		t.Errorf("probe calls = %d, want 1", sh.probes)
	}
	if sh.applyCalls != 1 {
		t.Fatalf("setup calls = %d, want 1", sh.applyCalls)
	}
	if sh.sawKernelOK {
		t.Error("the setup was told the kernel is available, want the probe's false")
	}
	if sh.hubNet != "10.20.0.2/24" {
		t.Errorf("setup hubNet = %q, want the spoke's net", sh.hubNet)
	}
	if sh.mode != "" && tp.NormalizeShareMode(sh.mode) != tp.ShareAuto {
		t.Errorf("setup mode = %q, want it to resolve to %q", sh.mode, tp.ShareAuto)
	}
	if sh.lans != "192.168.50.0/24" {
		t.Errorf("setup lans = %q, want 192.168.50.0/24", sh.lans)
	}

	// The rest of the chain is untouched: the p2p dialer and the peer address
	// are what makes this node the spoke's link to its hub.
	if node.Dialer == nil || node.Dialer.Type != "udp" {
		t.Errorf("node dialer = %+v, want udp", node.Dialer)
	}
	if node.Addr != testPeerKey {
		t.Errorf("node addr = %q, want the hub's key", node.Addr)
	}

	// Userspace applies no rules, so there is nothing to clean up: the
	// entrypoint holds no teardown and a stop removes nothing.
	if s.shareCleanup != nil {
		t.Error("shareCleanup != nil on the userspace path, want nil (there are no rules to remove)")
	}
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if sh.cleanups != 0 {
		t.Errorf("cleanup ran %d times on the userspace path, want 0", sh.cleanups)
	}
}

// With the kernel path available the spoke shares through NAT, and the chain
// keeps the plain forward connector: there is no userspace stack to run LAN
// packets through, and the rules SetupSpokeShare applied do the work.
func TestSpokeKeepsForwardWhenKernel(t *testing.T) {
	sh := useSpokeShareSeams(t, true, tp.ShareKernel)

	s := newShareSpoke(t, "ep-share-kernel")

	node := s.config.Chains[0].Hops[0].Nodes[0]
	if node.Connector == nil || node.Connector.Type != "forward" {
		t.Fatalf("node connector = %+v, want forward on the kernel path", node.Connector)
	}
	if node.Connector.Metadata != nil {
		t.Errorf("connector metadata = %v, want none (no shim on the kernel path)", node.Connector.Metadata)
	}
	if s.shareCleanup == nil {
		t.Error("shareCleanup = nil, want the teardown for the applied rules")
	}

	// A stop clears them, and a second stop does not run them twice.
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if sh.cleanups != 1 {
		t.Fatalf("cleanup ran %d times after one Close, want exactly 1", sh.cleanups)
	}
}

// The NAT rules are host state: they are removed exactly once, however often
// the entrypoint is closed. A repeat would delete a rule a later entrypoint
// had re-added, and a start that never applied any removes nothing.
func TestSpokeShareCleanupRunsOnce(t *testing.T) {
	sh := useSpokeShareSeams(t, true, tp.ShareKernel)

	s := newShareSpoke(t, "ep-share-cleanup")
	if s.shareCleanup == nil {
		t.Fatal("shareCleanup = nil, want the teardown for the applied rules")
	}
	if sh.cleanups != 0 {
		t.Fatalf("cleanup ran %d times before Close, want 0", sh.cleanups)
	}

	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
	if sh.cleanups != 1 {
		t.Fatalf("cleanup ran %d times after two Closes, want exactly 1", sh.cleanups)
	}
}
