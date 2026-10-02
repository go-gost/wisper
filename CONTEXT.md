# CONTEXT

wisper's vocabulary. GOST's existing terms keep their existing meanings — where
a word here collides with one in `core/`, the collision is called out.

## Tun

**hub** — the node that holds the tun device. Its device *is* the network: it
routes between the spokes, and nothing else on the path makes routing decisions.
One hub serves many spokes.

**spoke** — a node with a tun device that reaches a hub's network. A spoke is an
ordinary tun client; it needs no knowledge of how the hub is reached.

**device** — the tun interface a hub owns. Creating one requires privilege
(root, or CAP_NET_ADMIN), which is why a hub-side wisper needs it and why
Android's spoke instead borrows a device from its VpnService.

**device network** — the addressing a spoke's device is configured with: its own
address, the subnets routed through it, its DNS. Reachability between spokes is
settled by the hub device's configuration, not by anything on the path.

## Registration

**registration handshake** — a spoke's declaration of the addresses its device
holds. The only thing that knows a spoke's tun-network address is the spoke, so
this is how the hub learns it. Distinct from keeping a route alive: see
**keepalive**.

**keepalive** — the repeat of a registration handshake. On a socket hub it also
refreshes the route's expiry. Where departure is reported by the transport
itself, the repeat carries no additional meaning.

**route expiry** — reclaiming a route for a peer that is gone. Where a transport
reports departure exactly (a stream closing), expiry is unnecessary and a missed
teardown grows the table rather than lagging it.

## Routes

**route** — a mapping from one address on the network to the peer that holds it,
so a packet with that destination can be delivered.

**route name** — the value a route resolves to. Deliberately a name rather than
an address, so the same table serves every transport. A p2p hub's route name is
a **peer key**; a socket hub's is a UDP address.

**peer key** — a p2p peer's base64 public key. It identifies the peer and is
stable across reconnections. See `core/` for the unrelated `router.Router`,
which queries the operating system's route table for a gateway.

**stream** — one inbound connection from one peer. A peer has at most one at a
time, but reconnects get new ones under the same peer key. A peer key names who;
a stream names one connection to them.

**discarded packet** — a packet whose destination has no route. Expected when a
peer's registration has not arrived, and a symptom worth warning about when it
persists.