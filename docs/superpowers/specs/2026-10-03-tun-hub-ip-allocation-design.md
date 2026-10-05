# A tun hub allocates its spokes' addresses

**Date:** 2026-10-03
**Status:** design approved, not implemented.
**Scope:** phase 3 of the tun hub. Phase 1 (restoring the hub tunnel type) and
phase 2 (routing it in-process over the shared p2p host, `2026-10-02`) are landed.

## Problem

A p2p hub already authenticates its spokes. `p2pHandler.Handle` keys each
accepted stream by `conn.RemoteAddr().String()` — the base64 peer key — and the
peer allowlist is what routed that stream here in the first place. A spoke that
reaches this handler has therefore already proved which host it is.

What the hub cannot know is **which address that host is entitled to hold**. The
only thing that knows a tun-network address is the peer, so the spoke declares it
in the registration handshake and the hub believes it. Nothing checks the claim,
so an allowlisted spoke may claim an address that belongs to a different spoke,
and `peerTable.set` takes it over: `LoadOrStore` finds the address already
present, overwrites the entry, and the route now points at the wrong stream.
`dropPeer` then reclaims by peer key, so the rightful owner's route never comes
back — one misconfigured or hostile spoke silently blacks out another.

The obvious fix is to give each spoke a shared secret. That adds a second
credential for the operator to create, copy to the other machine, rotate and
store, to answer a question the p2p key has already answered.

## Identity is the peer key; the missing half is authorization

Split what admission currently conflates:

| | today | after |
|---|---|---|
| **authentication** — which host is this? | the p2p peer allowlist | unchanged |
| **authorization** — may it hold *this* address? | nothing checks it | the hub's own assignment |

The hub becomes the allocator of record. Each allowlist row names the addresses
that peer may claim. The claim is then checked against the row that owns the
stream it arrived on, which needs no secret at all.

## Why a new hook rather than the auther

`peerTable.onKeepalive` already receives the sender's name — `from`, a
`host:port` for a socket peer and a peer key for a p2p one — and both transports
call it. It is the natural place for the rule, and it is the only place that has
both halves.

`auth.Authenticator` cannot do this job. `onKeepalive` calls

```go
pt.auther.Authenticate(ctx, ip.String(), string(key), auth.WithService(pt.service))
```

and `core/auth.Options` carries only `Service`. The peer key never reaches an
auther, so a wisper auther cannot tell *who* is claiming and could not bind a
claim to a peer even if the shape suited it. Adding a field to `core/auth` is out
of bounds (`core/` is interfaces-only and frozen), and passing the peer key in
the frame's spare 16 key bytes would be abusing a wire field to carry identity
into a local call.

So the rule gets its own interface, in the same structural-matching spirit as
`registry.P2PRegistry().Register(name, host.Provider())`:

```go
// x/handler/tun
// PeerAuthorizer decides whether the peer that sent a registration may claim the
// addresses in it.
type PeerAuthorizer interface {
    Authorize(ctx context.Context, peer string, ips []net.IP) bool
}
```

The interface lives on `peerTable`, beside `onKeepalive`, so it is
transport-agnostic by construction. Only the **p2p** path can supply one today:
a `tunHandler` is built from metadata by the registry and has nowhere to receive
an authorizer, and giving it a place would mean a `core/handler` field. The
socket path therefore passes nil and behaves exactly as it does now — which is
why the socket deployment's address checking remains whatever it has always
been, and why this spec claims a hook and not a fix for both.

## Shape

```
   registration frame                      x/handler/tun
   ┌────────────────────────┐            ┌──────────────────────────────┐
   │ "GOST" + key + [IPs]   │───────────→│ self-loop guard              │
   └────────────────────────┘            │   ↓                          │
                                         │ PeerAuthorizer.Authorize  ← NEW
                                         │   ↓  (refuse → no reply)     │
                                         │ auther (socket deployments)   │
                                         │   ↓                          │
                                         │ peerTable.set(ip → peer)      │
                                         └──────────────────────────────┘
```

`Authorize` sits **after** the self-loop guard and **before** the auther: a claim
that is not this peer's to make needs no further credential check, and a plugin
auther may be an RPC to another process.

`onKeepalive` is the seam, so the hook is one call in shared code rather than two
call sites to keep in step. The `peer` it passes is the sender's name verbatim —
a `host:port` for a socket peer, a peer key for a p2p one — and the p2p hub's
`answerKeepalive` already supplies `s.key`.

## The check is an exact set, not a subset test

`Authorize` requires the claim to equal the assigned set — same addresses, same
count, no more.

A subset test ("every claimed address is assigned to this peer") would still let a
spoke that knows a neighbour's address register both its own and the neighbour's.
Because `peerTable.set` is last-writer-wins per address, that is the same
takeover the whole design exists to prevent, reached one step later. Exactness
costs nothing here: the claim is exactly `config.Net`, the same field the spoke
configured its device with, so the operator's assignment and the spoke's device
address are already the same string.

