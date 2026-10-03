# tun hub over p2p, in-process — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A p2p-reached tun hub routes its spokes' datagrams to and from the device with no local UDP socket, so a hub no longer needs a bind address a paired p2p tunnel must repeat.

**Architecture:** The routing and authentication in `x/handler/tun` — keepalive magic-header parsing, the auther check, the route table with TTL expiry, destination lookup — is extracted into a `peerTable` type that knows nothing about transport. A route's value becomes a `string` (a name): the socket server resolves it to an address and delivers with `WriteTo`; the p2p hub resolves it to a peer connection and delivers on that. Both are complete routers. p2p is not modified — its `register` seam already delivers one `net.PacketConn` per peer stream.

**Tech Stack:** Go, `github.com/go-gost/x` (handler/listener), `github.com/go-gost/wisper`, Lit/TypeScript UI, `songgao/water`, `golang.org/x/net/ipv4|ipv6`.

**Spec:** `docs/superpowers/specs/2026-10-02-tun-hub-p2p-in-process-design.md` (wisper repo, commit `f7d99c7`).

---

## Two repos, two commits, one order

`x/` is a separate git repo and wisper pins a published `x` tag, so:

1. All `x/` work lands and is **tagged and pushed first**.
2. wisper's `go.mod` pin is bumped to that tag, verified with `GOWORK=off` (wisper's release gate), then committed.

Do not commit wisper's `go.mod` bump before the tag exists — CI checks out the module alone and a pin to an unpublished tag fails at test.

## Execution log

Implementation is running under subagent-driven development. **This section is the
record of what actually happened, which is not always what the task below said.**

### Done

**Task 1 — `peerTable` extracted.** `x` commit `70b5269` (two files, additive; `server.go` untouched).
`peerTable` owns the keepalive protocol, the auther check, the route table with TTL, and destination
lookup. A route's value is a `string`. 16 tests / 27 with subtests.

Two findings that survived review and changed the code:

- `auth.WithService` was dropped in the first cut. `auth/plugin/grpc.go:64` puts `options.Service`
  on the gRPC wire, so an external plugin auther would have received `""`. `peerTable` carries the
  service name now; `TestTransportRouterAuthenticatesWithService` pins it.
- Four tests passed while proving something other than what they claimed. Each was found by
  mutation — deleting or changing the guard and watching the test stay green:
  - the TTL test did not pin the `3×` factor (`3×→1×` passed)
  - the ownNets self-loop test was **vacuous**: the auther refused the frame before the guard ran,
    so disabling the guard left it green
  - **the multi-address path had no coverage at all** — and it is the *common* path, since
    `client.go:31-34` sends every address in `config.Net`. Mutating "authenticate only
    `peerIPs[0]`" stayed green, leaving the "never half-trust a registration" invariant untested

**Task 2 — socket server moved onto `peerTable`.** `x` commit `64b1493` (`server.go` −102/+78,
`handler.go`, plus the concurrency fix below).

The baseline is weaker than it looks and the implementer said so unprompted: **no test in this
package exercises `server.go`**. They target `peerTable` and `selectTarget` directly. So "existing
tests pass unchanged" is not evidence about the socket path — the line-by-line behavioral diff is.
Reported differences, both accepted as improvements:

- a route is now registered *before* the keepalive reply rather than after (only observable if the
  reply write fails, where the peer is gone anyway)
- the own-network refusal gains one Debug line

Everything else is reported byte-identical: reply bytes and both warn paths, expiry arithmetic
(`3×`, the `ttl > 0` guard, `CompareAndDelete`, the same Infof), gateway fallback, both discard
paths, and the route-changed log condition.

The `h.md.p2p` collapse (`ip = net.IPv6zero`) survived the swap — it is transport behavior with no
counterpart in `peerTable`, so deleting `updateRoute` would have silently broken p2p routing. It now
lives inline in `server.go`'s keepalive block, at the call site that used to be `updateRoute`.

### Changed during implementation

**The reverse index was deleted, not locked.** `peerTable` had a second `sync.Map` (`owners`) so
`dropPeer` could find a peer's routes without scanning. It was a second copy of a fact already in
`peerRoute.name`, and two maps cannot be made consistent: concurrent `set` calls could leave
`owners` naming one peer while `routes` belonged to another, and `dropPeer(loser)` would delete the
winner's route. Proven with a probe (200 rounds broke the invariant at round 3), then fixed by
removing the index — `dropPeer` scans `routes` and uses `CompareAndDelete`, which is *stricter* than
the `routes.Delete` it replaced.

A lock was the wrong fix: `lookup` runs per delivered packet, `dropPeer` once per stream close, so
the cost would have landed on the hot path to settle a race that only matters at reclamation.
`dropPeer` was already O(n) over the same key space, so the deletion is free.

Covered by `TestTransportRouterConcurrentSetKeepsRouteWithItsOwner` (fails at round 155 plain,
round 13 under `-race`, before the fix).

### Carried into Task 3

- **`h.md.p2p` is dead in shipped configs** — no config sets `tun.p2p`/`p2p` on a tun handler
  (`play/p2p-tun-hub/gost.yml` has no such key). So the collapse Task 2 preserved has no test today,
  for want of a `net.PacketConn` harness. Task 3 builds that seam.
- **`resolveUDPAddr` must not appear on the p2p path** — a p2p route name is a peer key, not an
  address. It is socket-only by construction today.
- **`golangci-lint` cannot run here** (v1.64.8 vs go1.27 export-data mismatch). `x`'s verification
  path is build + vet.

### Carried into Task 5

- **`x`'s p2p hub is now runnable**: `NewP2PHandler` (`x/handler/tun/p2phandler.go`) is the
  constructor wisper wires. Signature:
  `NewP2PHandler(device net.Conn, auther auth.Authenticator, opts ...handler.Option) handler.Handler`.
  TTL is 0 by construction — the p2p hub has none and reclaims on stream close.
- **`ownNets` must be wired by whoever builds the handler's device conn**, or the self-loop guard
  silently does nothing. `p2phandler.go` reads it off the conn's context the way `server.go` does;
  the listener is what puts the parsed `config` there.
- **wisper's hub keeps `p2pHostManager.register`**, so the allowlist stays the admission and no
  bind address is needed. That is what removes the endpoint a paired p2p tunnel had to repeat.

### Tasks 3 and 4 — the p2p engine, the compatibility suite, and the seam between them

**Task 3 — the p2p delivery implementation.** `x` commit `e95b830` (`p2p.go` only).

The shape the earlier draft got wrong, now corrected: **one loop reads the device and every write
goes through one mutex.** `tunDevice` (`listener/tun/tun.go`) shares `d.rbufs[0]` and `d.wbuf`
across calls with no lock, so it admits one reader and one writer and guarantees neither — safe
today only because the socket server happens to have one goroutine per side. A per-stream bridge
would have had N of each, and the packets would have interleaved. p2p's `frameConn.Write`
serializes only its read buffer, so each peer's stream also gets its own write lock: two different
shared states, so two locks rather than one lock doing two jobs.

`dispatch` deliberately does **not** collapse the destination the way the socket p2p hub does. The
collapse is right there (one logical peer, no better answer) and wrong here, where a name resolves
to one specific stream and a spoke is reachable at the address it registered.

Two things the implementer added that the brief did not ask for, both correct:

- a length guard in `destinationOf`, because `waterutil.IsIPv4` indexes `packet[0]`
  unconditionally and a zero-length read would panic
- `isKeepaliveFrame` accepts a bare 20-byte header where `onKeepalive` refuses one as a
  registration. It must: the echo carries the magic header, and letting it fall through would
  inject a 20-byte non-packet into the device

**The concurrency test was vacuous at first, and the implementer found that itself.** It built the
harness as a datagram-shaped pipe, which delivers each `Write` through a channel and is therefore
atomic per message — removing the write lock left the test green. The real conn frames each write
as `[2-byte length][payload]` and parses it back, so it rewrote the harness as a byte stream that
parses the way `frameConn.Read` does. Removing the lock then fails in round 0
(`stream ends mid-frame: 1650 bytes left for a 8224-byte payload`), with and without `-race` — a
spliced length prefix corrupts every subsequent frame's offset, which a message-shaped pipe cannot
reproduce at all. The reason is recorded in the file so the pipe does not come back.

**Task 4 — one assertion set, driven against both hubs.** `x` commits `6e84d37` (suite) and
`8787aff` (lifting the p2p half).

This is where the design's central claim is tested: **a spoke cannot tell which hub it reached.**
Six shared assertions — registers, refuses a wrong passphrase, refuses its own address, delivers by
destination, discards an unrouted destination, answers the keepalive — each run against both.

The socket half drives `server.go`'s own `transportServer` over a real UDP link rather than
reimplementing the loop, on the principle that a compat suite asserting against a copy only proves
the copy agrees with itself.

**The suite was delivered half-finished and said so.** The p2p half skipped all seven cases for
want of an end-to-end seam — `p2p.go` was a complete engine that nothing could run. `available()`
was made to panic rather than return a stub, so the skip could not be lifted by accident. The
handler (`NewP2PHandler`) was then pulled forward from the later task to provide it. Final counts:
socket 14 subtests, p2p 16, both real, zero implementation-specific skips; 92 pass package-wide
under `-race`.

**The lifted half exposed a hole in the suite Task 4 left behind.** Two mutations passed all six
shared assertions: `peerGone` dropping routes unconditionally, and `install` not replacing on
reconnect. No shared case registers, replaces, and then closes a stream under the same key — which
is exactly what a reconnect is. A `peerGone` that cuts off a reconnected peer passed the whole
suite. Added a p2p-only case (the socket hub cannot express a reconnect) asserting the route
survives *and* that a packet off the device reaches the new stream, not the stale one.

Mutation results at the end — each turned the p2p half red with the socket half green, which is
the evidence that the suite distinguishes the two implementations rather than passing wholesale:

| mutation | caught by |
|---|---|
| `fromSpoke` skips the keepalive answer | 4 shared p2p cases + the teardown case |
| `peerGone` drops routes unconditionally | the new reconnect case |
| `install` does not replace on reconnect | the new reconnect case |
| `ownNets` not wired | `refuses the hub's own address` |

`resolveUDPAddr`'s round-trip is **not** in the shared set: a p2p peer's name is a peer key, not an
address, so the assertion has no counterpart. Forcing it onto both would mean asserting it against a
name that is deliberately not an address.

### A note on what mutation testing kept finding

Every defect these four tasks surfaced was the same kind: **a test that passed while proving
something other than what it was named for.** None of them turned the suite red on its own.

- `auth.WithService` dropped — an external plugin auther would receive `""`
- the TTL test not pinning `3×` (`3×→1×` passed)
- the self-loop test vacuous — the auther refused the frame before the guard ran
- the multi-address path untested — and it is the *common* path, since `client.go` sends every
  address in `config.Net`
- the reconnect path untested — six shared assertions all green with a `peerGone` that cuts off a
  reconnected peer

None of these are visible from "the tests pass". They are only visible from breaking something and
watching a test stay green.

### Tasks 5 and 6 — wisper wiring, API, UI

**Task 5 — the hub stops binding a socket.** wisper commit `fead221` (`tunnel/tun.go`,
`tunnel/tun_test.go`).

