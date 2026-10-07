# tun peer 互通阶段一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** spoke 经 hub 用户态直转实现 peer 互通，不依赖 hub 宿主机内核 hairpin。

**Architecture:** `x/handler/tun/p2p.go` 的 `p2pHub.fromSpoke` 在 `device.Write` 之前先 `destinationOf` + `table.lookup`，命中 peer 路由则 `router.deliver` 直达对端流；spoke 侧 `routes` 为空时缺省为本机 `net` 的 CIDR 网段。

**Tech Stack:** Go, x tun handler, wisper entrypoint, Lit UI copy.

**Spec:** `wisper/docs/superpowers/specs/2026-10-06-wisper-tun-routing-design.md`（阶段一 §3 + §5；阶段二只定设计，本 plan 不实现）

## Global Constraints

- 跨模块验证必须 `GOWORK=off`，否则 go.work 掩盖模块图（见 [[gowork-masks-module-graph]]）。
- `go test` 按包跑或加 `-p 1`，wildcard 会 hang（见 [[go-test-wildcard-hangs]]）。
- `go test -race` 需 `CGO_ENABLED=1`。
- never commit/push unless explicitly asked（见 [[no-auto-commit]]）：各 Task 以“工作区 diff 可 review”结束，不含 commit 步骤。
- hub `tunnel/tun.go:listenerMetadata` 维持现状，不加 routes/DNS。

## Review Focus

- IPv6 spoke 互 ping：直转路径是否同样覆盖（`destinationOf` v6 分支 + v6 查表）。
- 超大包走直转路径：device 路径有 `ErrPacketTooLarge` 计数，直转是否丢包无声。
- 并发：多 spoke 同时直转同一对端流，是否仍由 `peerStream.mu` 串行（不得取 `wmu`）。
- spoke `net` 无掩码（如裸 IP）：缺省 routes 推导不得 panic，按空处理。
- hub 本机地址包：永不直转，只走 device。

---

### Task 1: hub 用户态直转（x 侧）

**Files:**
- Modify: `x/handler/tun/p2p.go`（`p2pHub.fromSpoke`）
- Test: `x/handler/tun/p2p_test.go`（沿用 `udpPacket`/`newTestRouter`/`newP2PHub` harness）

**Interfaces:**
- Consumes: `destinationOf(pkt []byte) (net.IP, bool)`, `(*peerTable).lookup(dst net.IP) (string, bool)`, `(*peerRouter).deliver(dst net.IP, pkt []byte) error`, `ErrNoRoute`, `(*p2pHub).countUnrouted(dst net.IP)` — 均已存在，不改签名。
- Produces: 新行为的 `fromSpoke(s *peerStream, pkt []byte) error`（签名不变）。

- [ ] **Step 1: Write failing test `TestP2PFromSpokeDeliversDirectToPeer`** in `x/handler/tun/p2p_test.go`：A/B 两 stream 注册 `10.10.0.3→peer-a`、`10.10.0.4→peer-b`；`hub.fromSpoke(a, udpPacket("10.10.0.3","10.10.0.4",1,1))` 后 B 端读到原包、device(`writeRecorder`) 零写入。
- [ ] **Step 2: Run it, expect FAIL** — `cd x && GOWORK=off go test ./handler/tun/ -run TestP2PFromSpokeDeliversDirectToPeer -v`（device 收到 1 包）。
- [ ] **Step 3: Implement** in `x/handler/tun/p2p.go`：`fromSpoke` 在 keepalive 分支之后、取 `wmu` 之前插入：`destinationOf` 成功且 `table.lookup` 命中时，若 `name == s.key` 则 `countUnrouted(dst)` 返回 nil（自发自收不回送）；否则 `router.deliver(dst, pkt)`，成功返回 nil，`ErrNoRoute`（lookup 与 deliver 之间流消失）则 `countUnrouted(dst)` 返回 nil，非 `ErrNoRoute` 错误则 `warnf("route %s: %v")` 返回 nil；未命中/非 IP 包维持现有 `wmu` + `device.Write` 路径（含 `ErrPacketTooLarge` 计数）。直转路径**不取 `wmu`**（`peerStream.write` 自带串行）。
- [ ] **Step 4: Add tests**：自环（A 发给自己 IP → A 端无包 + device 零写入）、未命中（目的未注册 → device 收到包，直转不触发）、hub 本机地址（`ownNets` 含 hub 网段时发 hub IP → device 路径）、IPv6 直转（`udp6Packet("fd00::3","fd00::4")` + v6 注册 → 对端收到、device 零写入）、超大包直转（大于 `MaxMessageSize` 的包仍按原样 `deliver`，行为与 device 路径的 `ErrPacketTooLarge` 计数差异在测试注释中写明：直转路径不做长度门禁，由 p2p 流控接管）。Run: `cd x && GOWORK=off CGO_ENABLED=1 go test -race -p 1 ./handler/tun/ -v`，expect PASS。
- [ ] **Step 5: Vet/build** — `cd x && GOWORK=off go build ./... && GOWORK=off go vet ./handler/tun/`，expect clean。工作区保持 uncommitted。

