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
// that is not that set, which the tests below pin.
func TestAuthorizeMatchesTwoAddressesAsASet(t *testing.T) {
	a := newSpokeAuthorizer("hub-two", map[string]string{"p1": "10.10.0.2,fd00::2"}, xlogger.Nop())
	ctx := context.Background()

	claim := []net.IP{net.ParseIP("10.10.0.2").To16(), net.ParseIP("fd00::2").To16()}
	if !a.Authorize(ctx, "p1", claim) {
		t.Errorf("a claim of exactly the row's two addresses was refused, want authorized (assigned %v)", claim)
	}

	// Order is not part of the rule. The claim is a []net.IP parsed out of a frame
	// that arrived over the network, and nothing in the protocol pins its order to
	// the row's — so the same set announced the other way round is the same claim,
	// and refusing it would be an intermittent spoke failure with a warning that
	// names no cause. This is the regression test for exactly that.
	reversed := []net.IP{claim[1], claim[0]}
	if !a.Authorize(ctx, "p1", reversed) {
		t.Errorf("a claim of the row's two addresses in the other order was refused, want authorized: the set is the same (%v)", reversed)
	}
}

// TestAuthorizeComparesTheSetNotTheSequence: set equality has two halves and both
// need teeth, because the containment sweep alone is a subset check.
//
// The length check is what makes the sweep exact: with both sets the same size,
// every claimed address assigned leaves no room for an extra one. Take the length
// check away and a spoke entitled to 10.10.0.2 claims 10.10.0.3 as well, takes that
// route from the spoke that owns it, and the sweep still passes — which is the
// whole defect this authorizer exists to prevent. So all four combinations are here:
// same set either order is authorized, and a set that differs in either direction —
// one address too many, or one too few — is refused.
func TestAuthorizeComparesTheSetNotTheSequence(t *testing.T) {
	ctx := context.Background()
	// v4 is the 16-byte form x puts on the wire; v4short the 4-byte form a caller
	// holding a net.IPv4 has. Both spell one address, so a claim mixing them is
	// still the row's set.
	v4 := func(s string) net.IP { return net.ParseIP(s).To16() }
	v4short := func(s string) net.IP { return net.ParseIP(s).To4() }
	v6 := func(s string) net.IP { return net.ParseIP(s).To16() }

	// One address: order cannot vary, so the case is the sweep against a length check.
	one := newSpokeAuthorizer("hub-set-one", map[string]string{"p1": "10.10.0.2"}, xlogger.Nop())
	if !one.Authorize(ctx, "p1", []net.IP{v4("10.10.0.2")}) {
		t.Error("the row's own single address was refused, want authorized")
	}
	// Two claimed, one assigned: the containment sweep would pass the first and the
	// length check is the only thing that refuses.
	if one.Authorize(ctx, "p1", []net.IP{v4("10.10.0.2"), v4("10.10.0.3")}) {
		t.Error("a spoke assigned one address claimed two, want refused")
	}
	// Zero claimed, one assigned: the other direction, which no sweep would catch.
	if one.Authorize(ctx, "p1", nil) {
		t.Error("a spoke assigned one address claimed none, want refused")
	}

	// Two addresses: the same set in either order is authorized.
	two := newSpokeAuthorizer("hub-set-two", map[string]string{"p1": "10.10.0.2,fd00::2"}, xlogger.Nop())
	for name, claim := range map[string][]net.IP{
		"row order":    {v4("10.10.0.2"), v6("fd00::2")},
		"reversed":     {v6("fd00::2"), v4("10.10.0.2")},
		"rotated":      {v4("fd00::2"), v4("10.10.0.2")},
		"mixed widths": {v4short("10.10.0.2"), v6("fd00::2")},
	} {
		if !two.Authorize(ctx, "p1", claim) {
			t.Errorf("%s: a claim of the row's set was refused, want authorized", name)
		}
	}
	// A different pair of the same size: both containment directions are exercised,
	// because the first claimed address is assigned and the second is not.
	if two.Authorize(ctx, "p1", []net.IP{v4("10.10.0.2"), v4("10.10.0.3")}) {
		t.Error("a spoke assigned 10.10.0.2,fd00::2 claimed 10.10.0.2,10.10.0.3, want refused")
	}
	if two.Authorize(ctx, "p1", []net.IP{v4("fd00::2"), v4("10.10.0.3")}) {
		t.Error("a spoke assigned 10.10.0.2,fd00::2 claimed fd00::2,10.10.0.3, want refused")
	}
}

