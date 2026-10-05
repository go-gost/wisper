# A tun hub allocates its spokes' addresses — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tun hub assigns each allowlisted spoke the one device address it may
claim, and refuses a registration that claims anything else.

**Architecture:** Two halves, in two repos, released in order. `x/handler/tun`
gains a `PeerAuthorizer` hook on `peerTable`, consulted in `onKeepalive` between
the self-loop guard and the auther; `NewP2PHandler` takes it in place of the
never-functional `auther`. wisper then builds a `spokeAuthorizer` over the hub's
own assignment map, allocates addresses into the peers page rows, and swaps the
assignment under the live handler on save. No `core/` change, no credential.

**Tech Stack:** Go 1.27, `github.com/go-gost/x` (pinned, separate module),
`net/netip`, `atomic.Pointer`, Lit + TypeScript (vite), yaml.

**Spec:** `docs/superpowers/specs/2026-10-03-tun-hub-ip-allocation-design.md` —
read it before starting; the plan argues from it and does not restate it.

## Global Constraints

- `go` is **not on `PATH`**. Every command below is preceded by
  `export PATH="$PATH:/root/.local/go/bin:/root/go/bin"`.
- **Verify locally with the go workspace first.** `/root/code/go-gost/go.work`
  lists all 18 modules including `./x` and `./wisper`, so `go build ./...` and
  `go test ./...` in `wisper` compile against the **local** `x`. That is the
  primary gate for every task here and needs no release: nothing has to be
  published to verify Tasks 1-2 or 4-9.
  `GOWORK=off` is therefore the *post-release* gate only — it is the only
  configuration that proves wisper's pin resolves against a published tag, and it
  is what wisper's own CI runs. Run it once, after x is released (Task 3), not
  per task.
- **x is released before wisper's pin moves** — but only because the pin has to
  resolve in CI, not because verification needs it. Under the workspace the
  release is not on the critical path for any other task.
- Next x version is **`v0.20.0`**: `NewP2PHandler`'s signature change is
  breaking, and 0.x minor is the breaking bump. Do not invent a different number
  — read it from `git tag --sort=-v:refname | head -1` and add one.
- **Never edit `core/`.** The hook is a new x-local interface.
- **Code comments in English only** (repo-wide convention).
- x gates: `go build ./... && go vet ./...` under the workspace, same as every other
  task. Add `GOWORK=off` only after the release.
- wisper gates: `CGO_ENABLED=1 go test -race -count=1 -p 1 ./<pkg>/...`. `-race`
  without `CGO_ENABLED=1` silently skips the detector. Wildcard `./...` hangs
  here; always name the package or pass `-p 1`.
- **Commit only when the user has authorized it.** This repo's rule
  (`[[no-auto-commit]]`) is that commits and pushes are separate decisions and
  neither happens unasked. The commit steps below are written out; run them when
  told, and report the diff instead when not.
- Addresses in a hub row are **host addresses, never prefixes**
  (`10.10.0.2`, not `10.10.0.2/24`) — `x/listener/tun/metadata.go:50` keeps
  `ParseCIDR`'s unmasked `ip`.

## Review Focus

Six input classes the spec implies, most likely to bite first. Each has a test
in the task named beside it.

