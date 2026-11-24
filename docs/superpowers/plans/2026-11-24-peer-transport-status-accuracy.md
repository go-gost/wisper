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

- [x] **Step 1: Extend the transport table**

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

- [x] **Step 2: Add both locales**

`en.ts`: `p2pTransportConnecting: 'connecting'`, `p2pTransportWhyConnecting: 'establishing the peer session'`.
`zh.ts`: `p2pTransportConnecting: '连接中'`, `p2pTransportWhyConnecting: '正在建立对端会话'`.

Verify key parity before moving on: `grep -c "p2pTransport" web-src/src/i18n/en.ts web-src/src/i18n/zh.ts` must print the same number for both files.

- [x] **Step 3: Stop drawing a stopped endpoint's path**

In `_renderTransport(ep)`, return `nothing` when `ep.status !== 'running'`. The row is about a live session; a stopped endpoint's last word is a leftover, and the status banner above already says stopped.

In the same file, the "server unreachable" banner condition becomes `ep.peer_transport === 'server-unreachable'` only — drop the `|| !ep.peer_transport` arm, which is what made the banner appear during an ordinary first connection.

- [x] **Step 4: Gate the list row**

In `home-page.ts`'s `_transport(item)`, return `null` unless `item.data.status === 'running'`, so the list and the detail page agree about a stopped endpoint.

- [x] **Step 5: Type-check and build**

Run: `cd /root/code/go-gost/wisper && make typecheck && make web`
Expected: `tsc --noEmit` clean; Vite writes `web/`. Confirm `web/assets` changed (`git status --short web`), because `web/` is a tracked build product in this repo.

- [x] **Step 6: Commit**

```bash
cd /root/code/go-gost/wisper
git add web-src/src web docs/superpowers/plans/2026-11-24-peer-transport-status-accuracy.md
git commit -m "feat(web): draw a connecting peer and hide a stopped endpoint's path"
```

**Implementation record:**
- **日期/状态:** 2026-11-24 — 已完成。
- **仓库 + commit:** `wisper` `50cfbcf` `feat(web): draw a connecting peer and hide a stopped endpoint's path`
  （代码 + web 产物 + e2e）。
- **实际改动文件:**
  - `web-src/src/utils/transport.ts` — `PeerTransport` 增加 `connecting`，`SPECS` 增加
    `connecting: { icon: 'rotate-cw', tone: 'muted', labelKey: 'p2pTransportConnecting' }`；类型注释改为
    「大部分是 p2p 的 wire 值，`connecting`/`server-unreachable` 是 API 的」。
  - `web-src/src/i18n/en.ts` / `zh.ts` — `p2pTransportConnecting`（connecting / 连接中）、
    `p2pTransportWhyConnecting`（establishing the peer session / 正在建立对端会话）。
  - `web-src/src/pages/entrypoint-detail-page.ts` — `_renderTransport` 在 `status !== 'running'` 时返回
    `nothing`；unreachable banner 条件去掉 `|| !ep.peer_transport`。
  - `web-src/src/pages/home-page.ts` — `_transport` 只在 `running` 时返回视图。
  - `web-e2e/tests/entrypoint-transport-detail.spec.ts` — 状态表补 `connecting`；新增
    「stopped 无 transport 行 / connecting 不弹 banner / server-unreachable 才弹」用例。
  - `web/assets/*` — Vite 重新构建产物（仓库跟踪的构建结果）。
- **测试/命令与结果:**
  - `make typecheck` → 干净。
  - `scripts/ui-test.sh -g transport` → 5 passed。
  - **回退验证**（把两个 page 文件 `git checkout` 回原版再 `make web`）→
    新用例在 `.peer-badge toHaveCount(0)` 处失败（`1 failed`），证明它真的会挂。
  - 恢复后 `scripts/ui-test.sh`（全量）→ **39 passed (31.3s)**。
- **Review 发现与修法:** `grep -c p2pTransport` 两边数字不等（19 vs 18）是**行数**而非 key 数（同一行有两个键），
  改用解析 key 的脚本核对 → 414/414 完全一致，不再依赖 grep 计数。