// TestAuthorizeRefusesARepeatedAddress: the third way a claim can be the wrong
// length of correct, and the one a containment sweep cannot see.
//
// Assigned 10.10.0.2, 10.10.0.3, 10.10.0.4 and claiming 10.10.0.2, 10.10.0.2,
// 10.10.0.3 is the same count, every claimed address assigned, and neither the
// assignment nor a subset of it — 10.10.0.4 was never claimed. Nothing is stolen,
// so a sweep that only asks "is this address mine?" passes it, and the invariant
// the whole feature rests on stops being true. The sweep consumes instead: the
// second 10.10.0.2 finds its entry already taken.
func TestAuthorizeRefusesARepeatedAddress(t *testing.T) {
	ctx := context.Background()
	v4 := func(s string) net.IP { return net.ParseIP(s).To16() }
	three := []net.IP{v4("10.10.0.2"), v4("10.10.0.3"), v4("10.10.0.4")}
	repeat := []net.IP{v4("10.10.0.2"), v4("10.10.0.2"), v4("10.10.0.3")}

	a := newSpokeAuthorizer("hub-repeat", map[string]string{"p1": "10.10.0.2,10.10.0.3,10.10.0.4"}, xlogger.Nop())
	// The fixture has to work before the refusals below can prove anything: the
	// whole set, claimed once each, in every order.
	for name, claim := range map[string][]net.IP{
		"row order": three,
		"reversed":  {three[2], three[1], three[0]},
	} {
		if !a.Authorize(ctx, "p1", claim) {
			t.Fatalf("%s: a claim of the row's three addresses was refused, want authorized", name)
		}
	}

	if a.Authorize(ctx, "p1", repeat) {
		t.Errorf("a spoke assigned 10.10.0.2,10.10.0.3,10.10.0.4 claimed %v, want refused: the count matches, every address is assigned, and .4 was never claimed", repeat)
	}

	// A row that names an address twice is refused whatever the spoke claims with
	// it. Task 7's API validation rejects such a row before it can be saved, so this
	// is belt and braces — but this is the enforcement point, and a row that repeats
	// an address has no set to be equal to.
	dup := newSpokeAuthorizer("hub-duprow", map[string]string{"p1": "10.10.0.2,10.10.0.2"}, xlogger.Nop())
	if dup.Authorize(ctx, "p1", []net.IP{v4("10.10.0.2"), v4("10.10.0.2")}) {
		t.Error("a spoke whose row names 10.10.0.2 twice claimed it twice, want refused: the row is not a set")
	}
	if dup.Authorize(ctx, "p1", []net.IP{v4("10.10.0.2")}) {
		t.Error("a spoke whose row names 10.10.0.2 twice claimed it once, want refused: the counts differ")
	}

	// The repeat is also told apart from an address that belongs to a neighbour, so
	// an operator is not sent looking at the wrong problem.
	const hubID = "hub-repeat-two"
	event.Seed(hubID, nil) // isolate: the store is process-wide
	t.Cleanup(func() { event.Seed(hubID, nil) })

	two := newSpokeAuthorizer(hubID, map[string]string{"p1": "10.10.0.2,10.10.0.3"}, xlogger.Nop())
	if two.Authorize(ctx, "p1", []net.IP{v4("10.10.0.2"), v4("10.10.0.2")}) {
		t.Error("a spoke assigned 10.10.0.2,10.10.0.3 claimed 10.10.0.2 twice, want refused")
	}
	if two.Authorize(ctx, "p1", []net.IP{v4("10.10.0.2"), v4("10.10.0.9")}) {
		t.Error("a spoke assigned 10.10.0.2,10.10.0.3 claimed 10.10.0.9, want refused")
	}

	var reasons []string
	for _, ev := range event.List(hubID) {
		if ev.Level == event.LevelWarn {
			reasons = append(reasons, ev.Message)
		}
	}
	for _, want := range []string{"claimed 10.10.0.2 more than once", "claimed 10.10.0.9, which is not assigned to it"} {
		found := false
		for _, msg := range reasons {
			if strings.Contains(msg, want) {
				found = true
			}
		}
		if !found {
			t.Errorf("no refusal says %q; history: %v", want, reasons)
		}
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
