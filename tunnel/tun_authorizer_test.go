package tunnel

import (
	"bytes"
	"context"
	"net"
	"net/netip"
	"strings"
	"sync"
	"testing"

	"github.com/go-gost/wisper/event"
	tunhandler "github.com/go-gost/x/handler/tun"
	xlogger "github.com/go-gost/x/logger"
)

// TestAuthorizeMatchesAnIPv4ClaimAgainstAnIPv4Assignment: the assignment is a
// config string, so it is written "10.10.0.2" and parses to a 4-byte netip.Addr.
// The claim is not — x reads the frame, where every address is 16 bytes, so an
// IPv4 spoke arrives as the 16-byte v4-in-v6 ::ffff:10.10.0.2. Those are the same
// address and two different netip.Addr values, so every spelling of an IPv4 claim
// is asserted here. Unmap is the only thing that makes them one, and a
// comparison that skipped it would refuse every IPv4 spoke on the hub.
func TestAuthorizeMatchesAnIPv4ClaimAgainstAnIPv4Assignment(t *testing.T) {
	a := newSpokeAuthorizer("hub-ipv4", map[string]string{"p1": "10.10.0.2"}, xlogger.Nop())
	ctx := context.Background()

	// The fact the whole comparison rests on, pinned on its own so a netip change
	// that broke it would be named here rather than by a symptom.
	if got := netip.MustParseAddr("::ffff:10.10.0.2").Unmap(); got != netip.MustParseAddr("10.10.0.2") {
		t.Errorf("netip.ParseAddr(%q).Unmap() = %s, want 10.10.0.2 — without Unmap an IPv4 claim and an IPv4 assignment are two addresses",
			"::ffff:10.10.0.2", got)
	}

	for name, claim := range map[string]net.IP{
		"4 bytes":       net.ParseIP("10.10.0.2").To4(),
		"16 bytes":      net.ParseIP("10.10.0.2").To16(),
		"::ffff: form":  net.ParseIP("::ffff:10.10.0.2").To16(),
		"4-byte mapped": {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 10, 10, 0, 2},
	} {
		if len(claim) == 0 {
			t.Fatalf("%s: the fixture is not an address", name)
		}
		if !a.Authorize(ctx, "p1", []net.IP{claim}) {
			t.Errorf("a %s claim of 10.10.0.2 was refused, want authorized: it is the address the row names", name)
		}
	}

	// The sizes are asserted rather than assumed: a fixture that silently became
	// the 4-byte form would leave the 16-byte case untested.
	if got := len(net.ParseIP("10.10.0.2").To16()); got != net.IPv6len {
		t.Errorf("the 16-byte fixture is %d bytes, want %d", got, net.IPv6len)
	}

	// The same canonicalization is applied to the row, so a config that spells an
	// IPv4 address in the ::ffff: form — which is what an older save wrote — still
	// matches the plain claim the spoke makes for it.
	mappedRow := newSpokeAuthorizer("hub-ipv4-mapped", map[string]string{"p1": "::ffff:10.10.0.2"}, xlogger.Nop())
	if !mappedRow.Authorize(ctx, "p1", []net.IP{net.ParseIP("10.10.0.2").To4()}) {
		t.Error("a row written as ::ffff:10.10.0.2 refused the claim of 10.10.0.2, want authorized")
	}
}

// TestAuthorizeMatchesTwoAddressesAsASet: a row may name two addresses — one per
// family, typically — and a spoke holding both is holding exactly what it was
// given. Nothing here is about being lenient: the same row refuses every claim
// that is not that set, which the other tests pin.
func TestAuthorizeMatchesTwoAddressesAsASet(t *testing.T) {
	a := newSpokeAuthorizer("hub-two", map[string]string{"p1": "10.10.0.2,fd00::2"}, xlogger.Nop())
	ctx := context.Background()

	claim := []net.IP{net.ParseIP("10.10.0.2").To16(), net.ParseIP("fd00::2").To16()}
	if !a.Authorize(ctx, "p1", claim) {
		t.Errorf("a claim of exactly the row's two addresses was refused, want authorized (assigned %v)", claim)
	}

	// Order is part of the comparison, because both ends build the frame from the
	// same allowlist row: the spoke writes the addresses in the row's order and
	// the hub compares index by index. A spoke that reorders its own list and
	// keeps the same set is refused, and says so in the same warning as any other
	// mismatch — which is the point of reporting refusals at all.
	reversed := []net.IP{claim[1], claim[0]}
	if a.Authorize(ctx, "p1", reversed) {
		t.Errorf("a claim of the row's two addresses in the other order was authorized, want refused")
	}
}