`Run` now: create the device via the tun listener → `p2pHost.acquire` →
`p2pHost.register(allowlist)` → `NewP2PHandler(deviceConn, auther, …)` → serve over the route.
`init` rejects an endpoint outright and rejects an empty allowlist, so a hub carried over from the
socket form says why it stopped working rather than silently changing meaning.

Three things the brief did not anticipate, all found by the implementer:

- **`deviceLn.Close()` must not be called at the end of `Run`** — it closes `l.active`, which *is*
  the accepted conn, so it tears down the device fd and ends the hub. The old code closed on the
  way out as correct cleanup; here that is a kill. The listener is retained and closed in `Close`.
- **`p2pHost.register` only claims routes — it does not listen.** Without `acquire`, a hub that is
  the only p2p tunnel on the host has nothing accepting its streams.
- **`handler.ServiceOption` is required.** `peerTable` passes its service name to the auther on
  every authentication, and x's own comment says dropping it silently changes what an external
  plugin auther thinks is asking.

The device conn vs listener question came out clean: `Accept()` reads a one-slot queue that
`listenLoop` fills *before* parking, so the device is available the moment `Init` returns. No `x/`
change needed.

**The wiring itself is untested** — every test is config-level, because creating a real device
needs `CAP_NET_ADMIN`. Task 7's e2e is the only thing that will prove the device conn really
carries its config through to `ownNets`, and that the self-route guard is live.

**Task 6 — the API and UI stopped describing the old hub.** wisper commit `9c3f0eb`.

Scope was widened mid-flight: the plan had Task 6 as UI-only, but the API still *required* an
endpoint the runtime now *forbids*, so a tun hub created through the UI either 400s or fails at
`Run`. The feature the whole change exists for could not be created. `validateTunTunnel` now runs:
endpoint set → 400 (naming the address it rejected) → empty allowlist → 400 → the unchanged
`net`/`routes`/`dns` checks. All seven `TestCreateTunTunnelValidation` cases were rewritten to the
new rule; each carries a valid spoke key so it reaches its own rule rather than tripping an earlier
one.

The UI change that was not in the brief and was needed for the feature to work at all: **there was
no way to enter an allowlist.** With the bind-address field gone, a hub could only be created by
hand-editing the config. An "Allowed spokes" editor was added — one key per line, with the same
masked/reveal/copy treatment the p2p allowlist row has.

Deliberately kept: `keepalive`/`ttl` on the tun **entrypoint** form (the same spoke binary talks to
either kind of hub), the fields on `TunnelCreateRequest`/`TunnelOptions` (the config still carries
them), and the p2p-only allowlist card (a hub has no `PeerSetter`, so routing it there would 400).

### Still open after review

Two inconsistencies a review of Task 6 surfaced, both between what the runtime does and what a user
sees:

1. **A hub shows no per-peer traffic.** `toTunnelResponse` fills `PeerStats` only for a
   `PeerStatsReporter`, and `tunTunnel` is not one — so the hub's allowlist row shows aliases but no
   figures while the identical row on a p2p tunnel does. The data already exists: the hub's streams
   come from the same `peerListener`, which keeps per-peer counters. Wiring the two interfaces is
   the fix. This was decided during design ("API first, page later") and never implemented.
2. **A spoke key can only be held once**, hub or p2p tunnel — both draw from the process-wide
   host, and `reconcile` rejects the clash. Nothing in the UI says so, so a user migrating from the
   socket form moves keys to the hub and gets `peer … is already used by another p2p tunnel` with
   no explanation.

Neither is fixed yet.

### Gaps closed after review

**Per-peer traffic for a hub** — wisper commit `86eaef3`. `tunTunnel` implements
`PeerStatsReporter` and `PeerStatsUpdater`. The two methods were **not** copied: the only difference
between a p2p tunnel and a hub is which listener they read, so `peerStatSnapshot` and
`updatePeerStatSnapshot` were extracted and both tunnels call them — a hub and a p2p tunnel cannot
now drift into reporting a peer differently, which is the whole point of the gap.

The implementer caught a race in its own first cut: it passed `s.ln` and `s.opts.Peers` as call
arguments, which evaluates them *before* the helper takes the lock, while `Close`/`SetPeers` mutate
both under the write lock. The helpers now take pointers and do the reading themselves.

The test asserts rates (one peer non-zero, one zero across a window), not just counters — but it
calls `UpdatePeerStats()` by hand, so it verifies the mechanism, not the wiring. Nothing in Go
asserts that a registered `tunTunnel` is actually ticked; the e2e is what would catch that.

**The exclusive-key explanation** — wisper commit `6c57300`. A hint in the hub's allowlist editor,
and `web-src/src/utils/save-error.ts` translating `is already used by another p2p tunnel` into an
explanation, wired into both places the clash can arrive (the p2p allowlist card and the hub's own
form). Runtime untouched: `reconcile` rejecting the clash is correct.

### Still open — three more, found by the next review

Reviewing the two above turned up three more places where the runtime and the UI disagree. All three
are real; all three are now fixed (see below).

### Three more gaps closed — wisper `7dc6c93` (api), `2abbc8e` (badge), `b3010af` (web)

**A hub's per-spoke traffic is rendered.** The row is now **one component**
(`web-src/src/components/peer-stats-row.ts`) drawn by both the hub's detail page and the p2p peers
page, so a hub's spoke and a tunnel's peer cannot drift. The hub does *not* get a route into the
peers page: that page is built around editing a p2p tunnel's list (save all, add a key, toggle one
off), and none of that applies to a hub, whose keys are typed one-per-line into its own form next
to the device and routes they belong to. Reusing the component also removed ~240 lines of duplicated
presentation and ~120 lines of dead CSS.

Two things this surfaced that were not in the brief: the row's name comes from the **allowlist**,
not from the report (an unrun hub has no counters, so its spokes rendered as "No alias" — found by
the e2e), and a `slot` does not work for the row actions (slotted nodes live outside the shadow
root, so an existing e2e selector stopped reaching them).

**A hub's spokes carry diagnostics.** The API condition became `hasP2PPeers(opts)` =
`opts.Peer != "" || len(opts.Peers) > 0`. The question was never the *type*, it is the *peers*. A
p2p entrypoint is untouched and a non-p2p tunnel with no allowlist stays out.

**The encryption badge.** `tun` joins the tunnel side of `_secure()`, and the ternary collapsed
because both branches were the same predicate. A sweep found five places making the type-vs-side
distinction; two changed, three already correct (recording, the entrypoint-side gates, the
p2p-only gates on the peers page). One more bug fell out: `PUT /api/tunnels/{id}/peers` answered a
hub with "only p2p tunnels have an allowlist", untrue since the hub landed.

### One assertion this environment cannot make

The requested API test — a hub's row carrying a non-empty `transport`/`state`/`last_error` — **is
not achievable here, and the implementer proved it rather than assuming it.** p2p fills status only
for a peer with a live data path, which needs a real relay and a live peer; and a tun hub cannot
`Run()` at all without root (`operation not permitted` verified). An unrun hub has no route, so
`PeerStats()` returns nil and there are no rows to assert on.

What exists instead: `TestHasP2PPeers` is a table over real `Options` and **fails against the old
condition** (verified by reverting), and `tunnel/p2p_e2e_test.go` (tag `p2ppoc`) covers the values
end to end for a p2p tunnel against a real relay. **A `p2ppoc` e2e for a tun hub is the missing
piece**, and it belongs on the privileged container this work is headed toward.

### Incident: a hub's routes took a gateway's LAN down

Recorded because it is the one thing in this work that caused real damage, and
because the design made it possible without warning.

A hub was deployed on a machine that is its LAN's gateway, and created with
`routes` naming that LAN. The machine went dark, and the whole network with it,
until the container was removed.

The mechanism is the interaction of two decisions, each reasonable alone:

- the hub runs with `network_mode: host`, so its device is created in the **host's**
  network namespace (this is what makes p2p hole punching work — see the deployment notes)
- `x/listener/tun` applies the `routes` metadata with **`netlink.RouteReplace`**
  (`tun_linux.go`), which *replaces* a route to the same destination rather than
  adding one beside it

So naming the LAN did not add a route into the tunnel, it replaced the host's own
route to the LAN with one pointing at the tun device. On a gateway, that redirects
every packet bound for the LAN into a tunnel that has nowhere to send it.

`routes` and `dns` are client-side settings — they tell a device whose traffic is
being *captured* what to capture and which resolver to push. A hub captures
nothing, and its peers share the device's own subnet, so the address in `net` is
the only route it needs (`net: 10.10.100.1/24` gives the kernel a route to the
whole `/24`). Both are now refused by the API, dropped by the hub, and absent from
its form.

Two things this says beyond the fix:

- **The `routes` field was carried over from the socket form without asking what
  it means on a hub.** On the socket form the device is in a container netns, so a
  wrong route is contained; on a host-networked hub the same value reaches the
  host's routing table. Moving a field across that boundary is what changed its
  blast radius, and nothing in the UI said so.
- **`RouteReplace` is the sharp edge, not `RouteAdd`.** A hub that only ever added
  routes would have been wrong in a much less interesting way.

The smoke could not have caught it: it runs as one unprivileged-adjacent container
with no LAN to take down, and it asserted the hub's routes reached the listener —
the very thing that was dangerous. The test now asserts the opposite.

Three more, found by that pass. None is a data or correctness bug — all are places where a hub is
presented less informatively than a p2p tunnel:

1. **A hub's row has no expander unless the spoke has a live session.** Correct (the host reports no
   diagnostic for a peer that never dialled) but it means a hub's *first* connection shows only "No
   traffic yet" with nothing to expand.
2. **`tunnel-detail-page.ts:1040` — a p2p tunnel's allowlist summary still renders as one
   comma-joined line of aliases**, while a hub's summary is now a count. Same list, two
   presentations, and the p2p side still hides per-peer state behind the eye toggle. The fix is to
   delete `_peerLabels()`.
3. **A hub has no `PeerSetter`,** so `SetPeers` exists only on `p2pTunnel`; a hub's allowlist edit is
   a full PUT and restart. Fine today, but the two objects with p2p peers differ in a way the API
   does not advertise.

Not swept, flagged rather than changed: `handleDeleteTunnel` removes a legacy per-tunnel key file
only for `P2PTunnel`. No code path writes one for a tun hub, so it is believed dead.

### The keepalive switch did nothing, and it was the bug

Found by asking a smaller question: the tun entrypoint's `keepalive` hint mentioned a *socket* hub
and a *point-to-point tun↔tun* link, neither of which a user meets. Rewriting it needed the facts.

**What the handshake is for.** A tun client sends `[magic][passphrase][N×16B addresses]` to the far
side's tun server. The server routes by destination address, and this frame is the **only** source
of the mapping from an address to the peer that holds it — a peer's device address is a private
fact. Without it the server discards everything bound for that peer: traffic leaves, nothing comes
back. That is the one-way link the entrypoint's own comment warns about.

**The bug.** `keepalive()` has always sent the handshake unconditionally and returned early when no
period was configured — the period only ever decided whether it *repeated*. But the call site gated
the whole call:

```go
if network == "udp" || h.md.keepAlivePeriod > 0 {
```