- **遗留/限制:** `connecting` 用 `muted`（不是 `warn`）：首连通常只有一两秒，且没有坏掉的东西；
  真正「一直 connecting」的场景目前无 UI 提示，靠事件页的 punch 失败告警。

---

### Task 3: ~~The QUIC server reports a direct path as soon as it holds one~~ — **cancelled: premise falsified**

**Status: cancelled, no code change in `p2p`.** Reverted; the `p2p` tree is clean.

The plan assumed the QUIC *server* role lagged behind reality because
`quicPair.pathName()` only reads `conn.RemoteAddr()`, which changes only after the
client's first migrated datagram. That is a real code fact, and the change was
implemented and made its own new test pass — but it broke an existing contract, and
the field evidence does not support the premise.

- **Existing test that forbids it:** `TestQUICRelayLossKeepsDirect`
  (`p2p/internal/host/quic_failure_test.go:214`) retires the client's direct path and
  then waits up to 5 s for the **server** to read `relay`. Reporting `direct` from
  `hasDirect()` makes the server keep claiming a path the peer has already left, so
  the change fails that test (`condition not met before timeout`) — the server's
  `RemoteAddr()` fallback is the deliberate "the peer left" signal, not an oversight.
- **Field evidence against the premise:** Pixel 9 (QUIC **server** for this pair) at
  2026-11-24, from its own event history and the hub log:
  - `09:49:48.473` phone: `stream:Vmm16NVN <-> …` over derp — pair established, no direct underlay yet.
  - `09:49:53.223` hub: `direct punch: seed failed …` + `backoff retryIn=5m0s` — **there was no direct path**.
  - `09:50:48.524` hub: `direct punch: start` → `09:50:49.178` `quic underlay direct event=installed`.
  - `09:50:50` phone: `peer …: derp → direct`.
  So the badge read `relay` for 61 s because the pair genuinely **was** on relay: the
  punch failed, armed a 5 m backoff, and only ran again when the peer re-announced
  candidates. The switch to `direct` came one second after the underlay was installed —
  not "only when there is data".
- **Bounded by design, not tens of seconds:** once a direct underlay is installed, the
  server sees a direct datagram within one `directHeartbeatInterval` (3 s), so any
  server-side reporting lag is ≤3 s. What the operator perceives as "waits for data"
  is the punch cadence (failed round + backoff), which is the Deferred item below.

Ruling: Task 3 is dropped; `p2p` stays untouched at `v0.15.4`, and Task 4 loses its
reason to exist. The `p2p` work that remains justified is the idle-path re-punch
cadence in Deferred, which needs its own evidence and design.

**Implementation record:**
- **日期/状态:** 2026-11-24 — 已取消（前提被证伪，无代码落地）。
- **仓库 + commit:** `p2p` 无改动；工作树回到 `v0.15.4` 的干净状态（改动已 `git checkout` 还原）。
- **实际改动文件:** 无。
- **测试/命令与结果:**
  - 实现阶段：新增 `TestQUICServerPathFollowsInstalledDirect` 先红（`path after addDirect = "relay"`），
    改 `quicPair.pathName()` 后转绿。
  - **回归证据**：`CGO_ENABLED=1 go test -race ./internal/host -run 'TestQUIC'` →
    `--- FAIL: TestQUICRelayLossKeepsDirect (6.45s) condition not met before timeout`
    —— 该用例要求 server 在客户端离开直连后退回 `relay`，我的改动恰好违反它。
  - 还原后 `go test ./internal/host -run TestQUICRelayLossKeepsDirect -count=1` → `ok 5.089s`；
    `git status --short` 为空。
- **Review 发现与修法:** 现场时间线（手机自身事件 + hub 日志）显示 09:49:48 建立会话、
  09:49:53 打洞失败并进入 5m backoff、09:50:48 重打洞、09:50:49 装上 underlay、
  09:50:50 徽标变直连 —— 徽标与事实一致，不存在「缺 direct 报告」的滞后。
- **遗留/限制:** 「有数据才变直连」的真实成因是打洞节奏（失败 + backoff 5m，靠对端候选公告提前打断），
  记入 Deferred，需单独取证与设计（涉及 H3 退避语义）。

---

### Task 4: Ship to the device — **STOP for the user's approval first**

**Files:** none. This is a build-and-install step, plus this plan's record.

