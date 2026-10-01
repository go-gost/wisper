# A taken VPN is a deliberate switch: yield to the other app — design

Status: **approved for implementation** (2026-10-01).
Plan: [docs/superpowers/plans/2026-10-01-vpn-takeover-yields-to-the-other-app.md](../plans/2026-10-01-vpn-takeover-yields-to-the-other-app.md).

## Context (why)

Measured twice on the real Pixel 9 (2026-10-01, shadowsocks as the other app):

```
01:57:08.449  tunfd op=release fd=-1 prev=336    ← taken: shadowsocks' prepare()
01:57:10.070  tunfd op=set fd=198                ← our poll (2s) re-established
01:57:15.084  tunfd op=release fd=-1 prev=198    ← its establish() finally ran, revoking ours
01:57:17.144  tunfd op=set fd=200 (interface tun1)
```

Three rounds in nine seconds, each our re-establish within one poll tick, ending
with *us* holding the VPN. So wisper wins a race the user did not ask for: they
switched to another VPN on purpose (their experiment: shadowsocks yields when
preempted and does not come back), and our 2s re-take undoes that choice. Each
`establish()` also revokes the other side, so the two apps ping-pong while
neither is reliably up, and every round triggers a punch storm on the p2p side
(the hub logged 9 rounds, 8 of them `no peer candidates`, for one takeover).

The entrypoint also stays `运行中` throughout, with no event: the user cannot see
any of it (the peer-diagnostics work surfaced engine state, not this one).

## Design

`onRevoke()` is the one moment the question is unambiguous — Android revoked
*our* VPN, so any VPN that is still up belongs to someone else. Ask
`ConnectivityManager` (`TRANSPORT_VPN` on the active networks), then branch:

- **Another VPN is active → a deliberate switch.** Do not race it back. Drop the
  arm that was waiting for a device, hand the device back, and tell the backend
  to **stop the tun entrypoint that held it** and record *why*. Nothing then
  wants a device, so the poller has nothing to re-establish — the loop cannot
  restart. The user starts the entrypoint again when they want it (that re-arms
  and legitimately preempts the other app, which is their choice to make).
- **No VPN active → our own VPN was switched off** (system settings, a killed
  service). Keep today's behaviour: one automatic re-establish at the next poll
  tick, so a transient hiccup stays invisible.

Two supporting pieces, both small:

- **The arm is stale, not an intent.** `WisperService.armedOptions` exists to
  give an entrypoint *about to start* its device; when the device was taken away
  it must not outlive that (otherwise the poller re-establishes from the arm and
  the race continues for up to `ARM_TTL_MS`). A `VpnStatus.takenAt` stamp set in
  `onRevoke` clears an arm older than it; a *new* arm (a user action) is newer,
  so it survives.
- **The fd log names its caller.** `setTunFd(fd, reason)` carries the Kotlin
  call site through the JNI, so the Go line reads
  `op=release reason=onRevoke fd=-1 prev=336`. Today the app log proves a
  release happened but not who did it (logcat's `wisper-tunfd` lines were missing
  for three of the four transitions — logcat on this device is not a reliable
  record, the app log is).

## Decisions

1. **Yield, don't fight** — the branch above. Chosen by the user after the
   measurement: "用户既然切换应用抢占，用意就是切换网络".
2. **Detect via `TRANSPORT_VPN`**, not by guessing from timing: it is the public
   answer to "is a VPN up right now" and needs only `ACCESS_NETWORK_STATE` (a
   normal permission, no prompt).
3. **Stop the entrypoint rather than leave it running with a dead device** — the
   service's own contract is that a running entrypoint has a device, and the
   user-visible state must say what happened.
4. **Only the taken branch stops anything.** A revoke with no other VPN keeps
   the automatic recovery, because that is what the recovery was written for.

## Non-goals

- No always-on/VPN-preference handling: if wisper is the user's always-on VPN the
  platform restores it and the action is the system's, not ours. (Untested —
  never observed on this device.)
- No new setting ("keep fighting" is deliberately not configurable: the fight is
  the bug).
- No change to how a *user-initiated* start preempts another VPN: that is the
  user's explicit choice and stays as it is.

## Verifying it

- Go: a unit test that the taken path stops the entrypoint holding the device and
  records the event (the `api` package owns that seam, so its existing test
  server covers it).
- Kotlin: compiles in the toolchain image; the APK builds.
- Device: preempt with shadowsocks and check the app log —
  `release … reason=onRevoke` once, then **no** `set` until the user starts the
  entrypoint again, plus a warn event on the entrypoint explaining the stop.
  Before the change the same experiment showed `release → set` three times.