On a p2p link `network` is `"ip"`, so with the switch off **nothing was sent at all**. And a p2p
hub's route table has `ttl = 0` — a peer says it has left by closing its stream — so on p2p the
repeat buys nothing and the one-shot is everything. The gate demanded the part that does nothing in
order to get the part that is everything.

**Fixed in x `v0.19.5`:** the handshake always runs; the period keeps its meaning where it has one
(a server reached over UDP is connectionless, so silence is the only departure signal, and the
repeat is what lets a route expire).

**And the switch was never a choice for this entrypoint.** A wisper tun entrypoint reaches its hub
over p2p and nothing else — the peer key is required and this side dials out. So with the fix, both
`keepalive` and `ttl` set values nothing reads: removed from the form, the view row and the handler
metadata. The test that asserted they reached x now asserts they never do.

**Two verifications, because the first kind was wrong before.**

| | registrations the hub logged | routes |
|---|---|---|
| old x, debug run | 1 (only the `keepalive:true` peer) | 1 |
| x v0.19.5, debug run | **2** | **2** |

and the smoke's tunnel assertions, run against a binary built from the *old* x, fail:

```
FAIL hub cannot reach the peer (10.10.0.2)
FAIL hub cannot reach the keepalive:false peer (10.10.0.3)
{"level":"warn","msg":"no route for 10.10.0.2, packet discarded"}
```

That last pair is the point. Those assertions had been passing against the old x too — for years of
runs, in effect.

### Why they had been passing: one network namespace for every instance

The smoke started the hub, both peers and the derper in **one** netns. A tun device takes a host
route for its own address, so a ping from the hub to `10.10.0.3` was routed by the kernel to **peer
2's own device**, inside the machine. It never touched the p2p link, and the assertion passed
whether or not the peer had registered.

This is what hid the keepalive bug: the smoke was written to check that a `keepalive:false` peer
still registers and is reachable, and the check could not fail.

Each instance now has its own netns, joined by a bridge (the derper binds the bridge address and the
instances dial that). One effect worth recording, because it was masked before: the peer's device is
a `/32`, so the hub is not on-link and the peer genuinely needs `routes: "<hub>/32"` — in the shared
netns the hub's own `/24` route had been covering for it.

Still passing for a reason other than their names, left as they are:

- `the hub's route to peer2 is reclaimed after it left` fails the ping after a delete, which it also
  does when the route was never established — it is only meaningful because the preceding check
  establishes the route first
- `the hub's tun tunnel carried the traffic` greps `output_bytes` across the whole tunnel list rather
  than the hub's own row
- the derper serves a self-signed cert for its IP; the `openssl`-generated file is never used

---

## File structure

**`x/handler/tun/`** (the new code is `router.go`, `p2p.go`, `peerstream.go`, `p2phandler.go`; `server.go` shrinks):

| File | Responsibility |
|---|---|
| `router.go` (new) | `peerTable`: the keepalive protocol, the auther check, TTL expiry, destination lookup. Knows nothing about transport. A route's value is a `string` — a name. |
| `p2p.go` (new) | `peerStream` (one stream, writes serialized), `peerRouter` (a name resolves to a stream), `p2pHub` (one device read loop, one write lock). |
| `p2phandler.go` (new) | `NewP2PHandler`: the `handler.Handler` a hub's service runs, bridging accepted streams into the hub and owning its device loop. |
| `server.go` (modify) | the socket delivery: `resolveUDPAddr` turns a name into an address, delivered with `WriteTo`. Keeps its loops. |

Note: the plan originally split this across `peerstream.go` and put `p2phandler.go` in a later
task. In practice `peerStream` went in with the rest of the p2p engine, and the handler turned out
to be the seam the compatibility suite needs — it was pulled forward, see the execution log.

**`wisper/tunnel/`**:
| File | Responsibility |
|---|---|
| `tun.go` (modify) | the hub stops binding a socket; accepts from the p2p listener |

**`wisper/web-src/`**:
| File | Responsibility |
|---|---|
| `pages/tunnel-detail-page.ts` (modify) | the hub form drops the bind-address, `keepalive`, and `ttl` fields |

---

### Task 1: Extract the route table into `peerTable`

The table's value becomes a `string` — a name, not an address. This is what lets both implementations share it: a UDP endpoint and a peer key are both names, and neither is a `net.Addr`.

**Files:**
- Create: `x/handler/tun/router.go`
- Test: `x/handler/tun/router_test.go`

- [x] **Step 1: Write the failing test**

`x/handler/tun/router_test.go`:

```go
package tun

import (
	"net"
	"testing"
	"time"
)

// A keepalive registers the peer's IPs under the name its delivery resolves.
func TestTransportRouterRegistersKeepalive(t *testing.T) {
	r := newPeerTable(nil, 0, nil)

	frame := keepAliveFrame("secret", net.IPv4(10, 10, 0, 2))
	peerIPs, ok := r.onKeepalive(context.Background(), frame, "udp-peer-1")
	if !ok {
		t.Fatal("keepalive rejected")
	}
	if len(peerIPs) != 1 {
		t.Fatalf("got %d peer IPs, want 1", len(peerIPs))
	}

	name, ok := r.lookup(net.IPv4(10, 10, 0, 2))
	if !ok {
		t.Fatal("registered IP has no route")
	}
	if name != "udp-peer-1" {
		t.Fatalf("route name = %q, want %q", name, "udp-peer-1")
	}
}

// An unauthenticated registration must leave no route behind.
func TestTransportRouterRejectsUnauthenticated(t *testing.T) {
	r := newPeerTable(newTestAuther("secret"), 0, nil)

	if _, ok := r.onKeepalive(context.Background(), keepAliveFrame("wrong", net.IPv4(10, 10, 0, 3)), "peer-x"); ok {
		t.Fatal("keepalive accepted with the wrong passphrase")
	}
	if _, ok := r.lookup(net.IPv4(10, 10, 0, 3)); ok {
		t.Fatal("an unauthenticated peer got a route")
	}
}

// A route whose TTL has passed is dropped; one inside it is not.
func TestTransportRouterExpiresByTTL(t *testing.T) {
	r := newPeerTable(nil, 30*time.Millisecond, nil)

	frame := keepAliveFrame("", net.IPv4(10, 10, 0, 4))
	if _, ok := r.onKeepalive(context.Background(), frame, "peer-y"); !ok {
		t.Fatal("keepalive rejected")
	}
	if _, ok := r.lookup(net.IPv4(10, 10, 0, 4)); !ok {
		t.Fatal("route missing inside its TTL")
	}

	time.Sleep(90 * time.Millisecond)
	if _, ok := r.lookup(net.IPv4(10, 10, 0, 4)); ok {
		t.Fatal("route outlived 3x its TTL")
	}
}

// Dropping a peer removes every route it registered and leaves others alone.
func TestTransportRouterDropsPeerRoutes(t *testing.T) {
	r := newPeerTable(nil, 0, nil)

	// Keepalives carry several IPs, so one peer can own more than one route.
	r.onKeepalive(context.Background(), keepAliveFrame("", net.IPv4(10, 10, 0, 5), net.IPv4(10, 10, 0, 6)), "peer-z")
	r.onKeepalive(context.Background(), keepAliveFrame("", net.IPv4(10, 10, 0, 7)), "peer-w")

	r.dropPeer("peer-z")

	if _, ok := r.lookup(net.IPv4(10, 10, 0, 5)); ok {
		t.Fatal("dropped peer kept a route")
	}
	if _, ok := r.lookup(net.IPv4(10, 10, 0, 6)); ok {
		t.Fatal("dropped peer kept a second route")
	}
	if _, ok := r.lookup(net.IPv4(10, 10, 0, 7)); !ok {
		t.Fatal("dropping one peer took out another's route")
	}
}

// A destination with no route resolves to nothing, so a packet for it is
// discarded rather than sent somewhere arbitrary.
func TestTransportRouterUnknownDestination(t *testing.T) {
	r := newPeerTable(nil, 0, nil)
	if name, ok := r.lookup(net.IPv4(10, 10, 0, 99)); ok {
		t.Fatalf("unknown destination resolved to %q", name)
	}
}

// keepAliveFrame builds the wire frame a spoke sends: magic, the passphrase
// padded to 16 bytes, then each IP as 16 bytes.
func keepAliveFrame(passphrase string, ips ...net.IP) []byte {
	b := make([]byte, keepAliveHeaderLength)
	copy(b[:4], magicHeader)
	copy(b[4:20], []byte(passphrase))
	for _, ip := range ips {
		b = append(b, ip.To16()...)
	}
	return b
}
```

Add the two helpers it leans on, to the same file:

```go
func newTestAuther(passphrase string) auth.Authenticator {
	return xauth.NewAuthenticator(xauth.AuthsOption(map[string]string{
		"10.10.0.3": passphrase,
	}))
}
```

and add `context` plus `github.com/go-gost/core/auth` and `xauth "github.com/go-gost/x/auth"` to the imports.

- [x] **Step 2: Run the test to verify it fails**

```bash
cd /config/workspace/go-gost/x && go test ./handler/tun/ -run TestTransportRouter 2>&1 | head -20
```

Expected: compile failure — `undefined: newPeerTable`, `keepAliveFrame`, `newTestAuther`.

- [x] **Step 3: Write the implementation**

`x/handler/tun/router.go`:

