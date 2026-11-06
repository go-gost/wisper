package entrypoint

import (
	"bytes"
	"context"
	"net"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/go-gost/p2p"
	cfg "github.com/go-gost/wisper/config"
	tp "github.com/go-gost/wisper/tunnel"
	tunhandler "github.com/go-gost/x/handler/tun"
)

func TestTunOptionsBlockedPeersRoundTrip(t *testing.T) {
	ep := NewTunEntryPoint(
		tp.IDOption("ep-blocked-roundtrip"),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.0.2/24"),
		tp.BlockedPeersOption(" b ", "a", "b", ""),
	)
	opts := ep.Options()
	if want := []string{"b", "a"}; !slices.Equal(opts.BlockedPeers, want) {
		t.Fatalf("BlockedPeers = %v, want %v", opts.BlockedPeers, want)
	}

	// The options carry every shared field into a replacement run, which is
	// the Restart path. A field missing here is a block lost on a VPN flap.
	replacement := NewTunEntryPoint(tp.TunnelOptions(opts)...)
	if got := replacement.Options().BlockedPeers; !slices.Equal(got, []string{"b", "a"}) {
		t.Fatalf("replacement BlockedPeers = %v, want the block carried", got)
	}
	_ = replacement.Close()

	t.Chdir(t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	cfg.Set(&cfg.Config{})
	Add(ep)
	t.Cleanup(func() { Delete("ep-blocked-roundtrip") })

	if err := SaveConfig(); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	saved := cfg.Get().EntryPoints
	if len(saved) != 1 {
		t.Fatalf("saved %d entrypoints, want 1", len(saved))
	}
	if want := []string{"b", "a"}; !slices.Equal(saved[0].BlockedPeers, want) {
		t.Fatalf("persisted BlockedPeers = %v, want %v", saved[0].BlockedPeers, want)
	}
	raw, err := os.ReadFile("wisper.yaml")
	if err != nil {
		t.Fatalf("read back the config: %v", err)
	}
	if !bytes.Contains(raw, []byte("blocked_peers:")) {
		t.Fatalf("wisper.yaml carries no blocked_peers key:\n%s", raw)
	}
}

func TestTunPeerListRows(t *testing.T) {
	const hub = "hub-key"
	ep := NewTunEntryPoint(
		tp.IDOption("ep-peer-list"),
		tp.PeerOption(hub),
		tp.NetOption("10.10.0.2/24"),
	)
	t.Cleanup(func() { _ = ep.Close() })
	te := ep.(*tunEntryPoint)
	te.peerView = func() ([]tp.NetviewMember, []tp.NetviewClaim) {
		return []tp.NetviewMember{
			{IP: "10.10.100.1", Key: hub, Name: "hub"},
			{IP: "10.10.100.6", Key: "peerC", Name: "blocked-one"},
			{IP: "10.10.100.5", Key: "peerB", Name: "laptop", Direct: true},
			{IP: "10.10.100.4", Key: "peerA", Name: "off", Disabled: true},
		}, []tp.NetviewClaim{
			{Prefix: "192.168.50.0/24", Origin: "peerB"},
			{Prefix: "192.168.60.0/24", Origin: "peerA"},
		}
	}
	if err := te.SetBlockedPeers(context.Background(), []string{"peerC", "peerGone"}); err != nil {
		t.Fatalf("SetBlockedPeers: %v", err)
	}
	restoreStatus := p2pStatus
	p2pStatus = func() p2p.Status {
		return p2p.Status{PeerDiagnostics: map[string]p2p.PeerDiagnostic{
			hub: {Transport: "quic", QUIC: &p2p.QUICStats{Live: true, RTT: 42 * time.Millisecond}},
		}}
	}
	t.Cleanup(func() { p2pStatus = restoreStatus })

	rows := te.PeerList()
	if len(rows) != 5 {
		t.Fatalf("PeerList rows = %d, want 5: %+v", len(rows), rows)
	}
	if rows[0].Key != hub || rows[0].State != "hub" || rows[0].Name != "Hub" {
		t.Fatalf("first row = %+v, want the hub row", rows[0])
	}
	if rows[0].RTTMs != 42 {
		t.Fatalf("hub RTT = %dms, want the QUIC connection's 42ms", rows[0].RTTMs)
	}
	// A diagnostic left behind by a dead session must not draw a latency on a
	// row whose transport is gone.
	p2pStatus = func() p2p.Status {
		return p2p.Status{PeerDiagnostics: map[string]p2p.PeerDiagnostic{
			hub: {Transport: "quic", QUIC: &p2p.QUICStats{Live: false, RTT: 42 * time.Millisecond}},
		}}
	}
	if got := te.PeerList()[0].RTTMs; got != 0 {
		t.Fatalf("dead hub session RTT = %dms, want no value", got)
	}
	if rows[1].Key != "peerA" || rows[1].State != "disabled" || rows[1].Name != "off" {
		t.Fatalf("peerA row = %+v, want disabled", rows[1])
	}
	if !slices.Equal(rows[1].LANs, []string{"192.168.60.0/24"}) {
		t.Fatalf("peerA LANs = %v, want its claim", rows[1].LANs)
	}
	if rows[2].Key != "peerB" || rows[2].State != "direct-off" || !rows[2].Direct {
		t.Fatalf("peerB row = %+v, want direct-off", rows[2])
	}
	if !slices.Equal(rows[2].LANs, []string{"192.168.50.0/24"}) {
		t.Fatalf("peerB LANs = %v, want its claim", rows[2].LANs)
	}
	if rows[3].Key != "peerC" || rows[3].State != "blocked" || !rows[3].Blocked {
		t.Fatalf("peerC row = %+v, want blocked", rows[3])
	}
	if rows[4].Key != "peerGone" || rows[4].State != "blocked" || !rows[4].Blocked {
		t.Fatalf("stale blocked row = %+v, want blocked after the members", rows[4])
	}
	if !slices.Equal(rows[2].IPs, []string{"10.10.100.5"}) {
		t.Fatalf("peerB IPs = %v, want its tun address", rows[2].IPs)
	}
}

func TestTunSetBlockedPeersInPlace(t *testing.T) {
	ep := NewTunEntryPoint(
		tp.IDOption("ep-blocked-in-place"),
		tp.PeerOption(testPeerKey),
		tp.NetOption("10.10.0.2/24"),
	)
	t.Cleanup(func() { _ = ep.Close() })
	te := ep.(*tunEntryPoint)

	if err := te.SetBlockedPeers(context.Background(), []string{" peerB ", "peerB", ""}); err != nil {
		t.Fatalf("SetBlockedPeers: %v", err)
	}
	if got := te.Options().BlockedPeers; !slices.Equal(got, []string{"peerB"}) {
		t.Fatalf("BlockedPeers = %v, want normalized [peerB]", got)
	}
	if rows := te.PeerList(); len(rows) != 2 || rows[1].Key != "peerB" || !rows[1].Blocked {
		t.Fatalf("stale blocked row missing after an in-place set: %+v", rows)
	}

	// A stopped entrypoint has no filter yet; setting a block must store it
	// for the next run rather than panic.
	te.filter = nil
	if err := te.SetBlockedPeers(context.Background(), []string{"peerA"}); err != nil {
		t.Fatalf("SetBlockedPeers with no filter: %v", err)
	}
	if got := te.Options().BlockedPeers; !slices.Equal(got, []string{"peerA"}) {
		t.Fatalf("BlockedPeers = %v, want [peerA]", got)
	}

	// Clearing is explicit and persists as nil.
	if err := te.SetBlockedPeers(context.Background(), nil); err != nil {
		t.Fatalf("SetBlockedPeers clear: %v", err)
	}
	if got := te.Options().BlockedPeers; len(got) != 0 {
		t.Fatalf("BlockedPeers after clear = %v, want empty", got)
	}
}

func TestTunPeerListJoinsMeshStatus(t *testing.T) {
	const hub = "hub-key"
	ep := NewTunEntryPoint(
		tp.IDOption("ep-peer-list-direct"),
		tp.PeerOption(hub),
		tp.NetOption("10.10.0.2/24"),
	)
	t.Cleanup(func() { _ = ep.Close() })
	te := ep.(*tunEntryPoint)
	te.peerView = func() ([]tp.NetviewMember, []tp.NetviewClaim) {
		return []tp.NetviewMember{
			{IP: "10.10.100.1", Key: hub, Name: "hub"},
			{IP: "10.10.100.5", Key: "peerB", Name: "laptop", Direct: true},
		}, []tp.NetviewClaim{{Prefix: "192.168.50.0/24", Origin: "peerB"}}
	}
	te.directRun = &directRuntime{mesh: &fakeMesh{
		members: []tunhandler.MeshMember{{Key: "peerB", IP: net.ParseIP("10.10.100.5"), Direct: true}},
		dialed:  map[string]bool{"peerB": true},
	}}
	restoreStatus := p2pStatus
	p2pStatus = func() p2p.Status {
		return p2p.Status{PeerDiagnostics: map[string]p2p.PeerDiagnostic{
			hub:     {Transport: "quic", QUIC: &p2p.QUICStats{Live: true, RTT: 43 * time.Millisecond}},
			"peerB": {Transport: "quic", QUIC: &p2p.QUICStats{Live: true, RTT: 17 * time.Millisecond}},
		}}
	}
	t.Cleanup(func() { p2pStatus = restoreStatus })

	rows := te.PeerList()
	if len(rows) != 2 {
		t.Fatalf("PeerList = %+v, want hub + direct peer", rows)
	}
	if rows[0].Key != hub || rows[0].State != "hub" {
		t.Fatalf("hub row = %+v", rows[0])
	}
	if rows[0].RTTMs != 43 {
		t.Fatalf("hub RTT = %dms, want the QUIC connection's 43ms", rows[0].RTTMs)
	}
	if rows[1].Key != "peerB" || rows[1].State != "direct" || !rows[1].Direct {
		t.Fatalf("direct row = %+v", rows[1])
	}
	if rows[1].RTTMs != 17 {
		t.Fatalf("direct peer RTT = %dms, want 17ms", rows[1].RTTMs)
	}
	if !slices.Equal(rows[1].LANs, []string{"192.168.50.0/24"}) {
		t.Fatalf("LANs = %v", rows[1].LANs)
	}

	// A blocked peer that is no longer in the mesh view stays unblockable.
	if err := te.SetBlockedPeers(context.Background(), []string{"peerGone"}); err != nil {
		t.Fatalf("SetBlockedPeers: %v", err)
	}
	rows = te.PeerList()
	if last := rows[len(rows)-1]; last.Key != "peerGone" || last.State != "blocked" {
		t.Fatalf("stale blocked row = %+v", last)
	}
}