| # | Input / condition | What a person expects | Pinned by |
|---|---|---|---|
| 1 | An IPv4 address, compared against a 16-byte claim | Equal. The claim always arrives as `ip.To16()`, so `10.10.0.2` and `::ffff:10.10.0.2` are the same peer. | Task 5 |
| 2 | A spoke with **two** `net` entries | Refused when the hub assigned it one. Exact set equality, not a subset test. | Task 1, Task 5 |
| 3 | `assignPeerIPs` runs **out** of addresses (a `/30` with 4, minus the hub's own) | Refused with a message naming the subnet. Never hands out the hub's own address, never wraps to `.0`. | Task 4 |
| 4 | A hub whose `net` is `10.10.0.1/24` — the prefix alone does not say which address is its own | The hub's own address is never allocated. `ParseCIDR` discards it, so `parseHubNets` returns it separately. | Task 4 |
| 5 | A hand-typed row, saved again after a **second** row was added | The typed address is byte-identical afterwards. Auto-assign only ever fills empty rows. | Task 4 |
| 6 | A **malformed** or **empty** claim reaching `Authorize` | Refused, never a panic. It is wire-reachable code. | Task 1, Task 5 |

---

## File Structure

| File | Responsibility |
|---|---|
| `x/handler/tun/authorizer.go` (new) | The `PeerAuthorizer` interface, and nothing else. |
| `x/handler/tun/router.go` | `peerTable.authorizer`, the `withAuthorizer` option, and the `Authorize` call in `onKeepalive`. |
| `x/handler/tun/p2phandler.go` | `NewP2PHandler`'s signature: `auther` out, `authorizer` in. |
| `wisper/tunnel/tunip.go` (new) | Address parsing, allocation, validation. Pure functions, no hub state. |
| `wisper/tunnel/tun_authorizer.go` (new) | `spokeAuthorizer`: the live-snapshot `PeerAuthorizer` plus the refusal event. |
| `wisper/tunnel/tunnel.go` | `Options.PeerIPs`, `PeerIPsOption`, `NormalizePeerIPs`, the `PeerIPSetter` interface. |
| `wisper/tunnel/tun.go` | Build and hold the authorizer; `SetPeerIPs`; drop the dead `Username`/`Password` wiring. |
| `wisper/api/tunnel_handler.go` | `peerJSON.IP`, validation, the ordered two-step save. |
| `wisper/web-src/src/pages/tunnel-peers-page.ts` | Per-row address field with an "auto" action. |
| `wisper/web-src/src/pages/entrypoint-detail-page.ts` | The hint that `net` must match the assignment. |

---

### Task 1: The authorizer hook on `peerTable`

**Files:**
- Create: `/root/code/go-gost/x/handler/tun/authorizer.go`
- Modify: `/root/code/go-gost/x/handler/tun/router.go` (struct at :26-38, `newPeerTable` at :52, `onKeepalive` at :67)
- Test: `/root/code/go-gost/x/handler/tun/router_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```go
  // package tun
  type PeerAuthorizer interface {
      Authorize(ctx context.Context, peer string, ips []net.IP) bool
  }

  // variadic option on newPeerTable
  func withAuthorizer(a PeerAuthorizer) peerTableOption
  ```

- [ ] **Step 1: Write the failing tests**

Add to `router_test.go`. `keepAliveFrame(passphrase, ips...)` and the recording
helpers already exist there.

```go
// A claim the peer is assigned is accepted; anything else is refused.
func TestAuthorizerAcceptsOnlyTheAssignedSet(t *testing.T)
func TestAuthorizerRefusesAPeerNotInTheTable(t *testing.T)
func TestAuthorizerRefusesAnEmptyClaim(t *testing.T)
// Review Focus #2: one assigned, two claimed.
func TestAuthorizerRefusesAClaimLargerThanTheAssignment(t *testing.T)
// Review Focus #6: wire-reachable, must not panic.
func TestAuthorizeRefusesAMalformedClaimWithoutPanicking(t *testing.T)
// The hook runs after the self-loop guard and before the auther.
func TestOnKeepaliveCallsTheAuthorizerBeforeTheAuther(t *testing.T)
// A nil authorizer refuses nothing — the socket path depends on this.
func TestNilAuthorizerRegistersEverything(t *testing.T)
```

`TestAuthorizeRefusesAMalformedClaimWithoutPanicking` calls
`Authorize(context.Background(), "peer", []net.IP{{1, 2, 3}})` and requires
`false` with no panic — a length an `IPNet` address can never have.

`TestOnKeepaliveCallsTheAuthorizerBeforeTheAuther` uses one authorizer and one
auther that each append to a shared slice, and requires the order
`["authorize", "authenticate"]`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/x && go test ./handler/tun/ -run 'Authoriz|NilAuthorizer|OnKeepaliveCalls' -count=1
```

Expected: compile failure — `undefined: withAuthorizer`.

- [ ] **Step 3: Add the interface**

Create `authorizer.go`:

```go
package tun

import (
    "context"
    "net"
)

// PeerAuthorizer decides whether the peer that sent a registration may claim the
// addresses in it.
//
// It exists because an auth.Authenticator cannot answer the question: onKeepalive
// passes the claimed address as the user name and the frame's key as the
// password, so an auther never learns which peer is claiming and cannot bind a
// claim to one. The peer key is already authenticated by the transport — a p2p
// hub's allowlist is what routed the stream here — so this is authorization, not
// authentication: it decides which addresses a known peer may hold.
//
// peer is the transport's name for the sender, verbatim: a "host:port" for a
// socket peer, a p2p peer key for a p2p one. ips is every address the frame
// claimed, and an implementation should require the whole set rather than a
// subset: peerTable.set is last-writer-wins per address, so a peer that also
// claims a neighbour's address takes that route over.
type PeerAuthorizer interface {
    Authorize(ctx context.Context, peer string, ips []net.IP) bool
}
```

- [ ] **Step 4: Wire it into the table**

In `router.go`:

1. Add `authorizer PeerAuthorizer` to the `peerTable` struct, after `auther`.
2. Change the constructor to take a variadic option:

   ```go
   type peerTableOption func(*peerTable)

   func withAuthorizer(a PeerAuthorizer) peerTableOption {
       return func(pt *peerTable) { pt.authorizer = a }
   }

   func newPeerTable(auther auth.Authenticator, keepAlivePeriod time.Duration, service string, log logger.Logger, opts ...peerTableOption) *peerTable {
       pt := &peerTable{auther: auther, ttl: keepAlivePeriod, service: service, log: log}
       for _, opt := range opts {
           opt(pt)
       }
       return pt
   }
   ```

   Variadic, not a parameter: `newPeerTable` has **21 call sites** in this
   package's tests and every one of them means "no address authorization", which
   a `nil` argument would say equally well.
3. In `onKeepalive`, after the self-loop guard block and **before** the auther
   block:

   ```go
   if pt.authorizer != nil && !pt.authorizer.Authorize(ctx, from, peerIPs) {
       pt.debugf("keepalive from %v => %v, not authorized", from, peerIPs)
       return nil, false
   }
   ```

   Order is deliberate: a claim that is not this peer's to make needs no
   credential check, and the auther below may be a plugin making an RPC to
   another process.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/x && go test ./handler/tun/ -count=1
```

Expected: all pass. The pre-existing 21-call-site suite must be untouched.

- [ ] **Step 6: Gate x**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/x && go build ./... && go vet ./...
cd /root/code/go-gost/x && CGO_ENABLED=1 go test -race -count=1 -p 1 ./handler/tun/
```

Expected: clean.

- [ ] **Step 7: Commit** (when authorized)

```bash
cd /root/code/go-gost/x
git add handler/tun/authorizer.go handler/tun/router.go handler/tun/router_test.go
git commit -m "feat(tun): let a hub decide which addresses a peer may claim"
```

---

### Task 2: `NewP2PHandler` takes the authorizer

**Files:**
- Modify: `/root/code/go-gost/x/handler/tun/p2phandler.go` (signature at :46, table at :60)
- Test: `/root/code/go-gost/x/handler/tun/p2p_test.go`

**Interfaces:**
- Consumes: `PeerAuthorizer` from Task 1.
- Produces: `func NewP2PHandler(device net.Conn, authorizer PeerAuthorizer, opts ...handler.Option) handler.Handler`

- [ ] **Step 1: Write the failing tests**

In `p2p_test.go`, next to the existing keepalive tests:

```go
// End to end through Handle: an authorized claim registers its address, and the
// stream is not answered when the authorizer refuses.
func TestP2PHandleRegistersAnAuthorizedClaim(t *testing.T)
func TestP2PHandleDoesNotRegisterARefusedClaim(t *testing.T)
```

Both drive a real `p2pHandler` over the existing `newDatagramPipe`/`compatSpoke`
helpers. The refused case asserts the route table is empty **and** no keepalive
reply was written to the peer end.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/x && go test ./handler/tun/ -run TestP2PHandle -count=1
```

Expected: FAIL — the constructor takes an `auth.Authenticator` and the stub
passed is not one.

- [ ] **Step 3: Replace the parameter**

In `p2phandler.go`, change the signature and the table construction:

```go
func NewP2PHandler(device net.Conn, authorizer PeerAuthorizer, opts ...handler.Option) handler.Handler {
```

```go
table := newPeerTable(nil, 0, options.Service, log, withAuthorizer(authorizer))
```

`auther` becomes `nil` — a p2p hub's identity is the peer allowlist, and the
socket deployment keeps `handler.AutherOption` on `tunHandler` untouched. Update
the doc comment above the constructor to say the authorizer decides which
addresses a peer's registration may claim and may be nil.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/x && go test ./handler/tun/ -count=1
```

Expected: all pass.

- [ ] **Step 5: Gate x**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/x && go build ./... && go vet ./...
cd /root/code/go-gost/x && CGO_ENABLED=1 go test -race -count=1 -p 1 ./handler/tun/
```

- [ ] **Step 6: Commit** (when authorized)

```bash
cd /root/code/go-gost/x
git add handler/tun/p2phandler.go handler/tun/p2p_test.go
git commit -m "feat(tun): the p2p hub authorizes addresses instead of credentials"
```

---

### Task 3: Release x, then move wisper's pin

**Files:**
- Modify: `/root/code/go-gost/wisper/go.mod`, `/root/code/go-gost/wisper/go.sum`

**Interfaces:**
- Consumes: the `NewP2PHandler` signature from Task 2. **wisper does not compile
  until this task lands** — `tunnel/tun.go` still passes an `auth.Authenticator`.
- Produces: `github.com/go-gost/x v0.20.0` in wisper's `go.mod`.

- [ ] **Step 1: Confirm the next version number from the tags**

```bash
cd /root/code/go-gost/x && git tag --sort=-v:refname | head -3
```

The next tag is `v0.20.0` (breaking change, 0.x semantics). If the output does
not end at `v0.19.5`, recompute before tagging — do not assume.

- [ ] **Step 2: Push x's commits, then tag and push the tag**

```bash
cd /root/code/go-gost/x
git push origin master
git tag v0.20.0 && git push origin v0.20.0
```

**The tag must exist on the remote before Step 3.** wisper's CI checks out its
own module alone, so a pin to an unpushed tag fails there and nowhere here.

- [ ] **Step 3: Bump the pin**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/wisper && go get github.com/go-gost/x@v0.20.0
```

- [ ] **Step 4: Confirm the workspace-off build reaches the expected failure**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/wisper && GOWORK=off go build ./... 2>&1 | head -20
```

Expected: exactly two errors, both the same cause — `tunnel/tun.go:265` passing an
`auth.Authenticator` where a `tunhandler.PeerAuthorizer` is now wanted, and the
same call at `:271`. Any *other* error means something in x is broken; fix that
before continuing.

- [ ] **Step 5: Commit** (when authorized)

```bash
cd /root/code/go-gost/wisper
git add go.mod go.sum
git commit -m "build: require go-gost/x v0.20.0 for the hub's address authorizer"
```

---

### Task 4: Address parsing and allocation

**Files:**
- Create: `/root/code/go-gost/wisper/tunnel/tunip.go`
- Test: `/root/code/go-gost/wisper/tunnel/tunip_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces, all pure functions:
  ```go
  // parseHubNets reads the hub's own `net` field ("10.10.0.1/24,fd00::1/64").
  // It returns the prefixes **and the hub's own addresses**, because
  // ParseCIDR("10.10.0.1/24") discards the host part: a caller that wants to
  // avoid handing out the hub's own address cannot recover it from the prefix
  // alone. An entry that does not parse is skipped.
  func parseHubNets(netSpec string) (prefixes []netip.Prefix, self []netip.Addr)

  // parsePeerIPs reads one row's comma-separated host-address list.
  // Returns ok=false if any entry is not a bare address (a prefix, a hostname,
  // an empty element between commas).
  func parsePeerIPs(spec string) ([]netip.Addr, bool)

  // validatePeerIP reports why an address cannot be assigned: not an address, or
  // outside every hub prefix. err is nil when it is fine.
  func validatePeerIP(host string, prefixes []netip.Prefix) error

  // assignPeerIPs fills the empty rows of assigned, in order, with the next free
  // host address from the first usable hub prefix. Rows that already have a
  // value are never touched, and self — the hub's own addresses — is never
  // handed out. Returns the merged map, and an error when a subnet is exhausted
  // or the hub has no net at all.
  func assignPeerIPs(order []string, assigned map[string]string, prefixes []netip.Prefix, self []netip.Addr) (map[string]string, error)
  ```

- [ ] **Step 1: Write the failing tests**

```go
func TestParseHubNets(t *testing.T)               // "10.10.0.1/24,fd00::1/64" → 2 prefixes AND 2 self addresses; garbage skipped
func TestParsePeerIPs(t *testing.T)               // "10.10.0.2,fd00::2" → 2 addrs; "10.10.0.2/24" → !ok
func TestValidatePeerIP(t *testing.T)             // outside every prefix → error naming it
// The prefix alone cannot say which address is the hub's own.
func TestParseHubNetsKeepsTheHubOwnAddress(t *testing.T)
func TestAssignPeerIPsSkipsTheHubsOwnAddress(t *testing.T)
func TestAssignPeerIPsNeverOverwritesATypedRow(t *testing.T)   // Review Focus #5
func TestAssignPeerIPsRefusesAnExhaustedSubnet(t *testing.T)   // Review Focus #3
func TestAssignPeerIPsRefusesAHubWithNoNet(t *testing.T)
func TestAssignPeerIPsAcceptsMultipleTypedAddressesInOneRow(t *testing.T)
```

Review Focus #3, concretely: hub `net` `10.10.0.1/30` (addresses `.0`–`.3`,
of which `.1` is the hub) with four rows. After the hub's own address and
`.0`, the allocator has `.2` and `.3` for four rows and must return an error
naming `10.10.0.0/30` — not hand out `.0`, not wrap, not duplicate.

Review Focus #5, concretely: `assigned = {a: "10.10.0.9"}`, order `[a, b]` →
result `{a: "10.10.0.9", b: <free>}`, with `a`'s value byte-identical.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/wisper && go test ./tunnel/ -run 'HubNets|PeerIP|AssignPeerIPs' -count=1
```

Expected: compile failure — `undefined: parseHubNets`.

- [ ] **Step 3: Implement `tunip.go`**

All four functions, with no hub state and no logging — the caller reports.

`parseHubNets` returns **both** halves because `ParseCIDR` keeps only one:
`net.ParseCIDR("10.10.0.1/24")` yields the prefix `10.10.0.0/24` and throws the
hub's own address away. An allocator that only had the prefix would hand
`10.10.0.1` to the first spoke, and the hub's self-loop guard would then refuse
that spoke's registration at runtime with a message that points nowhere near the
cause.

`assignPeerIPs` decides "free" by collecting every address already named by any
row (typed or previously assigned) plus `self`, then walking the first usable
prefix from `.1` upward — not from `Prefix.Masked().Addr()`, which for
`10.10.0.1/24` is `10.10.0.0`. Skip the network address and the broadcast address
of a prefix smaller than `/30`, and skip `self`. Iterate `order` so allocation is
deterministic and matches the rows' display order.

A prefix larger than `/30` has no broadcast address to skip; a `/31` or `/32`
has neither a network nor broadcast address to skip. Handle each with a named
predicate rather than a magic constant, so the rule is legible.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/wisper && CGO_ENABLED=1 go test -race -count=1 ./tunnel/ -run 'HubNets|PeerIP|AssignPeerIPs'
```

- [ ] **Step 5: Run the whole package, then commit** (when authorized)

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/wisper && CGO_ENABLED=1 go test -race -count=1 -p 1 ./tunnel/
cd /root/code/go-gost/wisper && git add tunnel/tunip.go tunnel/tunip_test.go
git commit -m "feat(tun): parse and allocate a hub's spoke addresses"
```

---

### Task 5: `spokeAuthorizer`

**Files:**
- Create: `/root/code/go-gost/wisper/tunnel/tun_authorizer.go`
- Test: `/root/code/go-gost/wisper/tunnel/tun_authorizer_test.go`

**Interfaces:**
- Consumes: `parsePeerIPs` from Task 4; `x/handler/tun.PeerAuthorizer` for the
  structural assertion in Step 1.
- Produces:
  ```go
  type spokeAuthorizer struct { /* unexported */ }

  func newSpokeAuthorizer(hubID string, assigned map[string]string, log logger.Logger) *spokeAuthorizer
  func (a *spokeAuthorizer) set(assigned map[string]string)
  func (a *spokeAuthorizer) Authorize(ctx context.Context, peer string, ips []net.IP) bool
  ```

- [ ] **Step 1: Write the failing tests**

```go
// Review Focus #1 — the claim is always 16 bytes; a stored IPv4 address is 4.
func TestAuthorizeMatchesAnIPv4ClaimAgainstAnIPv4Assignment(t *testing.T)
func TestAuthorizeMatchesTwoAddressesAsASet(t *testing.T)
func TestAuthorizeRefusesASupersetClaim(t *testing.T)       // Review Focus #2
func TestAuthorizeRefusesAnUnknownPeer(t *testing.T)
func TestAuthorizeRefusesWhenTheRowIsEmpty(t *testing.T)    // empty row = nothing claimable
func TestAuthorizeRefusesAMalformedClaim(t *testing.T)      // Review Focus #6
// The refusal is visible: a warn event lands on the hub.
func TestAuthorizeRecordsAWarnEvent(t *testing.T)
// The assignment is behind a pointer, so a live handler sees a swap.
func TestAuthorizeSeesAnAssignmentSwappedUnderIt(t *testing.T)
// Structural, not behavioural: this is the assertion that lets wisper satisfy
// x's hook without importing an interface it does not control.
func TestSpokeAuthorizerSatisfiesPeerAuthorizer(t *testing.T)
```

`TestAuthorizeMatchesAnIPv4ClaimAgainstAnIPv4Assignment`: assign
`"10.10.0.2"`, claim `net.ParseIP("10.10.0.2").To16()` (16 bytes) → true. Also
assert the `::ffff:10.10.0.2` spelling is accepted, since that is what
`net.IP.String()` of a 16-byte IPv4-mapped value produces.

Compare on `netip.Addr` after `netip.AddrFromSlice`, canonicalized with
`.Unmap()` — that is what makes both spellings one address.

`TestAuthorizeRecordsAWarnEvent` seeds `event` with `event.Seed(hubID, nil)`
and requires exactly one `event.LevelWarn` entry mentioning the peer key and
both addresses.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/wisper && go test ./tunnel/ -run 'Authorize' -count=1
```

Expected: compile failure — `undefined: newSpokeAuthorizer`.

- [ ] **Step 3: Implement `tun_authorizer.go`**

```go
// spokeAuthorizer authorizes a spoke's registration against the hub's current
// assignment. The assignment is behind an atomic pointer because the handler
// takes its authorizer by value at Run, and a save must take effect without
// re-creating the tun device — which needs the privilege the hub was started
// with.
type spokeAuthorizer struct {
    hubID    string
    log      logger.Logger
    assigned atomic.Pointer[map[string][]netip.Addr]
}
```

`newSpokeAuthorizer` parses each row once, dropping rows that do not parse, and
stores the map. `set` re-parses and stores.

`Authorize`:

1. `addrs, ok := a.assigned.Load()`; nil → refuse.
2. `want, ok := (*addrs)[peer]`; !ok → refuse.
3. Compare `len(want) == len(ips)`, then each `netip.Addr` pairwise after
   `Unmap()`. Refuse on any mismatch, including a length mismatch — a subset
   would let a peer that knows a neighbour's address take that route too, and
   `peerTable.set` is last-writer-wins.
4. On refusal: `log.Warnf` and `event.Record(a.hubID, event.LevelWarn, ...)`, both
   naming the peer, what it claimed and what it was assigned; return false.

The reporting lives here rather than in the hub's peer-route loop because that
loop accepts a stream and never parses a frame — it cannot know what was
claimed. This is a map read and a slice compare, so it cannot block the way a
plugin auther's external call could.

Add the structural assertion that lets wisper satisfy the hook by shape rather
than by importing an interface it does not control:

```go
var _ tunhandler.PeerAuthorizer = (*spokeAuthorizer)(nil)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/wisper && CGO_ENABLED=1 go test -race -count=1 ./tunnel/ -run 'Authorize'
```

- [ ] **Step 5: Commit** (when authorized)

```bash
cd /root/code/go-gost/wisper
git add tunnel/tun_authorizer.go tunnel/tun_authorizer_test.go
git commit -m "feat(tun): authorize a spoke's claim against the hub's assignment"
```

---

### Task 6: Config, options, and the hub's own wiring

**Files:**
- Modify: `/root/code/go-gost/wisper/config/config.go` (the `Tunnel` struct, near `PeerDisabled`)
- Modify: `/root/code/go-gost/wisper/tunnel/tunnel.go` (`Options` near `PeerDisabled`; the option block; `PeerSetter` lives in `p2p.go`)
- Modify: `/root/code/go-gost/wisper/tunnel/tun.go` (the auther block at :263-266; `NewP2PHandler` call at :271; add `SetPeerIPs`; add the field)
- Test: `/root/code/go-gost/wisper/tunnel/tun_test.go`

**Interfaces:**
- Consumes: `newSpokeAuthorizer` from Task 5, `assignPeerIPs`/`parseHubNets` from
  Task 4, `x/handler/tun.NewP2PHandler`'s new signature from Task 2.
- Produces:
  ```go
  // tunnel
  Options.PeerIPs map[string]string     // peer key → comma-separated host addresses
  func PeerIPsOption(peerIPs map[string]string) Option
  func NormalizePeerIPs(peers []string, known map[string]string) map[string]string

  // PeerIPSetter is implemented by a tunnel that allocates device addresses to
  // its peers. A p2p tunnel does not: it has no device network to allocate from.
  type PeerIPSetter interface {
      SetPeerIPs(ctx context.Context, peerIPs map[string]string) error
  }
  ```
  and `var _ PeerIPSetter = (*tunTunnel)(nil)`.

- [ ] **Step 1: Write the failing tests**

In `tun_test.go`:

```go
// The dead auther is gone: a hub's admission is the allowlist plus its own
// assignment, and Username/Password are read by nothing here.
func TestTunHubIgnoresUsernamePassword(t *testing.T)
// Rows with no address get one from the hub's subnet; a typed row keeps it.
func TestTunHubAllocatesPeerAddresses(t *testing.T)
// Save-time allocation is idempotent — a second save changes nothing.
func TestTunHubAllocationIsStableAcrossSaves(t *testing.T)
func TestTunHubRejectsAnAddressOutsideItsSubnet(t *testing.T)
func TestNormalizePeerIPsDropsRemovedKeys(t *testing.T)
```

`TestTunHubIgnoresUsernamePassword` builds a hub with `Username`/`Password` set
and asserts its behavior is identical to one without — it cannot assert the
auther is nil directly, so assert the observable: a spoke claiming an assigned
address is registered either way.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/wisper && go test ./tunnel/ -run 'TunHub|NormalizePeerIPs' -count=1
```

Expected: FAIL — `SetPeerIPs`/`NormalizePeerIPs` undefined, and the package
still does not compile against x v0.20.0.

- [ ] **Step 3: Config and options**

`config/config.go`, on `Tunnel`:

```go
// PeerIPs is a tun hub's address assignment: peer key → the comma-separated
// host addresses that peer may claim. Empty means the hub allocates nothing and
// every registration is refused.
PeerIPs map[string]string `yaml:"peer_ips,omitempty" json:"peer_ips,omitempty"`
```

`tunnel/tunnel.go`: the same field on `Options`, plus `PeerIPsOption`, plus
`NormalizePeerIPs(peers, known)` modelled on `NormalizePeerDisabled` — keep only
keys still listed, nil when nothing is left.

`tunnel/p2p.go`, beside `PeerSetter`: the `PeerIPSetter` interface from the
Interfaces block.

- [ ] **Step 4: Wire the hub**

In `tun.go`:

1. Replace the block at :263-266 — `var auther auth.Authenticator; if s.opts.Username != "" {...}` — with the authorizer:

   ```go
   authz := newSpokeAuthorizer(s.opts.ID, s.opts.PeerIPs, log)
   ```

   `s.opts.ID` is the hub's id, which is what `event.Record` takes. Delete the
   `xauth` and `auth` imports if nothing else in the file uses them.
2. `tunhandler.NewP2PHandler(deviceConn, authz, ...)`.
3. Add the field `authz *spokeAuthorizer` to `tunTunnel`, and publish it under
   the existing `s.mu` where `s.ln, s.device` are set.
4. Add `SetPeerIPs`:

   ```go
   // SetPeerIPs replaces the hub's address assignment. ctx is accepted for the
   // same reason SetPeers takes one — a save may be named in a log line — and is
   // not otherwise used here.
   func (s *tunTunnel) SetPeerIPs(ctx context.Context, peerIPs map[string]string) error {
       if s.IsClosed() {
           return ErrTunnelClosed
       }
       s.mu.RLock()
       authz := s.authz
       s.mu.RUnlock()
       if authz == nil {
           return errors.New("tun hub is not running")
       }
       s.mu.Lock()
       s.opts.PeerIPs = peerIPs
       s.mu.Unlock()
       authz.set(peerIPs)
       return nil
   }
   ```

- [ ] **Step 5: Run the tests, then gate wisper**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/wisper && CGO_ENABLED=1 go test -race -count=1 -p 1 ./tunnel/ ./config/
cd /root/code/go-gost/wisper && go build ./... && go vet ./...
```

Expected: the `tunnel` and `config` packages pass, and the **workspace-off** build
is clean — that is what proves the pin resolves against the published tag.

- [ ] **Step 6: Commit** (when authorized)

```bash
cd /root/code/go-gost/wisper
git add config/config.go tunnel/tunnel.go tunnel/p2p.go tunnel/tun.go tunnel/tun_test.go
git commit -m "feat(tun): a hub allocates its spokes' addresses from its own subnet"
```

---

### Task 7: The REST surface

**Files:**
- Modify: `/root/code/go-gost/wisper/api/tunnel_handler.go` (`peerJSON` at :68, `peersJSON` at :119, `tunnelOptionsResp` at :77, `handleUpdateTunnelPeers` at :727, `tunnelCreateRequest.toOptions` at :308)
- Test: `/root/code/go-gost/wisper/api/api_test.go`

**Interfaces:**
- Consumes: `Options.PeerIPs` + `PeerIPsOption` + `NormalizePeerIPs` +
  `PeerIPSetter` from Task 6; `assignPeerIPs`/`validatePeerIP`/`parsePeerIPs`
  from Task 4.
- Produces: `peerJSON.IP string \`json:"ip,omitempty"\`` — an inbound and
  outbound field. Also `tunnelOptionsResp.PeerIPs`.

- [ ] **Step 1: Write the failing tests**

```go
// A row round trips its address out to the UI and back in.
func TestUpdateTunnelPeersCarriesTheAddress(t *testing.T)
// An address outside the hub's subnet is refused, naming the peer.
func TestUpdateTunnelPeersRejectsAnOutOfSubnetAddress(t *testing.T)
// A prefix where an address belongs is refused — rows hold host addresses.
func TestUpdateTunnelPeersRejectsAPrefix(t *testing.T)
// Two rows may not name the same address.
func TestUpdateTunnelPeersRejectsADuplicateAddress(t *testing.T)
// An empty row is allocated, not stored empty.
func TestUpdateTunnelPeersAllocatesAnEmptyAddress(t *testing.T)
// A tun hub with no net has nothing to allocate from: every row must be typed.
func TestUpdateTunnelPeersRefusesAllocationWithoutANet(t *testing.T)
// A p2p tunnel's peers are untouched by any of this.
func TestUpdateP2PTunnelPeersIgnoresAddresses(t *testing.T)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/wisper && go test ./api/ -run 'UpdateTunnelPeers|UpdateP2PTunnelPeers' -count=1
```

Expected: FAIL — `peerJSON` has no `IP` field.

- [ ] **Step 3: Add the field**

```go
type peerJSON struct {
    Key   string `json:"key"`
    Alias string `json:"alias,omitempty"`
    Disabled bool `json:"disabled,omitempty"`
    // IP is the address this peer may claim on the hub's device network: a
    // comma-separated list of host addresses, never a prefix. Empty means the
    // hub allocates one. A p2p tunnel ignores it — it has no device network.
    IP string `json:"ip,omitempty"`
}
```

Thread it through `peersJSON` (which gains a `peerIPs map[string]string`
parameter and passes `IP: peerIPs[k]`), `tunnelOptionsResp.PeerIPs`, and
`tunnelCreateRequest`.

- [ ] **Step 4: Validate and allocate in the handler**

In `handleUpdateTunnelPeers`, after the existing key and duplicate-key checks:

1. Collect `ip[peerKey] = strings.TrimSpace(p.IP)`.
2. If the tunnel is a tun hub: run
   `prefixes, self := parseHubNets(opts.Net)` then
   `assignPeerIPs(peers, ip, prefixes, self)`, and write each error back as a
   400 naming the peer or the subnet. Skip this entirely for a p2p tunnel.
3. Reject any row whose value does not parse as host addresses, and any address
   repeated across two rows — both as 400s that name the peer, because "invalid
   request" with a bare message is what a user cannot act on.

- [ ] **Step 5: The ordered two-step save**

This is the load-bearing order. Replace the single call at :777 with:

```go
// Order is load-bearing. SetPeers reconciles the p2p routes and can fail; on
// failure it has changed nothing, so the assignment is still the old one and
// the pair stays consistent. SetPeerIPs only swaps a pointer and cannot fail.
// Running them the other way round would leave a peer holding a route whose
// assignment had just been withdrawn — a black hole with nothing to show for it.
if err := setter.SetPeers(r.Context(), peers, aliases, disabled); err != nil {
    writeError(w, http.StatusConflict, err.Error())
    return
}
if s, ok := old.(tunnel.PeerIPSetter); ok {
    if err := s.SetPeerIPs(r.Context(), ip); err != nil {
        writeError(w, http.StatusInternalServerError, err.Error())
        return
    }
}
```

- [ ] **Step 6: Run the tests, then gate**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/wisper && CGO_ENABLED=1 go test -race -count=1 -p 1 ./api/
cd /root/code/go-gost/wisper && go build ./... && go vet ./...
```

- [ ] **Step 7: Commit** (when authorized)

```bash
cd /root/code/go-gost/wisper
git add api/tunnel_handler.go api/api_test.go
git commit -m "api: a hub's peers carry the address each may claim"
```

---

### Task 8: The peers page and the spoke's hint

**Files:**
- Modify: `/root/code/go-gost/wisper/web-src/src/pages/tunnel-peers-page.ts` (`PeerRow` at :17, `_renderEditor` at :233, `_save` at :193)
- Modify: `/root/code/go-gost/wisper/web-src/src/pages/entrypoint-detail-page.ts` (the tun hint near `t('tunPeerHint')`, ~line 922)
- Modify: `/root/code/go-gost/wisper/web-src/src/i18n/en.ts`, `zh.ts`

**Interfaces:**
- Consumes: `peerJSON.ip` from Task 7.
- Produces: i18n keys `peersIPPlaceholder`, `peersIPHint`, `peersIPAuto`,
  `tunNetMatchesHub`.

- [ ] **Step 1: Extend `PeerRow` and the editor**

```ts
type PeerRow = {
  key: string;
  alias: string;
  disabled: boolean;
  ip: string;
};
```

`_rowFrom(p)` sets `ip: p.ip ?? ''`; `_save` sends
`{ key: r.key, alias: r.alias || undefined, disabled: r.disabled || undefined, ip: r.ip.trim() || undefined }`;
`_draft` initialised with `ip: ''`.

In `_renderEditor`, add one `form-input` bound to `_draft.ip` with
`placeholder=${t('peersIPPlaceholder')}`, placed under the key input. Leave it
empty-accepting — the server allocates — and put the explanation in
`${t('peersIPHint')}` beneath it.

- [ ] **Step 2: The i18n strings**

`en.ts`:

```
peersIPPlaceholder: 'e.g. 10.10.0.2',
peersIPHint: 'The address this spoke may use on the hub\'s network. Leave empty and the hub assigns one from its own subnet; a spoke must be configured with the same address.',
tunNetMatchesHub: 'This must be the address the hub assigned to this peer — copy it from the hub\'s peers page.',
```

`zh.ts`:

```
peersIPPlaceholder: '例如 10.10.0.2',
peersIPHint: '该 spoke 在 hub 网络上可用的地址。留空则由 hub 从自己的网段分配；spoke 侧必须配置成同一个地址。',
tunNetMatchesHub: '这里必须填 hub 分配给该 peer 的地址，从 hub 的 peers 页复制。',
```

Every key added to `en.ts` goes into `zh.ts` in the same position — the two
files are kept in step by hand and a missing key renders as the raw string.

- [ ] **Step 3: The spoke's hint**

In `entrypoint-detail-page.ts`, inside the existing block that renders
`t('tunPrivilegeHint')` and `t('tunPeerHint')` for `entrypointType === 'tun'`,
add `<div class="p2p-hint">${t('tunNetMatchesHub')}</div>` after them. No new
field: the spoke already has `net`, and the operator is copying into it.

- [ ] **Step 4: Build the web bundle**

```bash
cd /root/code/go-gost/wisper && make web
```

Expected: `web/` rebuilt. **Never run `npx vite build` directly** — the Makefile
owns the stamp and the cleanup.

- [ ] **Step 5: Typecheck and build the binary**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/wisper && make web && go build -o /tmp/wisper-check .
```

Expected: both clean. `npx tsc --noEmit` in `web-src/` if the package script
exists.

- [ ] **Step 6: Commit** (when authorized)

```bash
cd /root/code/go-gost/wisper
git add web-src/src/pages/tunnel-peers-page.ts web-src/src/pages/entrypoint-detail-page.ts web-src/src/i18n/en.ts web-src/src/i18n/zh.ts web/
git commit -m "web: a hub's peers page assigns each spoke its address"
```

---

### Task 9: The docs that are now wrong

**Files:**
- Modify: `/root/code/go-gost/wisper/docs/tun-integration.md`
- Modify: `/root/code/go-gost/wisper/CONTEXT.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Correct `docs/tun-integration.md`**

The status block (lines 14-20) recommends that a hub's admission be carried by
the tun server's auther, with `username` = the spoke's tun IP and `password` =
that spoke's token. That is superseded. Replace it with the hub's address
assignment, and note that `username`/`password` on a tun hub are no longer read.

- [ ] **Step 2: Add the vocabulary to `CONTEXT.md`**

Under **Routes**, add an entry for **address assignment** in the file's existing
voice, distinguishing it from `registration handshake` (which declares) and from
the allowlist (which admits):

> **address assignment** — what a hub has granted one peer the right to claim:
> the host addresses that peer's registration may carry. The peer still declares
> them; the assignment is what makes the declaration true or false. Distinct from
> the allowlist, which admits a peer at all, and from the handshake, which only
> reports.

- [ ] **Step 3: Verify the whole tree once**

```bash
export PATH="$PATH:/root/.local/go/bin:/root/go/bin"
cd /root/code/go-gost/x && go build ./... && go vet ./...
cd /root/code/go-gost/wisper && go build ./... && go vet ./...
cd /root/code/go-gost/wisper && CGO_ENABLED=1 go test -race -count=1 -p 1 ./...
```

Expected: all pass with the workspace **off**, which is the only configuration
that proves the published x tag resolves.

- [ ] **Step 4: Commit** (when authorized)

```bash
cd /root/code/go-gost/wisper
git add docs/tun-integration.md CONTEXT.md
git commit -m "docs: a hub assigns its spokes' addresses"
```

---

## Self-review

**Spec coverage.** Problem → Tasks 4-6. *Identity vs authorization* → Task 1's
interface doc. *Why not the auther* → Task 1, and the `core/` constraint in
Global Constraints. *Shape / ordering* → Task 1 Step 4. *Exact set* → Task 1
Step 1 + Task 5 Step 1 (Review Focus #2). *Host addresses not prefixes* → Task 4
Step 1 and Global Constraints. *Allocation* → Task 4, surfaced in Task 7 Step 4.
*Mismatch is an event* → Task 5 Step 3. *Live updates and the one-shot
handshake* → Task 5's `atomic.Pointer` and Task 6's `SetPeerIPs`; the "stop and
start the entrypoint" instruction belongs in the peers-page copy, which Task 8's
`peersIPHint` carries. *Saving, in a fixed order* → Task 7 Step 5. *Replacing the
dead username/password* → Task 6 Step 4. *Normalization* → Task 6 Step 3. *Tests*
→ each task's Step 1. *Not doing* → respected throughout; nothing in the plan
adds a credential, a lease, a wire push, or a `core/` edit.

**Type consistency.** `PeerAuthorizer` is defined once (Task 1) and consumed by
Tasks 2, 5, 6. `newSpokeAuthorizer(hubID, assigned, log)` (Task 5) matches its
use in Task 6 Step 4 and its tests in Task 5. `assignPeerIPs(order, assigned,
prefixes, self) (map[string]string, error)` (Task 4) is called with that
argument order in Task 7 Step 4. `PeerIPSetter.SetPeerIPs(ctx,
map[string]string) error` (Task 6) matches Task 7's type assertion.
`peerJSON.IP` (Task 7) matches Task 8's `ip`.

**Gaps I closed while writing.** The spec says a save "does not reach an already
registered spoke" but does not say where the user is told; that is now
`peersIPHint`. The spec names `validatePeerIP` but never had a caller — Task 7
Step 4 is it. `tunnelCreateRequest` was in the spec's touchpoint list with no
stated shape; Task 7 Step 3 gives it `PeerIPs` alongside the peers.

**Not covered, deliberately.** A privileged two-device run — a real hub, a real
spoke, a real tun device — cannot be done in this environment (userns is
blocked). The unit tests prove the rule, not the network. That gap is recorded
rather than papered over.

**Verification, corrected 2026-10-03.** This plan originally made every task gate
on `GOWORK=off`, which put x's release on the critical path and left wisper
deliberately uncompilable in between. That was wrong for local work: the go
workspace supplies the local `x`, so plain `go build ./...` / `go test ./...` is
the real per-task gate and `GOWORK=off` belongs only after the release. Task 3
Step 4's two-expected-errors assertion holds **only** under `GOWORK=off` against
the published tag; under the workspace wisper has no error to show.