```go
package tun

import (
	"bytes"
	"context"
	"net"
	"sync"
	"time"

	"github.com/go-gost/core/auth"
	"github.com/go-gost/core/logger"
)

// peerTable is the routing and authentication a tun hub does, with no
// notion of how datagrams travel: the keepalive protocol, the auther check,
// the route table with its TTL, and destination lookup. A route's value is a
// name that a delivery implementation resolves — a UDP address for the socket
// server, a peer key for the p2p hub. Keeping the value a string is what lets
// both share this table: neither a net.Addr nor a connection fits both.
type peerTable struct {
	auther auth.Authenticator
	ttl    time.Duration
	log    logger.Logger

	routes sync.Map // tunRouteKey -> routeEntry
	// peerOfKey maps a name back to the keys it registered, so a peer leaving
	// takes its routes with it. The socket server leaves it empty: its routes
	// expire on the TTL instead.
	peerOfKey sync.Map // tunRouteKey -> string
}

type routeEntry struct {
	name     string
	lastSeen time.Time
}

func newPeerTable(auther auth.Authenticator, ttl time.Duration, log logger.Logger) *peerTable {
	return &peerTable{auther: auther, ttl: ttl, log: log}
}

// onKeepalive handles a keepalive frame from a peer arriving over the
// transport that names it. It returns the peer's IPs when the registration is
// accepted, and ok false when it is refused — an empty IP list, one of the
// hub's own addresses, or a failed authentication. It does not reply: the
// caller answers, because the reply travels over that same transport.
func (r *peerTable) onKeepalive(ctx context.Context, frame []byte, from string, ownNets []net.IPNet) (peerIPs []net.IP, ok bool) {
	if len(frame) <= keepAliveHeaderLength || !bytes.Equal(frame[:4], magicHeader) {
		return nil, false
	}
	data := frame[keepAliveHeaderLength:]
	if len(data)%net.IPv6len != 0 {
		return nil, false
	}
	for len(data) > 0 {
		peerIPs = append(peerIPs, net.IP(data[:net.IPv6len]))
		data = data[net.IPv6len:]
	}
	if len(peerIPs) == 0 {
		return nil, false
	}

	// One of the hub's own addresses never gets a route: it is the hub talking
	// to itself, and routing to it would loop.
	for _, n := range ownNets {
		for _, ip := range peerIPs {
			if ip.Equal(n.IP.To16()) {
				return nil, false
			}
		}
	}

	if r.auther != nil {
		key := bytes.TrimRight(frame[4:20], "\x00")
		for _, ip := range peerIPs {
			if _, ok := r.auther.Authenticate(ctx, ip.String(), string(key), auth.WithService("")); !ok {
				r.debugf("keepalive from %v => %v, auth FAILED", from, peerIPs)
				return nil, false
			}
		}
	}

	r.debugf("keepalive from %v => %v", from, peerIPs)
	for _, ip := range peerIPs {
		r.set(ip, from)
	}
	return peerIPs, true
}

// set registers or refreshes the route for ip, naming the peer that owns it.
func (r *peerTable) set(ip net.IP, name string) {
	key := ipToTunRouteKey(ip)
	entry := routeEntry{name: name, lastSeen: time.Now()}
	if actual, loaded := r.routes.LoadOrStore(key, entry); loaded {
		old := actual.(routeEntry)
		r.routes.Store(key, entry)
		if old.name != name {
			r.debugf("update route: %s -> %s (old %s)", ip, name, old.name)
		}
	} else {
		r.debugf("new route: %s -> %s", ip, name)
	}
	r.peerOfKey.Store(key, name)
}

// lookup returns the name registered for dst, dropping the route first if its
// TTL has passed. A TTL of zero never expires, which is what an unconfigured
// socket deployment has always had.
func (r *peerTable) lookup(dst net.IP) (string, bool) {
	key := ipToTunRouteKey(dst)
	v, ok := r.routes.Load(key)
	if !ok {
		return "", false
	}
	entry := v.(routeEntry)
	if ttl := r.ttl * 3; ttl > 0 && time.Since(entry.lastSeen) > ttl {
		if r.routes.CompareAndDelete(key, entry) {
			r.peerOfKey.Delete(key)
			r.infof("route expired: %s -> %s", net.IP(key[:]), entry.name)
		}
		return "", false
	}
	return entry.name, true
}

// dropPeer removes every route a peer registered. It is how the p2p hub
// reclaims: a stream close says a peer is gone, which is more accurate than
// the TTL guessing it from silence.
func (r *peerTable) dropPeer(name string) {
	r.peerOfKey.Range(func(k, v any) bool {
		if v.(string) != name {
			return true
		}
		r.routes.Delete(k)
		r.peerOfKey.Delete(k)
		r.infof("dropped routes for peer %s", name)
		return true
	})
}

func (r *peerTable) debugf(format string, args ...any) {
	if r.log != nil {
		r.log.Debugf(format, args...)
	}
}

func (r *peerTable) infof(format string, args ...any) {
	if r.log != nil {
		r.log.Infof(format, args...)
	}
}
```

- [x] **Step 4: Run the test to verify it passes**

```bash
cd /config/workspace/go-gost/x && go test ./handler/tun/ -run TestTransportRouter -v 2>&1 | tail -20
```

Expected: PASS — 5 tests.

- [x] **Step 5: Commit**

```bash
cd /config/workspace/go-gost/x && git add handler/tun/router.go handler/tun/router_test.go && git commit -m "tun: the route table holds a name, not an address

The keepalive protocol, the auther check, the TTL and destination lookup
are the same whichever way datagrams arrive, so they belong together and
know nothing about transport. A route's value becomes a string: a UDP
address for the socket server, a peer key for the p2p hub. net.Addr fit
neither — it is an endpoint, and one of these is not.

dropPeer is the p2p half of reclamation. The socket server expires a
route by TTL, guessing from silence that a peer is gone; a stream close
says so exactly, so the hub drops a peer's routes when its stream ends
and keeps no timer."
```

---

### Task 2: Make the socket server use `peerTable`

The socket server keeps every behavior it has. This task only changes where its state lives, so the socket path is provably unchanged — its existing tests are the guard.

**Files:**
- Modify: `x/handler/tun/server.go`
- Test: `x/handler/tun/handler_test.go` (existing, must stay green)

- [x] **Step 1: Run the existing tests first — this is the guard**

```bash
cd /config/workspace/go-gost/x && go test ./handler/tun/ -v 2>&1 | tail -25
```

Expected: PASS. Record the test names — after Step 4 they must still pass, identically.

- [x] **Step 2: Point the handler at the router**

In `x/handler/tun/handler.go`, replace the `routes sync.Map` field with a pointer built in `Init`:

```go
type tunHandler struct {
	hop   hop.Hop
	router *peerTable
	md      metadata
	options handler.Options
}
```

and in `Init`, after `parseMetadata`:

```go
h.router = newPeerTable(
	options.Auther,
	h.md.keepAlivePeriod,
	options.Logger,
)
```

- [x] **Step 3: Replace the keepalive block in `server.go`**

Replace lines 139-195 (the whole `if n > keepAliveHeaderLength && bytes.Equal(...)` block) with:

```go
				if n > keepAliveHeaderLength && bytes.Equal(b[:4], magicHeader) {
					from := addr.String()
					if _, ok := h.router.onKeepalive(ctx, b[:n], from, config.Net); !ok {
						return nil
					}
					// Answer, so a spoke running keepalive:true sees its
					// deadline refreshed instead of expiring. The reply
					// carries the sender's address, as it always has.
					addrPort, err := netip.ParseAddrPort(from)
					if err != nil {
						log.Warnf("keepalive from %v: %v", addr, err)
						return nil
					}
					var reply [keepAliveHeaderLength]byte
					copy(reply[:4], magicHeader)
					a16 := addrPort.Addr().As16()
					copy(reply[4:], a16[:])
					if _, err := conn.WriteTo(reply[:], addr); err != nil {
						log.Warnf("keepalive to %v: %v", addr, err)
						return nil
					}
					return nil
				}
```

- [x] **Step 4: Replace route lookups**

`updateRoute`, `liveRoute` and the `findRouteFor` body move to the router. Delete those three functions from `server.go`, and rewrite `findRouteFor`:

```go
// findRouteFor names the transport destination for dst: its own registered
// route, else the gateway's on a configured route. A p2p link carries one
// peer, so its routes collapse onto the unspecified address.
func (h *tunHandler) findRouteFor(ctx context.Context, dst net.IP, router router.Router, log logger.Logger) (string, bool) {
	if h.md.p2p {
		dst = net.IPv6zero
		router = nil
	}

	if name, ok := h.router.lookup(dst); ok {
		return name, true
	}

	if router == nil {
		return "", false
	}
	if route := router.GetRoute(ctx, dst.String()); route != nil {
		if gw := net.ParseIP(route.Gateway); gw != nil {
			if name, ok := h.router.lookup(gw); ok {
				return name, true
			}
		}
	}
	return "", false
}
```

- [x] **Step 5: Resolve the name at the two call sites**

The two delivery loops used a `net.Addr`. Each now resolves the name first. In the tun→transport goroutine:

```go
				name, ok := h.findRouteFor(ctx, dst, config.Router, log)
				if !ok {
					log.Debugf("no route for %s -> %s, packet discarded", src, dst)
					return nil
				}
				addr, err := resolveUDPAddr(name)
				if err != nil {
					log.Warnf("route %s: %v", name, err)
					return nil
				}
				log.Debugf("find route: %s -> %s", dst, addr)

				if _, err := conn.WriteTo(b[:n], addr); err != nil {
					return err
				}
```

and in the transport→tun goroutine, the same two lines replacing the bare
`if addr := h.findRouteFor(...)`:

```go
					if !h.md.p2p {
						name, ok := h.findRouteFor(ctx, dst, config.Router, log)
						if ok {
							addr, err := resolveUDPAddr(name)
							if err != nil {
								log.Warnf("route %s: %v", name, err)
								return nil
							}
							log.Debugf("find route: %s -> %s", dst, addr)
							_, err = conn.WriteTo(b[:n], addr)
							return err
						}
					}
```

Add `resolveUDPAddr` to `server.go`:

```go
// resolveUDPAddr turns a route's name back into the address it was stored as.
// The socket server resolves per delivery rather than caching: it is a parse
// and an allocation against a device read that already cost a syscall, and
// the table is small enough that a cache would cost more to keep correct
// (an address changes when a peer's source port moves) than it saves.
func resolveUDPAddr(name string) (net.Addr, error) {
	return net.ResolveUDPAddr("udp", name)
}
```

- [x] **Step 6: Build, vet, and run the existing tests**

```bash
cd /config/workspace/go-gost/x && go build ./... && go vet ./...
cd /config/workspace/go-gost/x && go test ./handler/tun/ -v 2>&1 | tail -25
```

Expected: build and vet clean; **every test from Step 1 still passes, same names.** If any does not, the socket path changed behavior — that is the failure this task exists to prevent. Stop and fix rather than updating the test.

- [x] **Step 7: Commit**

```bash
cd /config/workspace/go-gost/x && git add handler/tun/handler.go handler/tun/server.go && git commit -m "tun: the socket server keeps its behavior, on the shared router

Its keepalive handling, route lookups and both delivery loops move onto
peerTable unchanged: the same magic-header reply, the same gateway
fallback, the same discard for an unrouted packet. Only the route's
value is now a name, resolved at the point of delivery.

Existing tests passing unchanged is the evidence — the socket path must
not behave differently after this, so a test that needs updating means
something moved that should not have."
```

---

### Task 3: The p2p delivery implementation

The device admits one reader and one writer and guarantees neither: `tunDevice`
shares `d.rbufs[0]` and `d.wbuf` with no lock, and p2p's `frameConn.Write`
serializes only its read buffer. So nothing here touches the device per stream.
One loop reads it; every write goes through one mutex. This is the socket
server's shape reached a different way.

**Files:**
- Create: `x/handler/tun/p2p.go`
- Test: `x/handler/tun/p2p_test.go`

- [x] **Step 1: Write the failing test**

`x/handler/tun/p2p_test.go`:

