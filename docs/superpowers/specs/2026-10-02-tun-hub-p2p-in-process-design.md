# tun hub over p2p, in-process

**Date:** 2026-10-02
**Status:** design approved, not implemented. Supersedes the bridge-only version of this spec (same date, commit 964885e).
**Scope:** phase 2. Phase 1 (restoring the tun hub tunnel type) is landed and verified.

## Problem

A tun hub — the node holding the tun device — is reachable only if each spoke's
datagrams reach that device. Today they arrive over a local UDP socket: the
paired p2p tunnel's endpoint must equal the tun server's bind address, and a
user has to keep the two aligned by hand. `docs/tun-integration.md` describes the
manual path. Ordinary users cannot do that from the UI.

The socket is not what makes the routing work. The tun server routes a datagram
by parsing its IP header, looking up the destination in a table the spokes
register themselves into with a keepalive frame, and writing to that route. What
arrives on that route is incidental — a UDP address today, but it could be a p2p
peer connection. Keeping the router and dropping only the socket removes the
address from the deployment without weakening anything.

## Shape

```
  spoke A stream ──┐   ┌─────────────────────────────┐
  spoke B stream ──┼──→│  x/handler/tun: the router  │──→ tun device
  spoke C stream ──┘   │  dst-IP → route, keepalive  │
                       │  auth, TTL expiry           │
                       └─────────────────────────────┘
```

The hub **replaces** the socket tun server; it does not sit beside it. A tun hub
reached over ordinary UDP keeps using `x/handler/tun`'s existing socket server —
that code is untouched. What changes is that a p2p-reached hub no longer needs
one.

## Routing and authentication are preserved

This is the load-bearing requirement. The p2p hub is a router with the same
semantics as the socket server, not a bridge:

## Keepalive declares an address; it does not keep the route alive

The keepalive frame stays, and it stays because it carries something p2p cannot
know. The route table is keyed by an IP **on the peer's device**; p2p knows a
peer's public key. Nothing else in the system knows which tun-network address
that peer configured, so the spoke has to say so — and that is what the keepalive
frame does.

What changes is everything else the keepalive was doing on the socket server.

| | socket server | p2p hub |
|---|---|---|
| keepalive declares the peer's IP | yes | yes |
| keepalive refreshes a route's TTL | yes | **no** |
| a departed peer is noticed by | a TTL guessing it is gone | the stream closing |
| `keepalive` / `ttl` options | meaningful | **meaningless** |

p2p reports a peer's departure exactly, when the stream closes, rather than
inferring it from silence. A stream carries its peer's key in its remote address
(`peerOf`, `tunnel/p2p_host.go:506`), so closing one identifies exactly which
routes to drop.

So on a p2p hub `keepalive` and `ttl` are not configuration: the frame is always
sent because it is an address declaration, and there is no interval to tune. The
UI does not offer them.

### Route reclamation is now mandatory

The socket server reclaims lazily: `liveRoute` expires a route when it is next
consulted and the TTL has passed. The p2p hub has no TTL, so a route lives until
its stream closes — which makes **closing a stream and dropping every route that
peer registered the only reclamation path**.

This is a real constraint, not a detail. If that cleanup does not happen, the
route table grows for the life of the process; there is no TTL to catch it. The
stream teardown is where it goes, and it is the one thing a test must cover:
close a peer's stream, assert its routes are gone and another peer's are not.
- **Destination routing.** A datagram from the device is parsed, its
  destination looked up, and delivered to the route for it. A packet with no
  route is discarded and logged. Unchanged.
- **Source routing.** A datagram from a spoke is delivered to the route its
  destination names, same as on the socket server.

A spoke is still a stock GOST tun client. It registers with the same keepalive it
always sends, over a p2p tunnel with `ProtocolOption("udp")`. **No spoke code
changes.**

## x's shape: shared logic, two delivery implementations

The routing and authentication logic — keepalive magic-header parsing, auther
consultation, the route table with TTL expiry, destination lookup — is shared
and knows nothing about transport. What differs is how a packet is delivered
once the table has named its destination.

The route table is `map[tunRouteKey]string`: a destination **name**, not an
address. A `net.Addr` would be narrower than either implementation needs — it
fits a UDP endpoint and nothing else — and it would drag the transport into the
table that is supposed to be transport-blind. A name does not: the socket
implementation resolves it to an address, the p2p implementation resolves it to a
connection.

