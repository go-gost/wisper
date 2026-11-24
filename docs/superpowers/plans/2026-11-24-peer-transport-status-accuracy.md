# Peer transport status accuracy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a p2p/tun endpoint's transport badge tell the truth at all three moments it currently lies: while the peer session is still being established ("unreachable"), on the QUIC *server* side after a direct path is installed ("relay" until traffic arrives), and after the endpoint is stopped ("direct" for up to the host's 30 s teardown grace).

**Architecture:** Three independent, small changes. (A) The wisper API stops overloading one empty value: a peer the host does not list is `connecting` when the relay is up and `server-unreachable` only when the relay itself is down, and a non-running endpoint reports no transport word at all. (B) The Lit UI renders that third state, keeps the unreachable banner to the one word that means it, and hides the transport row while stopped. (C) p2p's `quicPair.pathName()` reports `direct` on the server role as soon as the pair holds a direct underlay, instead of waiting for the peer's first migrated datagram.

**Tech Stack:** Go 1.26, Lit 3 + TypeScript (Vite), p2p module.

**Spec:** none — this implements the diagnosis recorded in `.memory/notes/` and in the session that produced it (field evidence collected 2026-11-24 on Pixel 9 `10.10.100.250` + hub `p2p-tun-wisper-1`).

## Global Constraints

- `p2p/` is its own Go module and repo; `wisper/` depends on it by released tag. Do not add a `replace`.
- Never edit `core/`; the p2p change is inside `p2p/internal/host/`.
- Code comments in English only.
- UI text goes in **both** `web-src/src/i18n/en.ts` and `web-src/src/i18n/zh.ts`; the key sets must stay identical.
- Tests run per package, never as a wildcard (`go test ./...` hangs in this workspace). Wisper module verification uses `GOWORK=off` so the released dependency tags are what is tested; p2p changes are verified inside `p2p/` with the workspace on.
- Every task ends with its own commit containing that task's code, tests and **Implementation record**. Commit only — never push, never tag without the user saying so.
- Must not change the wire format between peers: `PeerTransports`' value vocabulary stays `direct` / `derp` / `punching` / `failed` / `disabled` / `peer-direct-off` / `no-candidates` / `stun-unreachable`; `connecting` and `server-unreachable` are **API-layer** words and never travel on the wire.

## Review Focus

- A peer that has never engaged reads `connecting` forever and the UI never says anything is wrong → the banner must stay reachable by the relay-down case, and the events page keeps its own "punch failed" warnings.
- Stopping an endpoint hides its transport row, and the operator loses the last path it had — acceptable only because the status banner still says stopped; make sure the row does not disappear while *running* with a transiently empty word.
- The QUIC server now reports `direct` from install time; if a direct underlay ever outlives its usefulness (heartbeat dead) it must flip back to `relay` — the retire path must clear `directSock` before `pathName` is read again.
- `fallbacks` / `migrations` counters will start counting on the server side too (they were silently zero there). Nothing reads them as an assertion today, but a dashboard that summed both peers' counters would double-count after this change.
- An older APK talking to a newer hub (or the reverse) must be unaffected: the p2p change is status-only, no frame or handshake change.

---

### Task 1: The API's three transport states

**Files:**
- Modify: `api/tunnel_handler.go` (constants near the top; `toTunnelResponse`, the `peer_stats` loop, the single-peer face)
- Test: `api/api_test.go` (new test functions, same file — the helpers live there)

**Interfaces:**
- Produces: `peerTransportWord(transport string, relayUp bool) string` — returns `transport` unchanged when non-empty; `transportConnecting` when it is empty and the relay is up; `transportServerUnreachable` when it is empty and the relay is down.
- Produces: constants `transportConnecting = "connecting"`, `transportServerUnreachable = "server-unreachable"`.

- [x] **Step 1: Write the failing tests**