```go
package tun

import (
	"context"
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

// A datagram the hub reads off the device is delivered on the stream the
// destination IP's route names.
func TestP2PDeliversToRoutedPeer(t *testing.T) {
	hub := newTestHub(t)

	hub.addPeer("peer-a")
	hub.addPeer("peer-b")
	hub.register(t, "peer-a", net.IPv4(10, 10, 0, 2))
	hub.register(t, "peer-b", net.IPv4(10, 10, 0, 3))

	hub.deviceFrom(t, ipv4Datagram(net.IPv4(10, 10, 0, 1), net.IPv4(10, 10, 0, 3)))

	if got := hub.readDatagram(t, "peer-b"); string(got) != wantDst3 {
		t.Fatalf("peer-b got %q, want %q", got, wantDst3)
	}
	if got := hub.readNothing(t, "peer-a", 50*time.Millisecond); got != nil {
		t.Fatalf("peer-a received %q, want nothing", got)
	}
}

// A datagram a spoke sends reaches the device.
func TestP2PSpokeDatagramReachesDevice(t *testing.T) {
	hub := newTestHub(t)
	hub.addPeer("peer-a")

	hub.writeFromPeer(t, "peer-a", []byte("from-spoke"))

	if got := hub.readDevice(); string(got) != "from-spoke" {
		t.Fatalf("device got %q, want %q", got, "from-spoke")
	}
}

// Concurrent spokes writing the device must not corrupt each other: the write
// side is shared state with no lock of its own.
func TestP2PConcurrentSpokeWritesAreIntact(t *testing.T) {
	hub := newTestHub(t)

	const peers, each = 4, 25
	for i := range peers {
		hub.addPeer(peerName(i))
	}

	var wg sync.WaitGroup
	for i := range peers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range each {
				hub.writeFromPeer(t, peerName(i), payloadFor(i, j))
			}
		}()
	}
	wg.Wait()

	seen := map[string]bool{}
	for range peers * each {
		got := hub.readDevice()
		key := string(got)
		if seen[key] {
			t.Fatalf("duplicate payload %q: writes interleaved", key)
		}
		seen[key] = true
		if !strings.HasSuffix(key, "\x00\x00\x00\x00") {
			t.Fatalf("payload %q is torn", key)
		}
	}
}

// A stream closing drops that peer's routes — but only while it still holds
// them. A reconnect brings a new stream under the same key; the old one's
// teardown must not withdraw what the new one registered.
func TestP2PTeardownDoesNotWithdrawSuccessor(t *testing.T) {
	hub := newTestHub(t)

	old := hub.addPeer("peer-a")
	hub.register(t, "peer-a", net.IPv4(10, 10, 0, 2))

	// The peer reconnects: a new stream takes the key and re-registers.
	hub.addPeer("peer-a")
	hub.register(t, "peer-a", net.IPv4(10, 10, 0, 2))

	// The old stream now ends, late.
	old.close()

	if _, ok := hub.table.lookup(net.IPv4(10, 10, 0, 2)); !ok {
		t.Fatal("a stale stream's teardown withdrew the live peer's route")
	}
}

// A stream closing drops its peer's routes when it still holds them.
func TestP2PTeardownDropsOwnRoutes(t *testing.T) {
	hub := newTestHub(t)

	c := hub.addPeer("peer-a")
	hub.register(t, "peer-a", net.IPv4(10, 10, 0, 2), net.IPv4(10, 10, 0, 5))

	c.close()

	if _, ok := hub.table.lookup(net.IPv4(10, 10, 0, 2)); ok {
		t.Fatal("closed peer kept a route")
	}
	if _, ok := hub.table.lookup(net.IPv4(10, 10, 0, 5)); ok {
		t.Fatal("closed peer kept its second route")
	}
}

// A keepalive is answered, so a spoke running keepalive:true does not expire on
// its own read deadline.
func TestP2PAnswersKeepalive(t *testing.T) {
	hub := newTestHub(t)
	hub.addPeer("peer-a")

	c := hub.peerConn("peer-a")
	if _, err := c.Write(keepAliveFrame("", net.IPv4(10, 10, 0, 2))); err != nil {
		t.Fatal(err)
	}

	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 64)
	n, err := c.Read(buf)
	if err != nil {
		t.Fatal("keepalive was not answered:", err)
	}
	if n != keepAliveHeaderLength {
		t.Fatalf("answer is %d bytes, want %d", n, keepAliveHeaderLength)
	}
	if _, ok := hub.table.lookup(net.IPv4(10, 10, 0, 2)); !ok {
		t.Fatal("the keepalive did not register the peer's address")
	}
}

// A packet for a destination no peer registered is discarded and named, so a
// spoke that never registers is visible rather than merely silent.
func TestP2PUnroutablePacketIsNamed(t *testing.T) {
	hub := newTestHub(t)
	hub.addPeer("peer-a")
	hub.register(t, "peer-a", net.IPv4(10, 10, 0, 2))

	hub.deviceFrom(t, ipv4Datagram(net.IPv4(10, 10, 0, 1), net.IPv4(10, 10, 0, 99)))
	hub.expectWarning(t, "10.10.0.99")
}

// peerName and payloadFor build stable identities for the concurrency test.
func peerName(i int) string { return fmt.Sprintf("peer-%d", i) }

func payloadFor(peer, n int) []byte {
	b := make([]byte, 64)
	binary.BigEndian.PutUint32(b, uint32(peer)<<16|uint32(n))
	return b
}

const wantDst3 = "to-peer-b"
```

Append the harness it leans on, to the same file:

```go
// testHub is a hub with an in-memory device, so the tests exercise the real
// loops rather than a stand-in for them.
type testHub struct {
	t      *testing.T
	device *datagramPipe // the device end: reads come from the hub, writes go to it
	peers  map[string]*peerStream

	table *peerTable
	router *peerRouter
	hub    *p2pHub
	warnings chan string
}

func newTestHub(t *testing.T) *testHub {
	t.Helper()
	// The device side the hub writes to, and the side its read loop draws from.
	toDevice, fromDevice := newDatagramPipe()

	h := &testHub{
		t:        t,
		device:   fromDevice,
		peers:    make(map[string]*peerStream),
		warnings: make(chan string, 16),
	}
	h.table = newPeerTable(nil, 0, xlogger.Nop())
	h.router = &peerRouter{table: h.table, streams: make(map[string]*peerStream)}
	h.hub = newP2PHub(toDevice, h.router, nil, h.warnf)

	go h.hub.run()

	t.Cleanup(h.hub.stop)
	return h
}

func (h *testHub) warnf(msg string) { h.warnings <- msg }

func (h *testHub) addPeer(key string) *peerStream {
	h.t.Helper()
	c, dev := newDatagramPipe()
	s := newPeerStream(key, c)
	h.peers[key] = s
	h.router.streams[key] = s
	// The stream's own read loop, as a spoke connection would drive it.
	go func() {
		buf := make([]byte, MaxMessageSize)
		for {
			n, err := s.Read(buf)
			if n > 0 {
				h.hub.fromSpoke(buf[:n])
			}
			if err != nil {
				break
			}
		}
		h.hub.peerGone(s)
	}()
	h.t.Cleanup(func() { s.close() })
	return s
}

func (h *testHub) register(t *testing.T, key string, ips ...net.IP) {
	t.Helper()
	s := h.peers[key]
	if _, ok := h.table.onKeepalive(context.Background(), keepAliveFrame("", ips...), key, nil); !ok {
		t.Fatal("registration refused")
	}
	_ = s
}

func (h *testHub) peerConn(key string) *peerStream { return h.peers[key] }

func (h *testHub) writeFromPeer(t *testing.T, key string, pkt []byte) {
	t.Helper()
	if _, err := h.peers[key].Write(pkt); err != nil {
		t.Fatal(err)
	}
}

func (h *testHub) deviceFrom(t *testing.T, pkt []byte) {
	t.Helper()
	if _, err := h.hub.deviceFromDevice(pkt); err != nil {
		t.Fatal(err)
	}
}

func (h *testHub) readDevice() []byte {
	h.t.Helper()
	h.device.SetReadDeadline(time.Now().Add(2 * time.Second))
	b := make([]byte, 1500)
	n, err := h.device.Read(b)
	if err != nil {
		h.t.Fatal("reading the device:", err)
	}
	return b[:n]
}

func (h *testHub) readDatagram(t *testing.T, key string) []byte {
	t.Helper()
	c := h.peers[key]
	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	b := make([]byte, 1500)
	n, err := c.Read(b)
	if err != nil {
		t.Fatal(err)
	}
	return b[:n]
}

func (h *testHub) readNothing(t *testing.T, key string, d time.Duration) []byte {
	t.Helper()
	c := h.peers[key]
	c.SetReadDeadline(time.Now().Add(d))
	b := make([]byte, 1500)
	n, err := c.Read(b)
	if err != nil {
		return nil
	}
	return b[:n]
}

func (h *testHub) expectWarning(t *testing.T, want string) {
	t.Helper()
	select {
	case got := <-h.warnings:
		if !strings.Contains(got, want) {
			t.Fatalf("warning %q does not name %q", got, want)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no warning for an unroutable packet")
	}
}

// ipv4Datagram builds a minimal IPv4 packet with the given endpoints, so
// destination parsing is exercised without a device.
func ipv4Datagram(src, dst net.IP) []byte {
	pkt := make([]byte, 20)
	pkt[0] = 0x45 // version 4, header length 5
	binary.BigEndian.PutUint16(pkt[2:], 20)
	copy(pkt[12:16], src.To4())
	copy(pkt[16:20], dst.To4())
	return pkt
}
```

- [x] **Step 2: Run the test to verify it fails**

```bash
cd /config/workspace/go-gost/x && go test ./handler/tun/ -run TestP2P 2>&1 | head -20
```

Expected: compile failure — `undefined: peerTable`, `peerRouter`, `p2pHub`, `peerStream`, `newDatagramPipe`.

- [x] **Step 3: Write `peerStream` — the serialized half**

Create `x/handler/tun/peerstream.go`:

```go
package tun

import (
	"net"
	"sync"
)

// peerStream is one inbound stream from one peer. Writes are serialized
// because the underlying frame conn serializes only its read buffer: two
// concurrent writes interleave a header with somebody else's payload.
type peerStream struct {
	key  string
	conn net.Conn

	wmu sync.Mutex
	one sync.Once
}

func newPeerStream(key string, conn net.Conn) *peerStream {
	return &peerStream{key: key, conn: conn}
}

func (s *peerStream) Write(p []byte) (int, error) {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	return s.conn.Write(p)
}

func (s *peerStream) Read(p []byte) (int, error) { return s.conn.Read(p) }

func (s *peerStream) Close() error { return s.conn.Close() }

// close retires the stream once, so a peer's teardown runs a single time.
func (s *peerStream) close() { s.one.Do(func() { s.conn.Close() }) }
```

- [x] **Step 4: Write `peerRouter` — name to stream**

`x/handler/tun/p2p.go`, first half:

```go
package tun

import (
	"errors"
	"net"
	"sync"
)

var (
	// ErrNoRoute is a packet whose destination no peer registered. Expected
	// while a registration is in flight, and a symptom when it persists.
	ErrNoRoute = errors.New("tun: no route")
)

// peerRouter resolves a route's name — a peer key — to the stream that peer is
// currently reachable on. A reconnect replaces the stream under a key without
// touching the key, which is what lets a route outlive a link.
type peerRouter struct {
	table *peerTable

	mu      sync.RWMutex
	streams map[string]*peerStream
}

// install makes key's stream the one its routes resolve to, replacing any
// stream already under that key.
func (r *peerRouter) install(s *peerStream) {
	r.mu.Lock()
	r.streams[s.key] = s
	r.mu.Unlock()
}

// stream returns the peer key's current stream, or nil.
func (r *peerRouter) stream(key string) *peerStream {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.streams[key]
}

// withdraw removes s if it is still the stream holding key. A stream that has
// already been replaced — a peer that reconnected — must not take the live
// one's routes with it, so teardown withdraws only what it still owns.
func (r *peerRouter) withdraw(s *peerStream) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.streams[s.key] != s {
		return false
	}
	delete(r.streams, s.key)
	return true
}

// deliver writes a packet on the stream its destination names.
func (r *peerRouter) deliver(dst net.IP, pkt []byte) error {
	key, ok := r.table.lookup(dst)
	if !ok {
		return ErrNoRoute
	}
	s := r.stream(key)
	if s == nil {
		return ErrNoRoute
	}
	_, err := s.Write(pkt)
	return err
}
```

