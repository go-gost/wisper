# tun hub over p2p, in-process

**Date:** 2026-10-02
**Status:** design approved, not implemented
**Scope:** phase 2 only. Phase 1 (restoring the tun hub tunnel type, socket-based) is landed and verified.

## Problem

A tun hub — the node holding the tun device — is reachable only if each spoke's
datagrams reach that device. Today they arrive over a local UDP socket: the
paired p2p tunnel's endpoint must equal the tun server's bind address, and the
two are separate objects a user has to keep aligned by hand.

That alignment is the whole deployment burden. `docs/tun-integration.md`
describes the manual path — a gost tun server plus a p2p tunnel whose endpoint
repeats the server's address. Ordinary users cannot do that from the UI.

The data path does not need the socket. wisper's p2p host already delivers every
inbound stream as its own `net.PacketConn` (`statsPacketConn`,
`tunnel/p2p_host.go:603`), one per peer. The device only needs something that
reads and writes datagrams. Bridging each peer stream straight to the device
removes the socket, the address, and the alignment.

## Shape

```
  spoke A stream ──┐
  spoke B stream ──┼─→ peerListener.Accept() → device (io.ReadWriter)
  spoke C stream ──┘        each stream bridged both ways, independently
```

One goroutine pair per accepted stream, same as every other bridge in the repo.
No shared state, no per-peer table, nothing outlives the stream.

The handler runs in this repository (`wisper/tunnel/`). **`x/` and `p2p/` are not
touched** — see [Boundaries](#boundaries).

## The handler

`tunnel/tunp2p.go`, roughly:

```go
// tunP2PHandler bridges accepted p2p peer streams to a tun device. Each
// accepted stream is one spoke: datagrams from the stream are written to the
// device, and datagrams the device reads are written back to that same
// stream. A device read therefore lands on whichever spoke's goroutine reads
// it first — the device, not this handler, decides which spoke a datagram
// belongs to.
type tunP2PHandler struct {
	device io.ReadWriter
	stats  stats.Stats
}
```

Per accepted conn, two goroutines:

- **stream → device**: `conn.Read(buf)` then `device.Write(buf)`.
- **device → stream**: `device.Read(buf)` then `conn.Write(buf)`.

Either ending tears down that pair.

### Why this is not the socket version

`x/handler/tun/server.go` runs a **router**: it reads a datagram, parses the IP
header, looks up a route keyed by destination IP, and writes to that route's
address. Its peer set is maintained by a keepalive magic header
(`updateRoute`/`liveRoute`), which is also how a departed spoke's route expires.

This handler is a **bridge**, not a router. It does not parse IP headers, keeps
no route table, and has no keepalive. A datagram read from the device goes back
to the stream that was reading at the time.

The consequence is a real constraint on deployment, not an implementation detail:

> **The hub's device decides what a spoke can reach.** Spoke-to-spoke traffic
> only works if the device's own configuration routes it (a gateway-style
> `net`/`routes` setup). There is no hub-side route table to consult or debug.

This matches the original design intent — *"the device is the network"* — but
it is a different operational model from the socket tun server, and the UI must
say so.

## Boundaries

| Module | Change | Why |
|---|---|---|
| `wisper/tunnel/` | new handler + wiring | the consumer |
| `wisper/web-src/` | copy on the tun hub form | users must know the model |
| `x/` | **none** | |
| `p2p/` | **none** | |

`x/handler/tun/server.go` keeps its socket path, its route table, and its
keepalive exactly as they are. The socket tun server is untouched and remains
the right answer when a hub is reached over ordinary UDP rather than p2p. If
this design is wrong in the field, deleting `tunnel/tunp2p.go` reverts it with
no trace elsewhere.

p2p is untouched because the seam already exists: `p2pHostManager.register`
returns a `net.Listener` whose `Accept()` yields one `net.PacketConn` per peer
stream, and `x`'s listener wrapper already preserves the datagram shape. This
design consumes that seam rather than extending it — which is the same shape as
the file tunnel's in-process handler and the p2p tunnel's own `peerListener`.

## Wiring

A tun tunnel gains an option choosing its data path:

- `socket` (default, phase 1's behavior) — unchanged: `tunlistener` +
  `tunhandler`, binding the endpoint, paired with a p2p tunnel by address.
- `p2p` (new) — `tunlistener` for the device, plus `p2pHostManager.register` +
  the new handler. No bind address, so the tun hub's endpoint requirement and
  the `validateTunTunnel` endpoint checks apply only to the socket path.

The existing allowlist remains the admission: `register` refuses a peer another
tunnel already holds, and an unlisted key is closed before any dial
(`dispatch`, `p2p_host.go:488`).

## Spoke side

Unchanged. A spoke is a stock GOST tun client (`tunnel/entrypoint/tun.go`) over
a p2p tunnel with `ProtocolOption("udp")` — no spoke code changes at all.

The spoke's keepalive exists only to register its IP in the hub's route table.
With the p2p path there is no such table, so the hub ignores the frame and the
spoke's keepalive is inert. The spoke is not changed to stop sending it: it is
the same binary the socket path uses, and one code path for both is worth more
than the few wasted bytes. Removing it would be a separate change with its own
regression surface.

## Stats

Per-peer counters stay as they are: `statsPacketConn` already counts bytes and
conns per peer. The device-side direction is counted through the same stats
object, so the tunnel totals and the peers page keep working unchanged.

## Testing

- **Unit** — a `net.Pipe` stream against a fake device (`io.ReadWriter` over a
  buffer). Assert a datagram written to the stream reaches the device, and one
  read from the device reaches the stream. Both directions, and teardown.
- **Unit, multi-spoke** — two streams, one device; assert each stream's datagram
  reaches the device and the device does not see a torn datagram. Concurrent
  reads, `-race`.
- **Regression** — `TestTunTunnel*` and the socket path's tests must still pass
  unchanged. That is the check on "does not break the existing tun server."
- **e2e** — privileged container, two devices, real p2p link, ping both ways.
  This is the check that the bridge is correct with real IP traffic; the unit
  tests cannot prove it.

## Risks

- **Concurrent device reads.** Several spoke goroutines read one device
  concurrently. A tun device read is a datagram read, so each gets one packet
  and none is torn, but which goroutine receives which packet is not
  deterministic. If a spoke must only ever see its own traffic, this model is
  wrong — that is the gateway requirement above, and the e2e test is what
  settles it.
- **Liveness.** No route table means no keepalive-driven expiry, so a departed
  spoke is not detected by this layer. Detection moves to the peer link
  (p2p session teardown). Acceptable for v1; noted, not solved.
- **Gateway semantics.** The constraint in [Why this is not the socket
  version](#why-this-is-not-the-socket-version) is a deployment requirement, and
  if it proves inconvenient in the field the socket path remains available as
  the fallback.

## Resolved

- **Protocol selection is explicit.** A tun hub carries a `dataPath` option
  (`socket` | `p2p`). It is not inferred from anything: the device path and the
  transport are independent choices, and inferring one from the other would
  make the socket form impossible to express for a hub that is also reached over
  ordinary UDP.
- **Socket stays the default.** Phase 1 just landed and is verified; there is no
  field evidence for `p2p`, so defaulting away from the verified path would be
  the risky direction. Switching a hub to `p2p` is one field in the UI.