```go
// TestPeerTransportWord pins the three-way split that replaced the old
// "empty means unreachable" reading: a live path is reported as is, a peer the
// host does not list yet is still connecting, and only a relay that is itself
// down makes the server unreachable.
func TestPeerTransportWord(t *testing.T) {
	cases := []struct {
		name      string
		transport string
		relayUp   bool
		want      string
	}{
		{"direct path", "direct", true, "direct"},
		{"never engaged", "", true, "connecting"},
		{"relay down", "", false, "server-unreachable"},
		{"live path outranks a relay outage", "direct", false, "direct"},
		{"peer turned direct off", "peer-direct-off", true, "peer-direct-off"},
	}
	for _, c := range cases {
		if got := peerTransportWord(c.transport, c.relayUp); got != c.want {
			t.Errorf("%s: peerTransportWord(%q, %v) = %q, want %q",
				c.name, c.transport, c.relayUp, got, c.want)
		}
	}
}

// TestStoppedEntrypointReportsNoTransport: a stopped endpoint keeps its peer
// key in options, but it has no session and no path, so it must not keep
// publishing the word its last run ended on — the UI would show "direct" for
// the whole teardown grace of the shared host.
func TestStoppedEntrypointReportsNoTransport(t *testing.T) {
	key := strings.Repeat("A", 43)
	ep := entrypoint.NewByType("tun",
		tunnel.NameOption("stopped tun"),
		tunnel.NetOption("10.10.100.9/24"),
		tunnel.PeerOption(key),
	)
	ep.Close()
	t.Cleanup(func() { _ = ep.Close() })

	resp := toTunnelResponse(ep)
	if resp.Status != "stopped" {
		t.Fatalf("status = %q, want stopped", resp.Status)
	}
	if resp.PeerTransport != "" {
		t.Errorf("peer_transport = %q on a stopped endpoint, want empty", resp.PeerTransport)
	}
}
```

Check the option name for the peer before writing: `grep -n "PeerOption" tunnel/options.go`. If the constructor needs `endpoint`/`entrypoint` too, follow `preRegisterEntrypoint` in the same test file.

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./api -run 'TestPeerTransportWord|TestStoppedEntrypointReportsNoTransport' -count=1`
Expected: compile failure (`peerTransportWord` undefined); after adding only the helper, `TestStoppedEntrypointReportsNoTransport` fails with a non-empty `peer_transport`.

- [x] **Step 3: Implement the helper and the gating**

```go
// Transport words the API adds on top of p2p's own vocabulary. p2p reports
// only peers with a live data path; the two words below say why a listed peer
// has none, which p2p cannot know. They never travel on the wire.
const (
	// transportConnecting is a peer with no live path while the relay is up:
	// the pair is still being established (a first connection, or a punch in
	// progress that has not installed its underlay yet).
	transportConnecting = "connecting"
	// transportServerUnreachable is a peer with no live path while the relay
	// itself is down: the host cannot reach the server at all.
	transportServerUnreachable = "server-unreachable"
)

func peerTransportWord(transport string, relayUp bool) string {
	if transport != "" {
		return transport
	}
	if !relayUp {
		return transportServerUnreachable
	}
	return transportConnecting
}
```

In `toTunnelResponse`, replace the current `hasP2PPeers` block and both `server-unreachable` overrides with one decision taken once:

- the host snapshot is read only when `hasP2PPeers(opts) && status == "running"`, and re-checked with `tunnel.P2PHostRunning()` after the read (the same release race `runner/task/stats.go` handles): if the host went away between the two calls, treat it as "stopped" and report nothing rather than an outage;
- `relayUp` is `st.RelayConnected` from that one snapshot;
- the `peer_stats` row and the single-peer face both call `peerTransportWord(transports[key], relayUp)`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd /root/code/go-gost/wisper && GOWORK=off go test ./api -count=1`
Expected: PASS.

- [x] **Step 5: Pin the wire spelling**

Add to the same file a marshaling assertion so the two new words cannot be renamed silently:

```go
func TestPeerTransportWireShape(t *testing.T) {
	b, err := json.Marshal(tunnelResponse{PeerTransport: transportConnecting})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"peer_transport":"connecting"`) {
		t.Fatalf("peer_transport wire shape = %s", b)
	}
	b, err = json.Marshal(tunnelResponse{PeerTransport: transportServerUnreachable})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"peer_transport":"server-unreachable"`) {
		t.Fatalf("peer_transport wire shape = %s", b)
	}
}
```

Run again (`-run TestPeerTransportWireShape -count=1`), then commit:

```bash
cd /root/code/go-gost/wisper
git add api/tunnel_handler.go api/api_test.go docs/superpowers/plans/2026-11-24-peer-transport-status-accuracy.md
git commit -m "feat(api): report connecting separately from an unreachable server"
```