- [x] **Step 5: Write `p2pHub` — one device reader, one write lock**

`x/handler/tun/p2p.go`, second half:

```go
// p2pHub is the p2p hub's engine: one loop reads the device and dispatches by
// destination, and every write goes through one mutex. The device shares its
// buffers across calls with no lock of its own, so it admits one reader and
// one writer — the same shape as the socket server, which gets there by
// construction rather than by a bridge per stream.
type p2pHub struct {
	device io.ReadWriter
	router *peerRouter
	warn   func(string)

	dmu sync.Mutex // serializes writes to the device
	wg  sync.WaitGroup

	stopOnce sync.Once
	closed   chan struct{}
}

func newP2PHub(device io.ReadWriter, router *peerRouter, warn func(string)) *p2pHub {
	return &p2pHub{device: device, router: router, warn: warn, closed: make(chan struct{})}
}

// run reads the device for as long as the hub lives. One goroutine, always:
// which stream a packet was read on carries no meaning, because the route is
// what says where it goes.
func (h *p2pHub) run() {
	buf := make([]byte, MaxMessageSize)
	for {
		n, err := h.device.Read(buf)
		if n > 0 {
			h.dispatch(buf[:n])
		}
		if err != nil {
			return
		}
		select {
		case <-h.closed:
			return
		default:
		}
	}
}

func (h *p2pHub) stop() { h.stopOnce.Do(func() { close(h.closed) }) }

// dispatch delivers one device packet to the peer its destination names.
func (h *p2pHub) dispatch(pkt []byte) {
	dst, ok := destinationOf(pkt)
	if !ok {
		return
	}
	if err := h.router.deliver(dst, pkt); err != nil {
		// Named, not just counted: a spoke whose registration never arrived
		// looks exactly like this, and is otherwise indistinguishable from
		// silence.
		h.warnf("no route for %s, packet discarded", dst)
	}
}

// fromSpoke handles one datagram a spoke sent: a keepalive is answered, and
// anything else is written to the device.
func (h *p2pHub) fromSpoke(pkt []byte) error {
	if isKeepaliveFrame(pkt) {
		return h.answerKeepalive(pkt)
	}
	h.dmu.Lock()
	defer h.dmu.Unlock()
	_, err := h.device.Write(pkt)
	return err
}

// answerKeepalive registers the sender and replies, so a spoke running
// keepalive:true sees its deadline refreshed instead of expiring. Repeats are
// registered too and cost nothing: there is no TTL to refresh, because a
// stream closing reports a departure exactly.
func (h *p2pHub) answerKeepalive(pkt []byte) error {
	// The peer key travels in the frame's own header on a p2p link, so the
	// stream this arrived on is the identity being registered.
	s := h.current
	if s == nil {
		return ErrNoRoute
	}
	if _, ok := h.router.table.onKeepalive(context.Background(), pkt, s.key, h.ownNets); !ok {
		return nil // refused: registration is dropped, and silence says so
	}
	_, err := s.Write(keepAliveReply(s.key))
	return err
}

// deviceFromDevice writes a packet onto the device, for the test that seeds
// one without a real device.
func (h *p2pHub) deviceFromDevice(pkt []byte) (int, error) {
	h.dmu.Lock()
	defer h.dmu.Unlock()
	return h.device.Write(pkt)
}

// peerGone retires a stream: if it is still the one holding its key, its peer's
// routes go with it.
func (h *p2pHub) peerGone(s *peerStream) {
	s.close()
	if h.router.withdraw(s) {
		h.router.table.dropPeer(s.key)
	}
}
```

That draft does not compile — `h.current`, `h.ownNets` and `h.dispatcher` are
not real. The handler owns those, so they arrive in Step 6. Add now what is real,
and leave the handler's fields to Step 6:

```go
// isKeepaliveFrame reports whether a datagram from a spoke is a registration
// or keepalive rather than an IP packet.
func isKeepaliveFrame(b []byte) bool {
	return len(b) > keepAliveHeaderLength && bytes.Equal(b[:4], magicHeader)
}

// keepAliveReply builds the hub's answer. The socket server echoes the sender's
// address back; a p2p stream's peer key is what the route is named, so the key
// is what goes in the header.
func keepAliveReply(peerKey string) []byte {
	b := make([]byte, keepAliveHeaderLength)
	copy(b[:4], magicHeader)
	copy(b[4:20], []byte(peerKey))
	return b
}

// destinationOf parses a packet's destination, for IPv4 and IPv6 alike.
func destinationOf(pkt []byte) (net.IP, bool) {
	if waterutil.IsIPv4(pkt) {
		h, err := ipv4.ParseHeader(pkt)
		if err != nil {
			return nil, false
		}
		return h.Dst, true
	}
	if waterutil.IsIPv6(pkt) {
		h, err := ipv6.ParseHeader(pkt)
		if err != nil {
			return nil, false
		}
		return h.Dst, true
	}
	return nil, false
}
```

Imports for `p2p.go`: `bytes`, `context`, `errors`, `io`, `net`, `sync`,
`"github.com/songgao/water/waterutil"`, `"golang.org/x/net/ipv4"`,
`"golang.org/x/net/ipv6"`.

- [x] **Step 6: Fix the two forward references with real fields**

`answerKeepalive` cannot reach for `h.current`: the hub serves many streams, and
the peer key is the stream the datagram arrived on. So the handler passes it:

```go
// fromSpoke handles one datagram that arrived on s: a keepalive is answered,
// anything else is written to the device. The peer key travels as an argument
// because the hub serves many streams at once and the frame itself carries no
// identity.
func (h *p2pHub) fromSpoke(s *peerStream, pkt []byte) error {
	if isKeepaliveFrame(pkt) {
		return h.answerKeepalive(s, pkt)
	}
	h.dmu.Lock()
	defer h.dmu.Unlock()
	_, err := h.device.Write(pkt)
	return err
}

// answerKeepalive registers the sender and replies, so a spoke running
// keepalive:true sees its deadline refreshed instead of expiring. Repeats
// register too and cost nothing: there is no TTL to refresh, because a stream
// closing reports a departure exactly.
func (h *p2pHub) answerKeepalive(s *peerStream, pkt []byte) error {
	if _, ok := h.router.table.onKeepalive(context.Background(), pkt, s.key, h.ownNets); !ok {
		return nil // refused: no route, and silence is the socket server's answer too
	}
	_, err := s.Write(keepAliveReply(s.key))
	return err
}
```

Add the field the own-address filter needs:

```go
type p2pHub struct {
	device io.ReadWriter
	router *peerRouter
	warn   func(string)
	// ownNets are the hub device's own addresses. A registration claiming one
	// is the hub talking to itself, and routing to it would loop.
	ownNets []net.IPNet
	// …
}
```

and set it in `newP2PHub` by taking it as an argument:

```go
func newP2PHub(device io.ReadWriter, router *peerRouter, ownNets []net.IPNet, warn func(string)) *p2pHub {
	return &p2pHub{
		device:  device,
		router:  router,
		ownNets: ownNets,
		warn:    warn,
		closed:  make(chan struct{}),
	}
}
```

- [x] **Step 7: Write `datagramPipe`**

The device and a stream exchange whole datagrams, so a test can tell boundaries
apart. Create `x/handler/tun/datagrampipe_test.go`:

```go
package tun

import (
	"net"
	"sync"
	"time"
)

// datagramPipe hands each write to the reader as one message, so a test can
// tell datagram boundaries apart. A plain net.Pipe is a byte stream, which
// would let a test pass on a torn packet — exactly the failure the device
// guards against.
type datagramPipe struct {
	net.Conn

	mu     sync.Mutex
	queued [][]byte
	peer   *datagramPipe
}

func newDatagramPipe() (*datagramPipe, *datagramPipe) {
	a, b := net.Pipe()
	pa, pb := &datagramPipe{Conn: a}, &datagramPipe{Conn: b}
	pa.peer, pb.peer = pb, pa
	return pa, pb
}

func (c *datagramPipe) Write(p []byte) (int, error) {
	msg := make([]byte, len(p))
	copy(msg, p)
	c.peer.mu.Lock()
	c.peer.queued = append(c.peer.queued, msg)
	c.peer.mu.Unlock()
	return len(p), nil
}

func (c *datagramPipe) Read(b []byte) (int, error) {
	for {
		c.mu.Lock()
		if len(c.queued) > 0 {
			msg := c.queued[0]
			c.queued = c.queued[1:]
			c.mu.Unlock()
			return copy(b, msg), nil
		}
		c.mu.Unlock()
		// Poll rather than block, so a read deadline still applies: the hub's
		// read loop is a real loop and must be interruptible by one.
		time.Sleep(time.Millisecond)
	}
}
```

- [x] **Step 8: Write the handler that drives the hub**

`x/handler/tun/p2phandler.go`:

```go
package tun

import (
	"context"
	"net"

	"github.com/go-gost/core/auth"
	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/logger"
	md "github.com/go-gost/core/metadata"
	xlogger "github.com/go-gost/x/logger"
)

// NewP2PHandler creates the hub's handler. device is the tun device, already
// created by the listener; the device's own addresses come from the device
// conn's context, exactly as the socket server reads them from the conn it is
// handed. The handler owns the hub's device loop for its whole life.
func NewP2PHandler(device net.Conn, auther auth.Authenticator, opts ...handler.Option) handler.Handler {
	options := handler.Options{}
	for _, opt := range opts {
		opt(&options)
	}
	if options.Logger == nil {
		options.Logger = xlogger.Nop()
	}

	table := newPeerTable(auther, 0, options.Logger)
	router := &peerRouter{table: table, streams: make(map[string]*peerStream)}

	return &p2pTunHandler{
		router: router,
		hub:    newP2PHub(device, router, deviceOwnNets(device), options.Logger.Warnf),
		log:    options.Logger,
	}
}

// deviceOwnNets reads the device's own addresses off the conn the listener
// handed over. The listener put its config in the conn's context when it built
// it, so this is the same source the socket server's config.Net comes from —
// not a second parse of the same metadata, which could disagree with it.
func deviceOwnNets(device net.Conn) []net.IPNet {
	c, ok := device.(xctx.Context)
	if !ok {
		return nil
	}
	ctx := c.Context()
	if ctx == nil {
		return nil
	}
	if md := ictx.MetadataFromContext(ctx); md != nil {
		if cfg, _ := md.Get("config").(*tun_util.Config); cfg != nil {
			return cfg.Net
		}
	}
	return nil
}

type p2pTunHandler struct {
	hub    *p2pHub
	router *peerRouter
	log    logger.Logger
}

func (h *p2pTunHandler) Init(md md.Metadata) error { return nil }

// Handle bridges one accepted peer stream. The stream becomes the one its key's
// routes resolve to, replacing any earlier stream under that key; when it ends,
// it withdraws its peer's routes only if it is still the holder.
func (h *p2pTunHandler) Handle(ctx context.Context, conn net.Conn, opts ...handler.HandleOption) error {
	s := newPeerStream(conn.RemoteAddr().String(), conn)
	h.router.install(s)

	done := make(chan error, 1)
	go func() {
		buf := make([]byte, MaxMessageSize)
		for {
			n, err := s.Read(buf)
			if n > 0 {
				if werr := h.hub.fromSpoke(s, buf[:n]); werr != nil {
					h.log.Debugf("spoke %s: %v", s.key, werr)
				}
			}
			if err != nil {
				done <- err
				return
			}
		}
	}()

	var err error
	select {
	case err = <-done:
	case <-ctx.Done():
		err = ctx.Err()
	}

	// Teardown withdraws only if this stream still holds its key: a peer that
	// reconnected has already been replaced, and dropping routes now would cut
	// off the live one.
	h.hub.peerGone(s)
	return err
}

// Close stops the device loop. The service closes the handler on shutdown.
func (h *p2pTunHandler) Close() error {
	h.hub.stop()
	return nil
}
```