Because Task 3 was cancelled there is no `p2p` tag and no `go.mod` bump: the shipped
change is wisper-only (`7f6a630`, `50cfbcf`).

- [ ] **Step 1: Ask, then build**

  两个动作都算「本工作区之外」，需要用户明确点头：打 p2p tag / push（已不需要）以及
  在用户手机上装 APK。未经同意不做。

- [ ] **Step 2: Build and install the APK**

  按 `.memory/notes/wisper-apk-build.md`：`docker` 构建且**必须** `--network host`、
  用 device-trusted key 重签、`adb install -r --no-incremental`、装完 `monkey` 重新拉起
  （装包会杀掉 app，tunnel 会静默停掉）。无线调试端口用
  `nmap -Pn -n -T4 --min-rate 3000 -p 30000-49999 10.10.100.250` 找；扫到的端口里可能有一个
  只接受 TCP 但不是 adbd（`adb connect` 会失败并留下 `offline` 条目）。

- [ ] **Step 3: Verify the three states on the device**

  `adb -s <ip:port> forward tcp:18900 tcp:8900`，然后

  ```bash
  curl -s http://127.0.0.1:18900/api/stats | python3 -c "
  import json,sys
  for e in json.load(sys.stdin)['entrypoints']:
      print(e['status'], repr(e.get('peer_transport')), e.get('peer_rtt_ms'))"
  ```

  验收（读成一条时间线）：

  1. 停 → `POST /api/entrypoints/<id>/start`，每 2 s 采样：先 `running` + `connecting`
     （relay 在位时**不再**出现 `server-unreachable`），随后 `derp`，再 `direct`。
  2. 再停一次并立刻采样：第一拍就没有 `peer_transport`，不是十几秒后才消失。
  3. 期间抓 hub 日志（`ssh pi@192.168.100.100 'docker logs --since 10m p2p-tun-wisper-1'`），
     确认没有 `quic handshake … context deadline exceeded` 突发被 UI 掩盖。

- [ ] **Step 4: Record**

```bash
cd /root/code/go-gost/wisper
git add docs/superpowers/plans/2026-11-24-peer-transport-status-accuracy.md
git commit -m "docs(plan): record the device verification"
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

- **「有数据才变直连」= 打洞节奏，不是状态上报。** 2026-11-24 09:49–09:50 的实测：第一轮打洞
  `seed failed`（v4 候选 58.37.24.59:49896）+ `backoff retryIn=5m0s`，55 s 后靠对端候选公告
  打断退避才重打一轮，装上 underlay 后 1 s 徽标即变直连。要缩短这段等待需要动两处之一：
  `directConn.backoff()` 的 H3 退避语义（cap 5m），或「会话重建/链路重现时主动 kick」的触发器
  —— 与 [[p2p-punch-trigger-missing-on-link-represent]] 中 v0.14.8 的修复同源，但这里是**已建立
  会话之后**的首轮失败，不在那次修复范围内。需要单独取证（手机侧 debug 日志）+ 设计，勿顺手改。
- **The first connection still takes ~30 s when the hub's relay registration has gone stale.** Field sequence on 2026-11-24: the phone restarted its entrypoint at `09:49:18`, its punch failed with `caps timeout` at `09:49:21`, the hub ran three 10 s QUIC handshakes that each expired (`09:49:22`, `09:49:35`, `09:49:45`), and only then did p2p's relay-blackhole cure fire (`relay handshake blackhole … re-registering`, stage 1) — the very next handshake succeeded in 0.77 s (`09:49:48`). So the latency is the cure's 3×10 s budget, not the UI. Shortening it is a p2p tuning decision (handshake deadline vs. strike count) and needs its own evidence; Tasks 1–2 only stop the UI from calling that window "unreachable".
- **Direct↔relay flapping on an idle path.** The same hub log shows the direct underlay retired with `reason=heartbeat` after lifetimes of 12–45 s during a relay-jitter window (`09:42`–`09:46`), each followed by a `1m`/`2m`/`5m` backoff. Once traffic resumed at `09:50` the path held for over an hour. This is the known idle/one-way watchdog interaction, unrelated to the badge; leave it alone until it is reproduced deliberately.