// TestAuthorizeRefusesASupersetClaim: the rule this authorizer exists for. Before
// it, any allowlisted spoke could claim any address, and the route table is
// last-writer-wins per address — so a claim of a neighbour's address took that
// route from the spoke that owns it, silently, and the neighbour's traffic went
// to the wrong device. Both directions of the rule are here: the extra address is
// refused, and so is the subset.
func TestAuthorizeRefusesASupersetClaim(t *testing.T) {
	ctx := context.Background()
	a := newSpokeAuthorizer("hub-over", map[string]string{"p1": "10.10.0.2", "p2": "10.10.0.3"}, xlogger.Nop())

	// p1 claims its own address and p2's.
	over := []net.IP{net.ParseIP("10.10.0.2").To16(), net.ParseIP("10.10.0.3").To16()}
	if a.Authorize(ctx, "p1", over) {
		t.Errorf("a spoke claiming an address assigned to p2 was authorized, want refused")
	}
	// p2's own claim is unaffected: the refusal above is about p1's claim, not a
	// hub that has stopped authorizing.
	if !a.Authorize(ctx, "p2", []net.IP{net.ParseIP("10.10.0.3").To16()}) {
		t.Error("p2's own claim was refused after p1's was, want authorized")
	}

	// The same rule from the other side: a row that names two is not satisfied by
	// claiming one of them.
	two := newSpokeAuthorizer("hub-sub", map[string]string{"p1": "10.10.0.2,10.10.0.3"}, xlogger.Nop())
	if two.Authorize(ctx, "p1", []net.IP{net.ParseIP("10.10.0.2").To16()}) {
		t.Error("a spoke claiming one of the two addresses it was assigned was authorized, want refused")
	}
}

// TestAuthorizeRefusesAnUnknownPeer: deny by default. A peer that is not in the
// assignment may claim nothing, and a hub with no assignment loaded at all — a
// zero-valued authorizer, before any set — may claim nothing either.
func TestAuthorizeRefusesAnUnknownPeer(t *testing.T) {
	ctx := context.Background()
	a := newSpokeAuthorizer("hub-unknown", map[string]string{"p1": "10.10.0.2"}, xlogger.Nop())

	if a.Authorize(ctx, "p2", []net.IP{net.ParseIP("10.10.0.2").To16()}) {
		t.Error("a peer that is not in the assignment was authorized, want refused")
	}
	if a.Authorize(ctx, "p2", nil) {
		t.Error("a peer that is not in the assignment was authorized for an empty claim, want refused")
	}

	bare := &spokeAuthorizer{hubID: "hub-bare", log: xlogger.Nop()}
	if bare.Authorize(ctx, "p1", []net.IP{net.ParseIP("10.10.0.2").To16()}) {
		t.Error("an authorizer with no assignment loaded authorized a claim, want refused")
	}

	// A hub that was built without a logger still refuses, rather than panicking on
	// the reporting path: that panic would land inside the hub's registration loop
	// and take the hub down with it.
	noLog := newSpokeAuthorizer("hub-nillog", map[string]string{"p1": "10.10.0.2"}, nil)
	if noLog.Authorize(ctx, "p1", []net.IP{net.ParseIP("10.10.0.9").To16()}) {
		t.Error("an authorizer with no logger authorized a claim, want refused")
	}
}

// TestAuthorizeRefusesWhenTheRowIsEmpty: an empty row means "this spoke may claim
// nothing" — before allocation fills it, or after it was deliberately cleared. Not
// "any address", and not "allocate me one". It falls out of the exact comparison:
// a claim of an address is not the empty set, and a claim of nothing is.
func TestAuthorizeRefusesWhenTheRowIsEmpty(t *testing.T) {
	ctx := context.Background()
	a := newSpokeAuthorizer("hub-empty", map[string]string{"p1": ""}, xlogger.Nop())

	if a.Authorize(ctx, "p1", []net.IP{net.ParseIP("10.10.0.2").To16()}) {
		t.Error("a spoke with an empty row claimed an address and was authorized, want refused")
	}
	// Claiming nothing is exactly what the row says, and it registers no route:
	// nil and an empty slice are the same claim.
	if !a.Authorize(ctx, "p1", nil) {
		t.Error("a spoke with an empty row was refused for claiming nothing, want authorized")
	}
	if !a.Authorize(ctx, "p1", []net.IP{}) {
		t.Error("a spoke with an empty row was refused for an empty claim slice, want authorized")
	}

	// A row whose value does not parse names no address either. It is left out of
	// the assignment, so the peer is refused as unknown — one typo costs that
	// spoke its address, and costs no other spoke its hub.
	bad := newSpokeAuthorizer("hub-badrow", map[string]string{"p1": "10.10.0.2/24", "p2": "10.10.0.3"}, xlogger.Nop())
	if bad.Authorize(ctx, "p1", []net.IP{net.ParseIP("10.10.0.2").To16()}) {
		t.Error("a spoke whose row does not parse was authorized, want refused")
	}
	if !bad.Authorize(ctx, "p2", []net.IP{net.ParseIP("10.10.0.3").To16()}) {
		t.Error("a well-formed row beside the bad one was refused, want authorized")
	}
}