A row therefore holds a **comma-separated list**, not a single address, because
`net` may be a list and a spoke with two device addresses has to be expressible.
Auto-assignment fills one; a typed row may name several. An **empty** row is not
"any address" — it is *no* address, and any claim on it is refused.

## Addresses are host addresses, not prefixes

`x/listener/tun` splits `net` with `net.ParseCIDR` and keeps the **unmasked**
`ip` (`metadata.go:50-57`), because the device needs `addr=` to be the host
address while `net=` is the prefix. The client then registers `config.Net[i].IP`
— the host address, as typed.

So a hub row holds `"10.10.0.2"`, never `"10.10.0.2/24"`. A value with a slash is
rejected at save time with a message that says so, rather than silently matching
nothing at runtime.

## Allocation

Rows are filled from the hub's own subnet and may be overridden by hand.

- An **empty row** is assigned the next free host address in the hub's first
  subnet — skipping the hub's own address and every address already taken,
  whether auto-assigned or typed. Adding a second spoke therefore costs no
  typing, which is the case that actually happens.
- A **filled row** is never overwritten. The operator's number is the operator's.
- A typed address **outside every hub subnet** is refused on save, naming the
  peer. A row that could never match a spoke's device address is a typo, and the
  refusal is where a typo is cheap to fix.
- Two rows may not name the same address.

Removing a key drops its assignment, on the same terms as its alias and its
disabled flag: `NormalizePeerIPs` keeps only keys still listed, so a key removed
from the allowlist cannot linger in the config and come back assigned.
Re-adding the key therefore allocates a fresh address; the hub's row has to be
read again before the spoke is told, which is why the UI shows the assignment
rather than assuming it.

Allocation is a **save-time** convenience. Nothing hands an address to a spoke:
the spoke configures its own `net`, and the operator mirrors the hub's row into
it. Pushing the address down the wire would mean a protocol change to the reply
frame and a spoke re-configuring a live device — and the copy is checkable, which
the push is not (§ *Mismatch is an event*).

## Mismatch is an event, and the authorizer is what can report it

The operator copies an address, so the copy will eventually be wrong. Today a
mismatched spoke is indistinguishable from a hub that is not answering: the
refused frame is never echoed (`TestP2PRefusedKeepaliveIsNotAnswered`), and on a
p2p link the handshake is one-shot, so the spoke registers once, is refused, and
never asks again.

The hub's peer-route loop is not where that can be reported: it accepts a stream
and never parses a frame, so it cannot see what the spoke claimed. The authorizer
can, and it is the only party that holds all three facts — the peer key, the
addresses claimed, and what that peer was assigned. `spokeAuthorizer` therefore
does the reporting itself, from inside `Authorize`:

```go
log.Warnf("spoke %s claimed %v, assigned %v", peer, ips, assigned)
event.Record(hubID, event.LevelWarn, "spoke %s is assigned %s, claimed %s", peer, assigned, ips)
```

That is pure in-memory work — a map read and a set compare — so it cannot block
the way a plugin auther's external call could, and it needs no plumbing from x
back out to wisper. It fires once per handshake attempt, which on a p2p link is
once per stream.

## Live updates, and the one that does not happen for free

`NewP2PHandler` takes its authorizer **by value at construction**, so a
`PeerAuthorizer` that reads a live snapshot is what makes a save take effect
without rebuilding the hub — and therefore without re-creating the tun device,
which needs the privilege the hub was started with.

```go
// tunnel/tun_authorizer.go
// spokeAuthorizer authorizes against the hub's current assignment. The
// assignment is behind an atomic pointer because SetPeerIPs replaces it under a
// handler that was built once, at Run.
type spokeAuthorizer struct {
    hubID     string
    log       logger.Logger
    assigned  atomic.Pointer[map[string][]netip.Addr] // peer key → host addresses
}
```

`SetPeerIPs` swaps the pointer.

**This does not reach a spoke that is already registered.** On a p2p link
`keepAlivePeriod` is 0, so `client.go`'s `keepalive` writes the handshake once
and returns; there is no repeat to pick up a new assignment. A spoke whose
address changed must be stopped and started, which is one tap on the entrypoint
and is what the peers page says in place. Reclaiming needs no such thing —
`dropPeer` tears down by peer key the moment a stream closes.

## Saving: a second step, in a fixed order

`PeerSetter.SetPeers` keeps its signature. Its documented contract is that one
save is one all-or-nothing operation: the p2p routes reconcile first and the
options are swapped only if that succeeded. Changing the signature to carry the
addresses would give `p2pTunnel.SetPeers` a parameter it must ignore, and a
failed save could then strip a removed spoke's assignment while leaving its route
— a black hole with no rollback.

So a second, narrow interface is added and the REST handler calls both:

```go
// PeerIPSetter is implemented by a tunnel that allocates device addresses to
// its peers. A p2p tunnel does not: it has no device network to allocate from.
type PeerIPSetter interface {
    SetPeerIPs(ctx context.Context, peerIPs map[string]string) error
}
```