**Implementation record:**
- **日期/状态:** 2026-11-24 — 已完成。
- **仓库 + commit:** `wisper` `7f6a630` `feat(api): report connecting separately from an unreachable server`（代码 + 测试）。
- **实际改动文件:**
  - `api/tunnel_handler.go` — 新增 `transportConnecting` / `transportServerUnreachable` 常量与
    `peerTransportWord(transport string, relayUp bool) string`；`toTunnelResponse` 的 host 快照改为
    「`hasP2PPeers(opts) && status == "running"` 才读，且 `P2PHostRunning()` 复核」并推出 `relayUp` /
    `hostKnown`；`peer_stats` 行与单 peer 面统一走 `peerTransportWord`，删掉两处
    `transport == "" && P2PHostRunning() → server-unreachable`。
  - `api/api_test.go` — 新增 `TestPeerTransportWord`、`TestStoppedEntrypointReportsNoTransport`、
    `TestPeerTransportWireShape`。
- **测试/命令与结果:**
  - 红：`GOWORK=off go test ./api -run 'TestPeerTransportWord|TestStoppedEntrypointReportsNoTransport|TestPeerTransportWireShape'`
    → `undefined: peerTransportWord`（编译失败）。
  - 绿：同命令 → `ok github.com/go-gost/wisper/api 0.011s`。
  - 全包：`GOWORK=off go test ./api -count=1 -timeout 480s` → `ok 163.447s`。
- **Review 发现与修法:** 首版只在 `P2PHostRunning()` 为真时算 `relayUp`，停机或 host 刚被 release 时
  `relayUp` 会是 false，把「不知道」误报成 `server-unreachable` —— 改用 `hostKnown` 显式区分三态：
  不知道就**什么都不报**（字段省略）。
- **遗留/限制:** `connecting` 会一直挂着直到 peer 有活路径；真正的首连慢（relay 注册黑洞 3×10s）没修，
  记在 Deferred。

---

### Task 2: The UI's third state, banner and stopped row


**Files:**
- Modify: `web-src/src/utils/transport.ts` (union + `SPECS`)
- Modify: `web-src/src/i18n/en.ts`, `web-src/src/i18n/zh.ts`
- Modify: `web-src/src/pages/entrypoint-detail-page.ts` (`_renderTransport`, the `server-unreachable` banner condition)
- Modify: `web-src/src/pages/home-page.ts` (`_transport`)

**Interfaces:**
- Consumes: the API words from Task 1 (`connecting`, `server-unreachable`).
- Produces: `PeerTransport` gains `'connecting'`; `transportStyle('connecting')` returns `{ icon: 'rotate-cw', tone: 'muted', label: t('p2pTransportConnecting'), why: t('p2pTransportWhyConnecting') }`.

- [ ] **Step 1: Extend the transport table**

In `SPECS`, next to `punching`:

```ts
  connecting: {
    icon: 'rotate-cw',
    tone: 'muted',
    labelKey: 'p2pTransportConnecting',
    whyKey: 'p2pTransportWhyConnecting',
  },
```

Add `'connecting'` to the `PeerTransport` union in alphabetical position. `muted`, not `warn`: nothing is broken yet, and a first connection is routinely a second or two — the same reasoning that made `peer-direct-off` informational rather than a fault.

- [ ] **Step 2: Add both locales**

`en.ts`: `p2pTransportConnecting: 'connecting'`, `p2pTransportWhyConnecting: 'establishing the peer session'`.
`zh.ts`: `p2pTransportConnecting: '连接中'`, `p2pTransportWhyConnecting: '正在建立对端会话'`.

Verify key parity before moving on: `grep -c "p2pTransport" web-src/src/i18n/en.ts web-src/src/i18n/zh.ts` must print the same number for both files.

- [ ] **Step 3: Stop drawing a stopped endpoint's path**

In `_renderTransport(ep)`, return `nothing` when `ep.status !== 'running'`. The row is about a live session; a stopped endpoint's last word is a leftover, and the status banner above already says stopped.

In the same file, the "server unreachable" banner condition becomes `ep.peer_transport === 'server-unreachable'` only — drop the `|| !ep.peer_transport` arm, which is what made the banner appear during an ordinary first connection.

- [ ] **Step 4: Gate the list row**

In `home-page.ts`'s `_transport(item)`, return `null` unless `item.data.status === 'running'`, so the list and the detail page agree about a stopped endpoint.

- [ ] **Step 5: Type-check and build**

Run: `cd /root/code/go-gost/wisper && make typecheck && make web`
Expected: `tsc --noEmit` clean; Vite writes `web/`. Confirm `web/assets` changed (`git status --short web`), because `web/` is a tracked build product in this repo.

- [ ] **Step 6: Commit**