Imports: `context`, `net`, `core/auth`, `core/handler`, `core/logger`,
`core/metadata`, `xctx "x/ctx"`, `ictx "x/internal/ctx"`,
`tun_util "x/internal/util/tun"`, `xlogger "x/logger"`.

`newP2PHub` starts the device loop in its own goroutine — see Task 3 Step 5. The
loop's lifetime is the handler's, ended by `Close`.

- [x] **Step 9: Run the tests**

```bash
cd /config/workspace/go-gost/x && go test ./handler/tun/ -run 'TestP2P|TestPeerTable' -v 2>&1 | tail -30
```

Expected: PASS — 7 tests.

- [x] **Step 10: Run with the race detector**

```bash
cd /config/workspace/go-gost/x && CGO_ENABLED=1 go test -race ./handler/tun/ -run TestP2P -v 2>&1 | tail -30
```

Expected: PASS, no race reports. **This is the check the whole shape rests on** — the device is shared state and the race detector is what proves the single reader and the write lock are doing their job. A race here means the shape is wrong, not the test.

- [x] **Step 11: Commit**

```bash
cd /config/workspace/go-gost/x && git add handler/tun/ && git commit -m "tun: a p2p hub that reads the device once, and writes through one lock

The device shares d.rbufs[0] and d.wbuf across calls with no lock, so it
admits one reader and one writer — safe today only because each side
happens to have a single goroutine. Bridging each spoke's stream
straight to it would have had N of each, and the packets would have
interleaved. p2p's frame conn has the same hazard one layer down: it
serializes its read buffer but not its writes.

So the hub keeps the socket server's shape and gets there differently:
one loop reads the device and dispatches by destination, and every
write goes through one mutex. Which stream a packet was read on carries
no meaning, because the route is what says where it goes.

withdraw checks that the ending stream still holds its key. A peer that
reconnected already replaced it, and a teardown that dropped routes
without that check would cut off the live connection.

A packet with no route is warned about and named: a spoke with
keepalive:0 never registers on a p2p link, because the registration gate
tests for udp and a p2p link is ip, so it would otherwise be silent."
```

### Task 4: The compatibility suite

The spec's central claim is that a spoke cannot tell which hub it reached. That is only true if the same assertions hold against both implementations, so this suite is written once and driven twice.

**Files:**
- Create: `x/handler/tun/compat_test.go`

- [x] **Step 1: Write the failing test**

`x/handler/tun/compat_test.go`:

```go
package tun

import (
	"context"
	"net"
	"testing"
)

// The suite runs against both hub implementations. A spoke is configured the
// same way for each and must behave the same, so these assertions exist once
// and are driven twice — a per-implementation fork would let one drift away
// from the other and the compatibility claim would go untested.
type compatCase struct {
	name string
	// run drives one implementation and returns the peerTable it used,
	// plus a deliver function that sends a datagram for a destination IP.
	run func(t *testing.T) (router *peerTable, deliver func(dst net.IP, pkt []byte) error)
}

func compatCases() []compatCase {
	return []compatCase{
		{
			name: "socket",
			run: func(t *testing.T) (*peerTable, func(net.IP, []byte) error) {
				// The socket implementation's delivery is exercised through
				// the router it already has; see testSocketDelivery.
				return nil, nil
			},
		},
		{
			name: "p2p",
			run: func(t *testing.T) (*peerTable, func(net.IP, []byte) error) {
				// The peer router as Task 3 builds it: a table, a stream under
				// a key, and delivery that resolves a destination to that
				// stream.
				table := newPeerTable(nil, 0, xlogger.Nop())
				r := &peerRouter{table: table, streams: make(map[string]*peerStream)}

				dev, spoke := newDatagramPipe()
				t.Cleanup(func() { dev.Close(); spoke.Close() })
				r.install(newPeerStream("peer-a", spoke))

				return table, r.deliver
			},
		},
	}
}

// A registration with keepalive off registers a route: the spoke sends it on
// any udp link regardless of the setting.
func TestCompatRegistrationWithoutKeepalive(t *testing.T) {
	for _, c := range compatCases() {
		t.Run(c.name, func(t *testing.T) {
			r, _ := c.run(t)
			if r == nil {
				t.Skip("delivery under construction")
			}
			if _, ok := r.onKeepalive(context.Background(),
				keepAliveFrame("", net.IPv4(10, 10, 0, 2)), "peer-a", nil); !ok {
				t.Fatal("registration refused")
			}
			if _, ok := r.lookup(net.IPv4(10, 10, 0, 2)); !ok {
				t.Fatal("route missing after registration")
			}
		})
	}
}

// An unauthenticated registration registers nothing, on either.
func TestCompatUnauthenticatedRegistersNothing(t *testing.T) {
	for _, c := range compatCases() {
		t.Run(c.name, func(t *testing.T) {
			r, _ := c.run(t)
			if r == nil {
				t.Skip("delivery under construction")
			}
			r.auther = newTestAuther("secret")
			if _, ok := r.onKeepalive(context.Background(),
				keepAliveFrame("wrong", net.IPv4(10, 10, 0, 3)), "peer-a", nil); ok {
				t.Fatal("accepted a wrong passphrase")
			}
			if _, ok := r.lookup(net.IPv4(10, 10, 0, 3)); ok {
				t.Fatal("an unauthenticated peer got a route")
			}
		})
	}
}
```

- [x] **Step 2: Run the tests to verify the p2p half passes and the socket half is honestly skipped**

```bash
cd /config/workspace/go-gost/x && go test ./handler/tun/ -run TestCompat -v 2>&1 | tail -15
```

Expected: `p2p` subtests PASS, `socket` subtests report `SKIP: delivery under construction`. A skip is visible, which is the point — it says the claim is not yet fully tested rather than passing silently.

- [x] **Step 3: Fill in the socket case**

Replace the socket `run` body with a real one, and add the delivery it returns:

```go
		{
			name: "socket",
			run: func(t *testing.T) (*peerTable, func(net.IP, []byte) error) {
				r := newPeerTable(nil, 0, nil)
				// A UDP socket pair stands in for the hub's: the router names
				// an address, and delivery writes to it there.
				hub, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { hub.Close() })
				return r, func(dst net.IP, pkt []byte) error {
					key, ok := r.lookup(dst)
					if !ok {
						return ErrNoRoute
					}
					addr, err := resolveUDPAddr(key)
					if err != nil {
						return err
					}
					_, err = hub.WriteTo(pkt, addr)
					return err
				}
			},
		},
```

Now both subtests run. Re-run and expect all PASS — **no skips**.

- [x] **Step 4: Add the peer-to-peer routing case**

Append to `compat_test.go`:

```go
// A datagram is routed to the peer that registered the destination IP. This is
// the property the p2p hub exists for, and the socket hub must keep it.
func TestCompatRoutesByDestinationIP(t *testing.T) {
	for _, c := range compatCases() {
		t.Run(c.name, func(t *testing.T) {
			r, deliver := c.run(t)
			if deliver == nil {
				t.Skip("delivery under construction")
			}
			r.onKeepalive(context.Background(),
				keepAliveFrame("", net.IPv4(10, 10, 0, 7)), "peer-a", nil)

			if err := deliver(net.IPv4(10, 10, 0, 7), []byte("hello")); err != nil {
				t.Fatalf("deliver: %v", err)
			}
		})
	}
}
```

- [x] **Step 5: Run the whole package**

```bash
cd /config/workspace/go-gost/x && go build ./... && go vet ./...
cd /config/workspace/go-gost/x && go test ./handler/tun/ -v 2>&1 | tail -30
```

Expected: all PASS, **zero SKIP**.

- [x] **Step 6: Commit**

```bash
cd /config/workspace/go-gost/x && git add handler/tun/compat_test.go && git commit -m "tun: one compatibility suite, driven against both hubs

A spoke is configured the same way for either hub, so the assertions
that make it so are written once and run twice. A per-implementation
fork would let the two drift apart and leave the compatibility claim
tested against only one of them.

The socket case skips until its delivery exists, so an untested half
shows as a skip rather than a pass."
```

---

### Task 5: The p2p hub in wisper

**Files:**
- Modify: `wisper/tunnel/tun.go`
- Test: `wisper/tunnel/tun_test.go`

- [ ] **Step 1: Write the failing test**

Append to `wisper/tunnel/tun_test.go`:

```go
// A tun hub reaches its spokes over p2p, with no bind address of its own: the
// peer allowlist is the only thing it needs to serve.
func TestTunTunnelHasNoBindAddress(t *testing.T) {
	s := NewTunTunnel(EndpointOption(""), NetOption("10.10.0.1/24")).(*tunTunnel)
	s.opts.Peers = []string{"peer-a", "peer-b"}

	if err := s.init(); err != nil {
		t.Fatal(err)
	}
	if len(s.config.Peers) != 2 {
		t.Fatalf("allowlist = %v, want both peers", s.config.Peers)
	}
}

// A hub carried over from the socket form says why it stopped working rather
// than silently changing meaning.
func TestTunTunnelRejectsBindAddress(t *testing.T) {
	s := NewTunTunnel(EndpointOption("127.0.0.1:8421"), NetOption("10.10.0.1/24")).(*tunTunnel)
	s.opts.Peers = []string{"peer-a"}

	if err := s.init(); err == nil {
		t.Fatal("a hub accepted a bind address")
	}
}

// A hub with no allowlist serves nothing, so it is rejected at construction
// rather than running and discarding every packet.
func TestTunTunnelRequiresPeers(t *testing.T) {
	s := NewTunTunnel(EndpointOption(""), NetOption("10.10.0.1/24")).(*tunTunnel)

	if err := s.init(); err == nil {
		t.Fatal("a hub accepted an empty allowlist")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /config/workspace/go-gost/wisper && go test ./tunnel/ -run TestTunTunnelHasNoBindAddress -v 2>&1 | head -15
```

Expected: compile failure — `s.config` has no field `Addr`/`Peers`, or `init` is unexported and does not exist as written.

- [ ] **Step 3: Rewrite `init`**

Replace `tunnel/tun.go`'s `init` with one that describes a p2p hub — the device plus the p2p route, and no service config for a socket:

```go
// init describes the hub: the device it creates, and the p2p route its spokes'
// datagrams arrive on. It binds no address — a peer's datagrams reach the
// device over the p2p host directly, so there is no socket and no endpoint
// for a paired p2p tunnel to repeat.
func (s *tunTunnel) init() error {
	if strings.TrimSpace(s.opts.Endpoint) != "" {
		return fmt.Errorf("tun hub no longer binds an address: clear the endpoint, or use the socket form")
	}
	if len(s.opts.Peers) == 0 {
		return errors.New("tun hub requires at least one allowlisted peer")
	}
	s.config = &tunHubConfig{
		Peers: append([]string(nil), s.opts.Peers...),
	}
	return nil
}
```