The value is the comma-separated address list as it is typed and stored, not the
parsed form: allocation and validation happen in the handler, and the tunnel only
hands the map to the authorizer, which parses it once per swap rather than on
every claim.

The order in `handleUpdateTunnelPeers` is load-bearing:

1. `SetPeers` — reconciles routes. **Can fail**, and on failure nothing else has
   run, so the pair is untouched.
2. `SetPeerIPs` — swaps an atomic pointer. **Cannot fail.**

Running them the other way round would leave a peer that still holds a route
whose assignment has just been withdrawn. The handler carries a comment saying
so.

## What replaces the dead `username`/`password` on a tun hub

`tunnel/tun.go` builds its auther as `AuthsOption{Username: Password}` and hands
it to `NewP2PHandler`. That auther is keyed on `Username`, while `onKeepalive`
supplies the **claimed device IP** as the user name — so it admits a spoke only
if an operator typed that spoke's IP into the tunnel's "username" field, and
refuses every other spoke. `tunnel/tun.go:263-266` is dead configuration that
reads as a feature.

It is removed, and `NewP2PHandler`'s `auther` parameter is replaced by
`authorizer`. Socket deployments keep `handler.AutherOption` and are untouched;
`peerTable` keeps its auther field and still consults it, after `Authorize`.

`Username`/`Password` remain on the shared `Options` struct — HTTP and file
tunnels use them for basic auth — and simply stop being read by the tun hub. This
is a silent behaviour change for anyone who set them, and the release note says
so rather than calling it a deprecation.

## Touchpoints

**x (`github.com/go-gost/x`)**

| File | Change |
|---|---|
| `handler/tun/authorizer.go` | new: the `PeerAuthorizer` interface |
| `handler/tun/router.go` | `peerTable.authorizer`; `withAuthorizer(...)` variadic on `newPeerTable`; the `Authorize` call in `onKeepalive` |
| `handler/tun/p2phandler.go` | `NewP2PHandler(device, authorizer, opts...)` — `auther` replaced |

`newPeerTable` takes the authorizer as a **variadic option** rather than a
parameter: it has 21 call sites in the package's tests and every one of them
means "no address authorization", which a nil parameter would say just as well
and much more loudly.

**wisper**

| File | Change |
|---|---|
| `config/config.go` | `Tunnel.PeerIPs map[string]string` (`peer_ips`) |
| `tunnel/tunnel.go` | `Options.PeerIPs`, `PeerIPsOption`, `NormalizePeerIPs`, the `PeerIPSetter` interface |
| `tunnel/tunip.go` | new: `parseHubNets`, `assignPeerIPs`, `validatePeerIP` |
| `tunnel/tun_authorizer.go` | new: `spokeAuthorizer` |
| `tunnel/tun.go` | build the authorizer from `PeerIPs`; hold it; `SetPeerIPs` |
| `api/tunnel_handler.go` | `peerJSON.ip`; validation on the peers PUT; the ordered two-step save |
| `web-src/src/pages/tunnel-peers-page.ts` | per-row address field with an "auto" action |
| `web-src/src/pages/entrypoint-detail-page.ts` | a hint that `net` must match the hub's assignment |
| `web-src/src/i18n/{en,zh}.ts` | strings for both |
| `docs/tun-integration.md` | replace the `username = spoke tun IP, password = spoke token` note |

The **spoke's Go code does not change**: it already configures `net` from its own
form, which is what the operator is copying.

## Tests

**x** — `Authorize` accepting and each way of refusing (unknown peer, wrong
address, an empty claim, a claim of several addresses when one was assigned); the
call order inside `onKeepalive` (authorizer before auther, both after the
self-loop guard); a nil authorizer refusing nothing, so the socket path is
provably untouched; the whole `peerTable` suite re-run to show the auther path is
unaffected.

**wisper** — auto-assign skipping the hub's own address, already-taken addresses
and hand-typed ones; a hand-typed address surviving a re-save; a typed address
outside every hub subnet refused; the same address on two rows refused;
`Authorize` end to end from `spokeAuthorizer`, including that it refuses rather
than throws on an unparseable claim; `SetPeerIPs` swapping the snapshot under a
live hub; and the API round trip, including that a `PUT /peers` whose route
reconcile fails leaves the assignments untouched.

## Not doing

- No change to `core/`. The rule is a new x-local interface, structurally matched.
- No credential. The peer key is the identity.
- No address lease, expiry or reclamation. A route is reclaimed when its stream
  closes, which is exact; an address outlives the spoke that held it until the
  row is removed, and re-adding the row allocates again.
- No pushing the address down the wire.
- No auto-assignment for a hub with no `net`: with no subnet to allocate from,
  every row must be typed.
- No validation on a p2p **tunnel**'s peers — it has no device network, so
  there is nothing to allocate.