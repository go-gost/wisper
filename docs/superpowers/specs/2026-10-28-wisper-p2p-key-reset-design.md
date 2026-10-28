# Wisper P2P key reset

## Intent

Rotating wisper's process-wide p2p identity currently means stopping wisper,
deleting `<config>/p2p/host.key`, and starting it again — which is impossible
from the Android app and awkward everywhere else. Expose the operation in the
API and the settings page.

## What the reset is

"Reset" **rotates** the identity: wisper generates a new X25519 key, replaces
the key file, and every p2p consumer comes back on the new public key. Deleting
the file only regenerates lazily on the next use; the reset does it now and
makes the result visible immediately.

This is destructive by nature: the public key is the address peers dial, and
hub allowlists name peer keys. After a reset, every peer that dialed this host,
and every allowlist that contained this host's key, must be updated.

## Goals

- Reset from the settings page (desktop, Android WebView, headless Docker) and
  from `curl`.
- Replace the key atomically; never leave a missing or half-written key file.
- Stop the running shared host so the next acquire rebuilds it with the new key.
- Restart the running p2p consumers automatically: p2p tunnels, tun hubs,
  p2p entrypoints, tun entrypoints. Non-p2p tunnels/entrypoints are untouched.
- Return the new public key so the page can show it at once.

## Non-goals

- Keeping the old key usable (no multi-identity / rotation history).
- Updating peers' configurations or allowlists automatically.
- An authenticated API: wisper's API is unauthenticated by design today.

## Approaches considered

- **A. API + settings-page button (chosen).** One endpoint, one danger dialog.
  Works on every surface, including Android.
- **B. API only.** Same backend, no discoverable UI; no better than deleting
  the file by hand.
- **C. CLI flag only.** Convenient headless, unavailable on Android, and cannot
  reset while the process runs.

## Design

### Backend

`tunnel.ResetP2PIdentity() (publicKey string, err error)`:

1. Take the host manager lock (serializes with `EnsureP2PIdentity`).
2. `p2p.GenerateKey()`.
3. Atomically replace the key file: write `host.key-*` in the same directory
   (0600), then `os.Rename` over `<config>/p2p/host.key`.
4. Tear the shared host down (`teardownLocked`): host, accept loop, peer routes,
   pending knocks. References are left alone — their holders are about to be
   restarted and will return them.
5. Return the new base64 public key.

The file write happens before the teardown, so a write failure leaves the old
identity and host untouched.

New restart entry points, built by factoring the existing `RestartRunning`:

- `tunnel.RestartP2PRunning()` — restarts running `p2p` and `tun` tunnels.
- `entrypoint.RestartP2PRunning()` — restarts running `p2p` and `tun`
  entrypoints.

`RestartRunning` keeps its behavior (all running services).

### API

`POST /api/p2p/reset`, body `{"confirm": true}`.

- Missing/false `confirm` → 400, nothing changes. A JSON body also means a
  plain non-preflighted form POST cannot trigger it (the API itself has no
  authentication, so this is an accident guard, not a security boundary).
- Success → 200 with the same identity payload as `GET /api/p2p` (new
  `public_key`, `running`, transport counters).
- Failure → 500, old identity intact.
- A package-level mutex serializes the reset and both restarts, so two
  concurrent resets cannot interleave key writes and host rebuilds.

### UI

In the P2P identity block, next to the key, a danger button opens a confirmation
dialog explaining: the key changes, every running p2p consumer restarts, and
every peer / allowlist that used the old key must be updated. Confirming calls
the endpoint, updates the displayed key, and reveals it (the value just changed,
so showing it is the point). Success/failure goes to the existing snackbar.

### Tests

- `tunnel`: reset while idle replaces the file (0600, new content) and
  `EnsureP2PIdentity` returns the new key; reset while a p2p tunnel runs stops
  the host; a second reset yields a different key.
- `tunnel` / `entrypoint`: `RestartP2PRunning` restarts p2p consumers and leaves
  a non-p2p one untouched.
- `api`: reset requires `confirm`; a confirmed reset returns a new key whose
  file matches and is 0600.
- `web-src`: TypeScript compile through `make web`.

## Constraints

- Comments in English only (repo convention).
- `en.ts` and `zh.ts` must carry the same keys.
- `web/assets` is a tracked build artifact: rebuild after changing `web-src`.
- Do not commit or push unless asked.