// TestAuthorizeRefusesAMalformedClaim: a claim that is not an address at all is
// refused, and it is refused as malformed rather than as a mismatch.
//
// The peer key here is one the hub knows, on purpose. An unknown peer is turned
// away at the map lookup, so a malformed claim under an unknown key would never
// reach the code that refuses it — the test would pass while proving nothing. The
// malformed claims below are also given the same number of addresses as the row,
// so a length check cannot be what refused them: the only reason left is the
// conversion.
func TestAuthorizeRefusesAMalformedClaim(t *testing.T) {
	const hubID = "hub-badclaim"
	event.Seed(hubID, nil) // isolate: the store is process-wide
	t.Cleanup(func() { event.Seed(hubID, nil) })

	ctx := context.Background()
	a := newSpokeAuthorizer(hubID, map[string]string{"p1": "10.10.0.2,10.10.0.3"}, xlogger.Nop())
	claim := []net.IP{net.ParseIP("10.10.0.2").To16(), net.ParseIP("10.10.0.3").To16()}

	if !a.Authorize(ctx, "p1", claim) {
		t.Fatalf("a well-formed claim from a known peer was refused: the refusals below would prove nothing")
	}

	// Two claims where the second is not an address, so the count matches the row
	// and only the conversion can refuse.
	for name, ip := range map[string]net.IP{
		"five bytes":  {10, 10, 0, 3, 9},
		"three bytes": {10, 10, 0},
		"no bytes":    {},
	} {
		if a.Authorize(ctx, "p1", []net.IP{claim[0], ip}) {
			t.Errorf("a claim whose second address is %s was authorized, want refused", name)
		}
	}

	// The same holds when the count does not match: a malformed claim is refused
	// either way, and never silently ignored.
	if a.Authorize(ctx, "p1", []net.IP{{10, 10, 0, 2, 7}}) {
		t.Error("a one-address claim that is not an address was authorized, want refused")
	}

	// Refused as malformed, not as a mismatch. Both refusals above are also
	// mismatches — a zero netip.Addr never equals an assigned one — so the outcome
	// alone cannot say which code refused them, and the stated reason is what an
	// operator reads: "claimed ::, assigned 10.10.0.3" would blame the spoke's
	// configuration, when what it sent was not an address at all.
	var named bool
	for _, ev := range event.List(hubID) {
		if ev.Level == event.LevelWarn && strings.Contains(ev.Message, "not 4 or 16") {
			named = true
		}
	}
	if !named {
		t.Errorf("no refusal names the malformed claim, want one saying it is not 4 or 16 bytes; history: %v", event.List(hubID))
	}
}

// TestAuthorizeRecordsAWarnEvent: a refusal is the interesting event, so it is
// recorded in both places an operator can see it — the hub's event history, and
// the hub's log line. x cannot record either: the hub's peer loop accepts a stream
// and never parses a frame, so by the time the claim is refused the peer, what it
// claimed and what it was assigned are known only here.
func TestAuthorizeRecordsAWarnEvent(t *testing.T) {
	const hubID = "hub-warn"
	event.Seed(hubID, nil) // isolate: the store is process-wide
	t.Cleanup(func() { event.Seed(hubID, nil) })

	var buf bytes.Buffer
	a := newSpokeAuthorizer(hubID, map[string]string{"p1": "10.10.0.2"},
		xlogger.NewLogger(xlogger.OutputOption(&buf)))
	if a.Authorize(context.Background(), "p1", []net.IP{net.ParseIP("10.10.0.9").To16()}) {
		t.Fatal("a spoke claiming an address it was not assigned was authorized")
	}

	// The log line is the half that reaches an operator watching a terminal rather
	// than the UI, so it names the same things the event does.
	for _, want := range []string{"p1", "10.10.0.9", "10.10.0.2"} {
		if !strings.Contains(buf.String(), want) {
			t.Errorf("the hub's log line %q does not mention %s", buf.String(), want)
		}
	}

	var warns []string
	for _, ev := range event.List(hubID) {
		if ev.Level == event.LevelWarn {
			warns = append(warns, ev.Message)
		}
	}
	if len(warns) != 1 {
		t.Fatalf("the hub's history holds %d warn entries, want exactly 1: %q", len(warns), warns)
	}
	// An operator reading this has to be able to act on it: which spoke, what it
	// claimed, and what it was supposed to claim instead.
	for _, want := range []string{"p1", "10.10.0.9", "10.10.0.2"} {
		if !strings.Contains(warns[0], want) {
			t.Errorf("the warning %q does not mention %s", warns[0], want)
		}
	}

	// The hub's ID, not the peer's: a peer key names an object the UI has no page
	// for, so an event filed under it would be invisible.
	if evs := event.List("p1"); len(evs) != 0 {
		t.Errorf("the peer key's history holds %d entries, want none: refusals are filed under the hub", len(evs))
	}
}