| | socket server | p2p hub |
|---|---|---|
| a route's value | the peer's UDP address | the peer's public key |
| resolving it | `net.ResolveUDPAddr` | a peer-key → stream map |
| delivering a packet | `conn.WriteTo(pkt, addr)` | write the datagram on the stream |

Both implementations are complete routers, and both are equally served by a
route table that stores a name.

This is also why the handler is not written in wisper: reimplementing the
keepalive protocol and the auther check there would put the same wire format in
two repositories, and the protocol's details (the magic header, the peer-IP
encoding) would drift.

### The one cost

Resolving a name per packet is free on the p2p side — the peer map is consulted
either way. On the socket side it is a `net.ResolveUDPAddr` per delivered
datagram: an allocation and a parse, in the order of a couple hundred
nanoseconds, against a device read that already costs a syscall. That is why the
socket implementation resolves per delivery rather than caching.

If it ever shows in a profile, the fix is local to that implementation: keep the
resolved address beside the name in its own map. Nothing shared changes.

## The seam

`p2pHostManager.register` already returns a `net.Listener` whose `Accept()`
yields one `net.PacketConn` per inbound peer stream, with the datagram framing
already parsed (`p2p/CLAUDE.md`: *"hands a udp tunnel stream over as a datagram
conn — net.PacketConn, one datagram per Read/Write"*). **p2p is not modified.**
The hub accepts from that listener and holds each accepted stream as a route's
destination.

Admission stays where it is: `register` refuses a peer key another tunnel already
holds, and `dispatch` closes an unregistered key before any dial
(`tunnel/p2p_host.go:488`).

## The device is one reader

A tun device has one read side, so the hub's device-read loop is single: read a
packet, look up its destination, deliver. This is exactly what the socket
server does — it is the same single loop, with a different route value.

## What is no longer required

A p2p-reached hub has no bind address. The tun hub's `endpoint` and the paired
p2p tunnel's endpoint no longer have to match, and the `validateTunTunnel`
endpoint checks do not apply to it.

## Boundaries

| Module | Change |
|---|---|
| `x/handler/tun/` | shared routing/auth extracted; a p2p delivery implementation added |
| `x/listener/tun/` | none — the device is unchanged |
| `p2p/` | none — the seam is consumed as-is |
| `wisper/tunnel/` | the hub type stops binding a socket and accepts from the p2p listener |
| `wisper/web-src/` | the hub form drops the bind-address field; copy states the model |

The socket server keeps its own route table of UDP addresses and its own
delivery. It is the right answer for a hub reached over ordinary UDP and is not
weakened by this change.

## Testing

- **Unit (x, routing/auth)** — keepalive registers a route; an unauthenticated
  keepalive registers none; a packet with an unknown destination is discarded.
  These are the shared logic and they run once, against both delivery
  implementations. TTL expiry is asserted separately, against the socket
  implementation only — the p2p implementation has no TTL.
- **Unit (x, p2p reclamation)** — close a peer's stream and assert its routes
  are dropped while another peer's are not. This is the p2p implementation's
  only reclamation path.
- **Unit (x, p2p delivery)** — a fake peer conn; a datagram read from the device
  reaches the peer named by its destination IP, and a peer's datagram reaches
  the device.
- **Unit (wisper)** — the hub type accepts from the p2p listener and reports
  status; the existing `TestTunTunnel*` suite still passes.
- **e2e** — privileged container, two real devices, a real p2p link, ping both
  ways, and a spoke joining and leaving to exercise registration and expiry.
  This is the only check that proves real IP routing works; unit tests cannot.

## Risks

- **x restructure.** Extracting the shared logic touches the socket server's
  code path. Its behavior must not change; the socket server's own tests are
  the guard. This is the one place the change can affect existing behavior.
- **Single reader throughput.** One loop reads the device and delivers. The
  socket server has the same shape, so this is not a regression, but it is the
  thing to watch under load.
- **Route table lifetime.** A p2p hub has no TTL, so reclamation rests entirely
  on the stream-teardown path. That path is more accurate than the TTL it
  replaces — it drops a peer's routes when the peer is known to be gone rather
  than up to `3 × ttl` later — but it is also the only mechanism, so a missed
  teardown grows the table unbounded rather than merely lagging.