```bash
cd /root/code/go-gost/wisper
git add web-src/src web docs/superpowers/plans/2026-11-24-peer-transport-status-accuracy.md
git commit -m "feat(web): draw a connecting peer and hide a stopped endpoint's path"
```

**Implementation record:**
- 日期/状态：
- 仓库 + commit：
- 实际改动文件：
- 测试/命令与结果：
- Review 发现与修法：
- 遗留/限制：

---

### Task 3: The QUIC server reports a direct path as soon as it holds one

**Files:**
- Modify: `p2p/internal/host/quic.go` (`quicPair.pathName`)
- Test: `p2p/internal/host/quic_direct_test.go`

**Interfaces:**
- Consumes: `quicPair.hasDirect()` (already exists: "a direct underlay is installed on the pair").
- Produces: no new API. `pathName()` on a `quicRoleServer` pair now returns `quicPathDirect` while `directSock != nil && !closed`.

- [ ] **Step 1: Write the failing test**

```go
// TestQUICServerPathFollowsInstalledDirect: the server role has no preferred
// path to read — it follows the address the client migrates to, which only
// becomes the direct one after the client's first datagram arrives on it. Until
// then a server that already holds a punched underlay reported "relay", so a
// spoke whose hub is the QUIC server only showed a direct badge once it started
// sending. The pair's own record of the underlay is the correct answer: the
// seed handshake has already proven that path.
func TestQUICServerPathFollowsInstalledDirect(t *testing.T) {
	e := &engine{transport: transportQUIC, quics: make(map[derpclient.PublicKey]*quicPeer)}
	peer := derpclient.PublicKey{11}
	pair := newQUICPair(e, peer, quicRoleServer, nil, nil, nil)
	t.Cleanup(pair.close)

	if got := pair.pathName(); got != quicPathRelay {
		t.Fatalf("path before a punch = %q, want %q", got, quicPathRelay)
	}

	peerSock := mustListenUDP(t)
	t.Cleanup(func() { peerSock.Close() })
	sock := mustListenUDP(t)
	if err := pair.addDirect(sock, udpAddrPort(t, peerSock), [seedTokenLen]byte{1}); err != nil {
		t.Fatalf("addDirect: %v", err)
	}
	if got := pair.pathName(); got != quicPathDirect {
		t.Fatalf("path after addDirect = %q, want %q", got, quicPathDirect)
	}

	pair.removeDirect(sock)
	if got := pair.pathName(); got != quicPathRelay {
		t.Fatalf("path after removeDirect = %q, want %q", got, quicPathRelay)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /root/code/go-gost/p2p && go test ./internal/host -run TestQUICServerPathFollowsInstalledDirect -count=1`
Expected: FAIL — `path after addDirect = "relay", want "direct"`.

- [ ] **Step 3: Implement it**

In `quicPair.pathName`, before the `conn.RemoteAddr()` fallback:

```go
	// A server has no preferred path to read; it follows the address the client
	// migrates to, which is only observed once the client's first datagram
	// arrives on the direct path. The pair's own record is the answer until
	// then: a punched underlay has already completed the seed handshake, so the
	// path is proven before any of its traffic is seen. Reporting relay here
	// made a spoke read "relay" for as long as it stayed idle, even though the
	// client had been preferring direct from the moment it installed.
	if p.hasDirect() {
		return quicPathDirect
	}
```

`hasDirect` takes `p.mu` itself, so keep it outside the existing `p.mu` block (that block is released before this point).

- [ ] **Step 4: Run the suite around it**

Run: `cd /root/code/go-gost/p2p && go test ./internal/host -run 'TestQUIC' -count=1`
Expected: PASS, including `TestQUICPairMigratesRelayDirectRelay` (it explicitly retires the underlay and expects relay) and `TestQUICModeDirectPunch`.

Then the whole package with the race detector, which is what CI runs:

Run: `cd /root/code/go-gost/p2p && CGO_ENABLED=1 go test -race -count=1 ./internal/host`
Expected: PASS. A timeout in `TestTransportStatsCounters` under load is the known sandbox flake, not this change — re-run it alone to confirm.

- [ ] **Step 5: Commit**

```bash
cd /root/code/go-gost/p2p
git add internal/host/quic.go internal/host/quic_direct_test.go
git commit -m "fix(host): report a server's installed direct path before its first datagram"
```

Then append the p2p half of the implementation record to the plan, in the wisper repo, and commit that separately (the plan lives in wisper):

```bash
cd /root/code/go-gost/wisper
git add docs/superpowers/plans/2026-11-24-peer-transport-status-accuracy.md
git commit -m "docs(plan): record task 3's p2p commit"
```