// TestAuthorizeStopsOnACancelledContext: the context belongs to the registration,
// and a spoke whose stream died mid-registration has to stop there rather than
// have its claim decided. It is also not recorded: a cancelled context is not a
// policy decision, and reporting it would write a warning into the hub's history
// on every disconnect of every spoke.
func TestAuthorizeStopsOnACancelledContext(t *testing.T) {
	const hubID = "hub-cancel"
	event.Seed(hubID, nil) // isolate: the store is process-wide
	t.Cleanup(func() { event.Seed(hubID, nil) })

	a := newSpokeAuthorizer(hubID, map[string]string{"p1": "10.10.0.2"}, xlogger.Nop())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if a.Authorize(ctx, "p1", []net.IP{net.ParseIP("10.10.0.2").To16()}) {
		t.Error("a claim was authorized on a cancelled context, want refused")
	}
	if evs := event.List(hubID); len(evs) != 0 {
		t.Errorf("a cancelled registration recorded %d events, want none", len(evs))
	}
}

// TestAuthorizeSeesAnAssignmentSwappedUnderIt: a save replaces the whole
// assignment while spokes are registering, and it must take effect without the
// tun device being re-created — which would need the privilege the hub was started
// with. So the assignment sits behind an atomic pointer rather than a mutex: a
// registration reads it once and a save never waits for one.
func TestAuthorizeSeesAnAssignmentSwappedUnderIt(t *testing.T) {
	ctx := context.Background()
	a := newSpokeAuthorizer("hub-swap", map[string]string{"p1": "10.10.0.2"}, xlogger.Nop())
	old := []net.IP{net.ParseIP("10.10.0.2").To16()}

	if !a.Authorize(ctx, "p1", old) {
		t.Fatal("the initial assignment refused its own claim")
	}

	a.set(map[string]string{"p1": "10.10.0.3"})
	if a.Authorize(ctx, "p1", old) {
		t.Error("the old assignment still authorizes after a save, want refused")
	}
	if !a.Authorize(ctx, "p1", []net.IP{net.ParseIP("10.10.0.3").To16()}) {
		t.Error("the new assignment did not take effect, want authorized")
	}

	// Then with a save running in another goroutine, which is the shape this
	// actually runs in: -race checks that the swap and the decision do not touch
	// the same memory, and both outcomes being seen proves the loop observed the
	// swap rather than one assignment.
	var wg sync.WaitGroup
	stop := make(chan struct{})
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; ; i++ {
			if i%2 == 0 {
				a.set(map[string]string{"p1": "10.10.0.2"})
			} else {
				a.set(map[string]string{"p1": "10.10.0.2,10.10.0.3"})
			}
			select {
			case <-stop:
				return
			default:
			}
		}
	}()

	both := []net.IP{old[0], net.ParseIP("10.10.0.3").To16()}
	var allowed, refused int
	for i := 0; i < 2000; i++ {
		if a.Authorize(ctx, "p1", both) {
			allowed++
		} else {
			refused++
		}
	}
	close(stop)
	wg.Wait()

	if allowed == 0 || refused == 0 {
		t.Errorf("the loop saw %d allowed and %d refused claims, want both: the swap was not observed", allowed, refused)
	}
}

// TestSpokeAuthorizerSatisfiesPeerAuthorizer: structural, not behavioural. This is
// the assertion that lets wisper satisfy x's hook by shape; the same one stands at
// the top of tun_authorizer.go, where it fails the build if x's interface drifts.
func TestSpokeAuthorizerSatisfiesPeerAuthorizer(t *testing.T) {
	var auth tunhandler.PeerAuthorizer = newSpokeAuthorizer(
		"hub-iface", map[string]string{"p1": "10.10.0.2"}, xlogger.Nop())

	if !auth.Authorize(context.Background(), "p1", []net.IP{net.ParseIP("10.10.0.2").To16()}) {
		t.Error("the authorizer refused a valid claim when called through x's interface")
	}
	if auth.Authorize(context.Background(), "p1", []net.IP{net.ParseIP("10.10.0.3").To16()}) {
		t.Error("the authorizer allowed an invalid claim when called through x's interface")
	}
}