Add the type and its fields near the top of the file:

```go
// tunHubConfig is what a hub needs beyond its options: the allowlist that
// admits peers. A tun hub used to be a config.ServiceConfig with an Addr;
// it no longer is.
type tunHubConfig struct {
	Peers []string
}
```

- [ ] **Step 4: Rewrite `Run` to accept from the p2p host**

Replace `Run`'s body after the log setup with:

```go
	pStats := xstats.NewStats(false)
	{
		prev := s.Stats()
		pStats.Add(stats.KindInputBytes, int64(prev.InputBytes))
		pStats.Add(stats.KindOutputBytes, int64(prev.OutputBytes))
		pStats.Add(stats.KindTotalConns, int64(prev.TotalConns))
		pStats.Add(stats.KindTotalErrs, int64(prev.TotalErrs))
	}

	// The device: this is the only privileged part, and it is unchanged.
	listenerLogger := log.WithFields(map[string]any{"kind": "listener", "listener": "tun"})
	ln := tunlistener.NewListener(
		listener.LoggerOption(listenerLogger),
		listener.StatsOption(pStats),
	)
	if err = ln.Init(mdx.NewMetadata(s.listenerMetadata())); err != nil {
		return
	}

	// The spokes: one datagram stream each, straight from the p2p host.
	peerLn, err := p2pHost.register(s.config.Peers)
	if err != nil {
		ln.Close()
		log.Error(err)
		return
	}

	var auther auth.Authenticator
	if s.opts.Username != "" {
		auther = xauth.NewAuthenticator(xauth.AuthsOption(map[string]string{s.opts.Username: s.opts.Password}))
	}

	handlerLogger := log.WithFields(map[string]any{"kind": "handler", "handler": "tun"})
	h := tunhandler.NewP2PHandler(ln, auther,
		handler.LoggerOption(handlerLogger),
	)
	if err = h.Init(mdx.NewMetadata(s.handlerMetadata())); err != nil {
		p2pHost.unregister(peerLn)
		ln.Close()
		return
	}

	s.forward = xservice.NewService(s.opts.Name, peerLn, h,
		xservice.LoggerOption(log),
		xservice.StatsOption(pStats),
	)
```

- [ ] **Step 5: Update `Close`**

```go
func (s *tunTunnel) Close() error {
	defer func() {
		select {
		case <-s.cclose:
		default:
			close(s.cclose)
		}
	}()

	if s.ln != nil {
		p2pHost.unregister(s.ln)
	}
	if s.forward != nil {
		return s.forward.Close()
	}
	return nil
}
```

Add the field:

```go
type tunTunnel struct {
	opts    Options
	config  *tunHubConfig
	forward service.Service
	ln      net.Listener // the p2p route, released on Close
	// …existing fields unchanged
}
```

- [ ] **Step 6: Build, vet, and test**

```bash
cd /config/workspace/go-gost/wisper && go build ./... && go vet ./...
cd /config/workspace/go-gost/wisper && CGO_ENABLED=1 go test -count=1 -p 1 ./tunnel/ -v -run Tun 2>&1 | tail -20
```

Expected: build and vet clean; all `TestTunTunnel*` pass, including the two restored in phase 1 — `TestTunTunnelRunRequiresEndpoint` must be **updated**, not deleted: it asserted a missing endpoint was an error, and the endpoint is now forbidden instead. Change it to assert the new rule:

```go
// A hub no longer binds an address, so an endpoint is a configuration error
// rather than a missing requirement.
func TestTunTunnelRunRejectsEndpoint(t *testing.T) {
	s := NewTunTunnel(EndpointOption("127.0.0.1:8421"), NetOption("10.10.0.1/24"))
	s.opts.Peers = []string{"peer-a"}
	if err := s.Run(); err == nil {
		t.Fatal("a hub accepted a bind address")
	}
}
```

- [ ] **Step 7: Commit**

```bash
cd /config/workspace/go-gost/wisper && git add tunnel/tun.go tunnel/tun_test.go && git commit -m "tunnel: a tun hub reaches its spokes over p2p, with no address to bind

The hub bound a UDP socket and needed a p2p tunnel whose endpoint
repeated that address — the one thing a user had to get right by hand.
Its spokes' datagrams already arrive as one stream per peer, so the
socket was a way of not noticing.

The allowlist is now the whole configuration. An endpoint set is
rejected rather than ignored, so a hub carried over from the socket
form says why it stopped working instead of silently changing meaning.

Device creation is untouched: this is still the privileged half."
```

---

### Task 6: The UI drops what no longer applies

**Files:**
- Modify: `wisper/web-src/src/pages/tunnel-detail-page.ts`
- Modify: `wisper/web-src/src/i18n/en.ts`, `wisper/web-src/src/i18n/zh.ts`

- [ ] **Step 1: Remove the bind-address field from the tun hub form**

In `tunnel-detail-page.ts`, delete the `endpoint` form group from the `tun` branch — the hub has no endpoint — and delete the `keepalive` and `ttl` controls, which no longer mean anything on this path.

- [ ] **Step 2: Replace the hint text**

`en.ts`: `tunHubHint` becomes

```ts
  tunHubHint:
    'This device is the network: spokes join it as ordinary tun clients over p2p. Add their public keys to the allowlist; a spoke that is not listed is refused before any dial.',
```

`zh.ts`:

```ts
  tunHubHint:
    '设备就是网络本身：各 spoke 用标准 tun 客户端经 p2p 接入。把它们的公钥加进允许列表，未列出的 key 在拨号前就会被拒绝。',
```

- [ ] **Step 3: Build the web and typecheck**

```bash
cd /config/workspace/go-gost/wisper && make web
cd /config/workspace/go-gost/wisper/web-src && npx tsc --noEmit
```

Expected: `make web` succeeds; `tsc` exits 0.

- [ ] **Step 4: Commit**

```bash
cd /config/workspace/go-gost/wisper && git add web-src/ web/ && git commit -m "web: a tun hub form asks for peers, not for an address

The bind address was the only thing on this form a user could get
wrong, and it is the one thing the p2p hub no longer has. Keepalive and
ttl went with it: the frame still registers a spoke, but nothing on
this side tunes it now."
```

---

### Task 7: End-to-end proof, and the release order

Unit tests prove the router, not the network. This is the only check that a real spoke reaches a real device.

**Files:** none (verification only)

- [ ] **Step 1: Publish `x/` first — the pin must resolve**

```bash
cd /config/workspace/go-gost/x && git log --oneline -1
cd /config/workspace/go-gost/x && git tag v<next> && git push origin master --tags
```

Read `<next>` from the module's current version (`go.mod` / the last tag), not from memory. **wisper's CI checks out its module alone, so a pin to an unpushed tag fails at test.**

- [ ] **Step 2: Bump wisper's pin and verify with the workspace off**

```bash
cd /config/workspace/go-gost/wisper && go get github.com/go-gost/x@<next>
cd /config/workspace/go-gost/wisper && GOWORK=off go build ./... && GOWORK=off go vet ./...
cd /config/workspace/go-gost/wisper && GOWORK=off CGO_ENABLED=1 go test -count=1 -p 1 ./...
```

Expected: all pass **with `GOWORK=off`**. If the tag is not published yet, this is where it fails — that ordering is the whole point of Step 1.

- [ ] **Step 3: Run the two-device e2e**

In a privileged container (the memory note on `p2p-e2e-nested-netns` applies — a nested netns is blocked here), with a real derper and both `gost` and `wisper` built from this tree:

```bash
cd /config/workspace/go-gost/wisper && make ui-test   # if the UI is in scope for this check
```

The e2e must assert, with the spoke built as the **unmodified** `tunnel/entrypoint/tun.go`:

1. ping hub → spoke and spoke → hub, both directions.
2. `keepalive:true` and `keepalive:false` on the spoke — the two settings the socket hub had to support. Both must hold a session; if `keepalive:true` dies, the keepalive answer is missing.
3. A second spoke joining and leaving, asserting its routes are reclaimed and the first spoke's survive.

Expected: all three. If (2) fails, the hub registered the route but did not answer the keepalive — the compatibility gap the spec calls out.

- [ ] **Step 4: Commit the pin bump**

```bash
cd /config/workspace/go-gost/wisper && git add go.mod go.sum && git commit -m "build: require go-gost/x v<next> for the p2p tun hub"
```

---

## Self-review

**Spec coverage.** Routing and authentication preserved → Tasks 1-2 (extracted unchanged), Task 4 (asserted on both). Keepalive answered → Task 2 keeps the reply, Task 7 step 3.2 is the e2e that would catch its absence. Spoke cannot tell the hubs apart → Task 4's suite, Task 7.3. Route value is a string → Task 1. p2p unmodified → no task touches `p2p/`; Task 5 consumes `p2pHost.register`. Socket server keeps its behavior → Task 2's guard, plus Task 4's socket case. No bind address → Task 5.3 rejects one, Task 6 drops the field. Stream close reclaims → Task 3. UI copy → Task 6. Release order → Task 7.

**Gaps I know about, deliberately left.** No privileged e2e can run in this environment (userns is blocked), so Task 7.3 is written to be run elsewhere rather than claimed as done. `scripts/smoke-tun.sh`'s wisper-hub variant was not revived in phase 1 and is not revived here; Task 7.3 is its replacement.

**Type consistency.** `peerTable` / `newPeerTable(auther auth.Authenticator, ttl time.Duration, log logger.Logger)` / `onKeepalive(ctx, frame, from, ownNets)` / `lookup(dst)` / `set(ip, name)` / `dropPeer(name)` are defined once in Task 1 and used by Tasks 2, 3, 4 with those signatures. In Task 3, `peerRouter` holds a `*peerTable` plus `streams map[string]*peerStream` and exposes `install` / `stream` / `withdraw` / `deliver`; `p2pHub` is `newP2PHub(device io.ReadWriter, router *peerRouter, ownNets []net.IPNet, warn func(string))` with `run` / `stop` / `dispatch` / `fromSpoke(s, pkt)` / `answerKeepalive(s, pkt)` / `peerGone(s)`; `peerStream` wraps one conn with a write mutex and a `close()` that runs once. `resolveUDPAddr(name)` is defined in Task 2 and used in Task 4. `keepAliveFrame` and `newTestAuther` are test helpers from Task 1, used in Tasks 3 and 4.

**Resolved during self-review.** The first draft of Task 3 gave every stream its own device reader and writer, which is wrong — `tunDevice` shares `d.rbufs[0]` and `d.wbuf` with no lock, so N streams means N readers and N writers and the packets interleave. p2p's `frameConn.Write` has the same hazard one layer down. Task 3 now has one device read loop and one write mutex, which is the socket server's shape reached a different way, and Step 10 runs it under `-race`, which is the check that proves the shape rather than the test. Two facts found while checking are in the spec: a reconnect brings a new stream under the same peer key (so `withdraw` checks it still holds the key), and a spoke with `keepalive:0` never registers on a p2p link (so an unroutable packet is warned about and named).