**Implementation record:**
- 日期/状态：
- 仓库 + commit：
- 实际改动文件：
- 测试/命令与结果：
- Review 发现与修法：
- 遗留/限制：

---

### Task 4: Ship the p2p fix to the device — **STOP for the user's approval first**

**Files:**
- Modify: `wisper/go.mod`, `wisper/go.sum`
- Modify: this plan (record)

**Interfaces:**
- Consumes: a released p2p tag containing Task 3.
- Produces: `github.com/go-gost/p2p vX.Y.Z` in `wisper/go.mod`.

- [ ] **Step 1: Ask, then tag**

Do **not** tag or push without an explicit yes. The scope is: a p2p patch tag (`git tag v0.15.5` on main after Task 3's commit), `git push origin main --tags` in `p2p/`, then the wisper bump. If the user declines, this task stays open and Tasks 1–2 still ship (they are independent of p2p).

- [ ] **Step 2: Bump and verify**

```bash
cd /root/code/go-gost/wisper && GOWORK=off go get github.com/go-gost/p2p@vX.Y.Z && GOWORK=off go mod tidy
cd /root/code/go-gost/wisper && GOWORK=off go build ./... && GOWORK=off go test ./api ./tunnel -count=1
```

- [ ] **Step 3: Verify on the device**

The recipes are established; use them rather than inventing new ones.

Field observation, before and after, from the phone's own API (the phone's `10.10.100.250` is reachable directly; find the wireless-debugging port with `nmap -Pn -n -T4 --min-rate 3000 -p 30000-49999 10.10.100.250` and `adb connect` the open one — one of them is a decoy that accepts TCP but is not adbd):

```bash
adb -s <ip:port> forward tcp:18900 tcp:8900
curl -s http://127.0.0.1:18900/api/stats | python3 -c "
import json,sys
for e in json.load(sys.stdin)['entrypoints']:
    print(e['status'], repr(e.get('peer_transport')), e.get('peer_rtt_ms'))"
```

Acceptance, read as one timeline:

1. Stop the entrypoint, then `POST /api/entrypoints/<id>/start`, and sample every 2 s: the first samples read `running` with `peer_transport` `connecting` (never `server-unreachable` while the relay is up), then `derp`, then `direct` — and with the p2p fix, `direct` arrives on the phone's side without requiring traffic.
2. Stop it again and sample immediately: `peer_transport` is absent from the first sample after the stop, not 10–30 s later.
3. Pull the hub's log for the same window (`ssh pi@192.168.100.100 'docker logs --since 10m p2p-tun-wisper-1'`) and confirm no `quic handshake … context deadline exceeded` burst was hidden by the UI change.

Build and install the APK only after that, following `.memory/notes/wisper-apk-build.md` (`docker` with `--network host`, re-sign with the device-trusted key, `adb install -r --no-incremental`).

- [ ] **Step 4: Commit**

```bash
cd /root/code/go-gost/wisper
git add go.mod go.sum docs/superpowers/plans/2026-11-24-peer-transport-status-accuracy.md
git commit -m "chore(deps): bump p2p for the server-side path report"
```

**Implementation record:**
- 日期/状态：
- 仓库 + commit：
- 实际改动文件：
- 测试/命令与结果：
- Review 发现与修法：
- 遗留/限制：

---

## Deferred

- **The first connection still takes ~30 s when the hub's relay registration has gone stale.** Field sequence on 2026-11-24: the phone restarted its entrypoint at `09:49:18`, its punch failed with `caps timeout` at `09:49:21`, the hub ran three 10 s QUIC handshakes that each expired (`09:49:22`, `09:49:35`, `09:49:45`), and only then did p2p's relay-blackhole cure fire (`relay handshake blackhole … re-registering`, stage 1) — the very next handshake succeeded in 0.77 s (`09:49:48`). So the latency is the cure's 3×10 s budget, not the UI. Shortening it is a p2p tuning decision (handshake deadline vs. strike count) and needs its own evidence; Tasks 1–2 only stop the UI from calling that window "unreachable".
- **Direct↔relay flapping on an idle path.** The same hub log shows the direct underlay retired with `reason=heartbeat` after lifetimes of 12–45 s during a relay-jitter window (`09:42`–`09:46`), each followed by a `1m`/`2m`/`5m` backoff. Once traffic resumed at `09:50` the path held for over an hour. This is the known idle/one-way watchdog interaction, unrelated to the badge; leave it alone until it is reproduced deliberately.
