# Pending peers: show who knocked, and let the user answer

Date: 2026-09-28
Status: design approved, not implemented

## Problem

A p2p tunnel's inbound allowlist is a hand-typed list of base64 public keys.
A peer that is not on it is refused silently: `dispatch()` in
`tunnel/p2p_host.go` logs one warning and closes the stream. An operator has no
way to learn that somebody is trying to reach them, and no way to add that key
without copying it out of a log.

The hub does know who knocked. This adds a "requesting peers" section to the
tunnel's peers page: the keys that tried and were refused, each with a button
to add it to that tunnel's allowlist, or to dismiss the record.

## What the hub can and cannot know

**Can:** the peer's base64 public key. The p2p listener carries the dialing
peer's key in the accepted conn's remote address (`peerOf`), which is what the
host's route table is keyed by — the same key an allowlist holds.

**Cannot:** which tunnel the peer meant. A p2p stream routes by `{peer,
network}` only; the dialing side sends no destination, so nothing in the stream
says which tunnel was wanted. The user's choice of page supplies that
attribution: "add" puts the key on the tunnel whose peers page is open, and the
UI says so.

**Only peers that open a stream appear.** A hole punch does not create one, so
a peer that punches but never connects is invisible until it tries to use the
tunnel.

## Design

### 1. Recording: in memory, on the shared host

`p2pHostManager` gains a map of keys that knocked and were refused:

```go
type pendingPeer struct {
    Key       string
    FirstSeen time.Time
    LastSeen  time.Time
    Attempts  int
}
pending map[string]*pendingPeer // keyed by peer key
```

- **Write point:** the `pl == nil` branch of `dispatch()` — the one that logs
  "inbound stream from unregistered peer" today — records the key before
  closing the conn. The map is guarded by the manager's existing `mu`.
- **Expiry:** an entry dies 10 minutes after its `LastSeen`, evaluated lazily on
  snapshot and on write. No sweeper goroutine: the records are display state,
  and a ticker for them would outlive every reason to have one.
- **Bound:** 32 entries, evicting the oldest `LastSeen` when full. This is a
  list any stranger can append to by connecting, so it must not be able to grow.
- **Cleared** with the host: `release()` drops the map alongside the routes.
  With no host running nobody can knock, so entries kept past that are stale by
  construction.
- **Dismiss** deletes one key.

In-memory rather than persisted: the config file is rewritten every second by
the stats task, and a knock would have to either join that churn or introduce a
delayed write. The list is only meaningful while something is running — which
is exactly when the page is being watched.

### 2. Filtering known keys at read time

A key can already be listed by *another* tunnel, or by this one as a **disabled**
peer. A disabled peer is not in the host's route table (reconcile claims enabled
keys only), so its inbound streams do fall into the record path — and it would
then appear both as "requesting" and as its own disabled row.

`P2PPendingPeers()` therefore filters, before returning, every key that any
tunnel lists in `Peers` or `PeerDisabled`. Filtering at read time keeps the
write path untouched and always agrees with the current allowlists.

### 3. API

```
GET    /api/p2p/pending        -> {"peers":[{"key","first_seen","last_seen","attempts"}]}
                                  ordered by last_seen, newest first
DELETE /api/p2p/pending/{key}  -> dismiss one; idempotent, 200 for an unknown key
```

Peer keys are base64url, so a key is path-safe as a segment.

Adding needs no endpoint of its own: the peers page already saves the list
through `PUT /api/tunnels/{id}/peers`, which applies it in place via
`SetPeers` — routes are reconciled on the shared host, the service keeps
running and a live peer stream is not cut.

### 4. UI: a card above the allowlist on the peers page

```
Requesting peers (1)
?kQ7...FhA        3 attempts · 2 min ago        [Add] [Dismiss]
These keys knocked but are on no allowlist. A p2p stream carries no
destination, so which tunnel it wanted is unknown — Add puts it on this one.
```

- Renders only when non-empty.
- The key follows the page's existing reveal/mask toggle.
- **Add** reuses the store's `updatePeers(id, [...rows, {key}])`; the record
  disappears on the next poll (and is dropped locally at once).
- **Dismiss** issues the DELETE.
- Refresh rides the existing per-second `_load()`; a failure is silent and does
  not affect the allowlist rendering.
- New i18n keys, English and Chinese: title, hint, attempt count.

### 5. Tests

- `tunnel` package, no network: dedupe and counting, TTL expiry, bound eviction,
  dismiss, and snapshot filtering of both known and disabled keys. The recording
  action is a `notePending(key)` method so tests can call it directly;
  `dispatch` calls it.
- `api` package: `GET /api/p2p/pending` returns recorded entries; `DELETE`
  removes one and is idempotent.
- Web: `tsc` and `make web`. The UI is verified by hand — there is no way to
  inject a pending entry from outside the process, so it is not covered by
  Playwright.

## Not doing

- No protocol change to make a knock attributable (a destination discriminator
  in the stream).
- No persistence, and no persistent deny list: an unknown peer is already
  refused, so "deny" could only silence the notice. To stop seeing a key, add
  it and disable it — the allowlist already models that.
- No auto-add, no notifications.
- No traffic or transport badge on a requesting row: it has no session.