### Task 2: spoke 缺省 routes（wisper 侧 Go）

**Files:**
- Modify: `wisper/tunnel/entrypoint/tun.go`（`init()` 的 listener metadata）
- Test: `wisper/tunnel/entrypoint/tun_test.go`（沿用现有 metadata 断言形状）

**Interfaces:**
- Consumes: `s.opts.Net`（如 `10.10.100.250/24`）、`s.opts.Routes`；Task 1 的 hub 行为（spoke 包到达 hub 后被直转）。
- Produces: routes 缺省值（字符串 CIDR，如 `10.10.100.0/24`），仅当 `Routes == ""` 且 `Net` 可解析出 CIDR 时生效。

- [ ] **Step 1: Write failing test `TestTunEntryPointDefaultsRoutesToOwnSubnet`**：`NetOption("10.10.100.250/24")` 且不设 Routes，`init()` 后 listener metadata `routes` 为 `10.10.100.0/24`；显式 `RoutesOption("0.0.0.0/0")` 时保持原值；`Net` 为空/无掩码时 routes 保持空（不 panic）。
- [ ] **Step 2: Run it, expect FAIL** — `cd wisper && go test ./tunnel/entrypoint/ -run TestTunEntryPointDefaultsRoutesToOwnSubnet -v`。
- [ ] **Step 3: Implement** in `wisper/tunnel/entrypoint/tun.go`：`init()` 构造 metadata 前，若 `s.opts.Routes` 去空格后为空且 `net.ParseCIDR(s.opts.Net)` 成功，则 `routes = <masked CIDR>.String()`（Go `net.ParseCIDR` 返回的 `*net.IPNet` 即掩码后网段）。其余逻辑不动；API `validateTunRoutes` 规则不动。
- [ ] **Step 4: Run tests** — `cd wisper && CGO_ENABLED=1 go test -race -p 1 ./tunnel/entrypoint/ -v`，expect PASS；`go vet ./tunnel/entrypoint/` clean。

### Task 3: UI routes hint（copy only）

**Files:**
- Modify: `wisper/web-src/src/i18n/zh.ts`、`wisper/web-src/src/i18n/en.ts`（`fieldRoutesHint` 各补一句）
- Verify: `wisper/web-src/src/pages/entrypoint-detail-page.ts` 无需结构改动（hint 已引用该 key）

**Interfaces:**
- Consumes: Task 2 的缺省语义。
- Produces: zh `走该设备的网段，逗号分隔：192.168.50.0/24；0.0.0.0/0 表示全部流量。留空则默认走本机 net 所在网段（含 hub 及其他 peer）。`；en 对应英文。

- [ ] **Step 1: Edit the two hint strings**（仅改 copy，不改 key 名）。
- [ ] **Step 2: Verify** — `grep -rn fieldRoutesHint wisper/web-src/src` 确认 key 引用一致；`cd wisper/web-src && npx tsc --noEmit`（或 `make web` 成功构建）即 PASS。
