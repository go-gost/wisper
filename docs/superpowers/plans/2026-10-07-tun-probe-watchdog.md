# Tun 探针看门狗（wisper 侧）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tun entrypoint 的探针开关从表单通到 x（metadata），探针计数经 stats 流
回来看门狗：acked 停滞 ~1min 报 event，~2min 自动 Restart，10min 冷却。

**Architecture:** 配置层照抄 `keepalive` 的整条链（Options→config→API→UI，
plain bool，缺省 false——老配置保持关，新建表单默认开）；计数走现有 1s stats
tick（`updateEntrypoint` 加两行）；看门狗无新 goroutine，状态寄在单例
`updateStatsTask` 上，纯决策函数可单测。

**Tech Stack:** Go（wisper 后端），Lit + TS（`web-src`，`npm run typecheck` 门禁）。

**Spec:** `wisper/docs/superpowers/specs/2026-10-07-wisper-tun-probe-design.md`
（§2/§3/§4 是本 plan 的依据；x 侧见 Plan A
`x/docs/superpowers/plans/2026-10-07-tun-device-probe.md`）

**前置：** Plan A 已合入并发布 **x v0.23.0**（本 plan 的 Task 1 先 bump，
无 v0.23.0 不开工——`xstats.KindProbeSent` 在那之前不存在）。

## Global Constraints

- `core/` 一行不碰；gost 行为不变（本 plan 只动 wisper 仓库）。
- `probe` 用 plain bool（照抄 keepalive，不用 `*bool` 小聪明）：
  API 缺省 = false；老已存配置（无该键）保持关，需手动开；新建表单默认开。
- 本 plan 的每一步都不 `commit`／不 `push`（仓库约定 no-auto-commit）；
  每个 Task 结束时工作区只留该 Task 的文件待审。
- UI 文案只说开/关（`switchProbe`/`probeHint`，中英各一），不暴露间隔阈值。

## Review Focus

- PUT 更新 entrypoint 时 body 缺 `probe` 按 keepalive 先例得 false（全量替换语义），
  表单编辑页永远显式回填——Task 3 的接线保证。
- stats tick 可配（`StatsInterval`，默认 1s）：看门狗阈值必须按实际 tick 折算，
  不能写死 60/120 个 tick——Task 4 的纯函数签名 pin 死。
- Restart 后计数 carry-over（`Restart` 已整体拷贝 stats；`update` 路径
  `old.Stats()` 同理）——Task 2 保住不断流。
- 看门狗只看 tun 类型 + running + 开关开三者全满足；hub 侧 tun tunnel 永远跳过
  （无探针）——Task 4 的守卫 pin 死。
- event 文案用常量（`recordPunchFailures` 的 coalesce 先例），冷却内重复触发
  不刷屏——Task 4 的测试 pin 死。

---

### Task 1: bump x 到 v0.23.0

**Files:**
- Modify: `wisper/go.mod`, `wisper/go.sum`

**Interfaces:**
- Consumes: Plan A 的 tag（`git ls-remote https://github.com/go-gost/x v0.23.0`
  能看到才继续）。

- [ ] **Step 1: 确认 tag 存在**

Run: `git ls-remote https://github.com/go-gost/x v0.23.0`
Expected: 看到该 tag（看不到就停，Plan A 没发完）。

- [ ] **Step 2: bump + 构建**

```bash
go get github.com/go-gost/x@v0.23.0 && go mod tidy && go build ./...
```

（`GOWORK=off`，proxy/sumdb 按仓库既有环境；`go.mod` 里已有 `v0.22.0` 的行，
目标是 `v0.23.0`。）

Expected: 构建通过。

---

### Task 2: 配置链（Options → config → entrypoint 映射 → handler metadata）

**Files:**
- Modify: `wisper/tunnel/tunnel.go`（`Options` 加 `Probe bool` + `ProbeOption`，
  照抄 `KeepaliveOption`/`TTLOption`，约 196–206 行）
- Modify: `wisper/config/config.go`（`Tunnel` 加 `Probe bool yaml:"probe,omitempty"`，
  紧随 `TTL` 字段）
- Modify: `wisper/tunnel/entrypoint/entrypoint.go`（所有 `Keepalive:`/`TTL:` 映射点
  旁边加 `Probe:`——`LoadConfig`/`SaveConfig`/`createEntryPoint` 相关三处 +
  第 273–274 行那处，共四处，grep `Keepalive:` 全量跟进；**不碰**
  `tunnel.go` 里 hub tunnel 的映射，那是服务端，与探针无关）
- Modify: `wisper/tunnel/entrypoint/tun.go`（`init()` 的 Handler Metadata 加
  `"probe": s.opts.Probe`；`RunContext` 建 `pStats` 后（约 259–266 行）加
  `"probeReport"` 闭包 + carry-over 两行，见 Step 3）
- Test: `wisper/tunnel/entrypoint/` 既有 mapping 测试若有则扩展，无则加小测试
  （`Options`→`TunnelConfig` 往返带 Probe；先 grep 找既有位置）

**Interfaces:**
- Consumes: Plan A 的 `xstats.KindProbeSent/KindProbeAcked`、
  x metadata 键 `"probe"`（bool）与 `"probeReport"`（`func(uint64, uint64)`，
  语义为增量）。
- Produces: `tunnel.ProbeOption(bool)`；Handler Metadata 里的回调闭包
  `func(sd, ad uint64) { pStats.Add(xstats.KindProbeSent, int64(sd));
  pStats.Add(xstats.KindProbeAcked, int64(ad)) }`（`pStats` 即 `RunContext`
  里那个；`svcCfg.Handler.Metadata` 在 `h.Init` 之前赋值即可，map 可变）。

- [ ] **Step 1: 写 failing test（Option + 映射）**

```go
func TestProbeOptionFlowsToHandlerMetadata(t *testing.T) {
    // tunnel.ProbeOption(true) 进 Options；entrypoint 映射后 opts.Probe==true。
}
```

（按仓库既有测试风格落盘；关键断言就这一条，不铺张。）

- [ ] **Step 2: 运行，确认 FAIL**

Run: `go test ./tunnel/... -run TestProbeOption -v`
Expected: 编译失败（`ProbeOption` 未定义）。

- [ ] **Step 3: 实现 Options/Option + config 字段 + 四处映射 + metadata 接线
  （含 carry-over 两行，照抄 `KindInputBytes` 那四行的格式）**

- [ ] **Step 4: 运行相关测试**

Run: `go test -count=1 ./tunnel/...`
Expected: PASS。

---

### Task 3: API + UI 开关

**Files:**
- Modify: `wisper/api/entrypoint_handler.go`（`entrypointCreateRequest` 加
  `Probe bool json:"probe,omitempty"` + `toOptions` 加 `tunnel.ProbeOption`）
- Modify: `wisper/api/tunnel_handler.go`（entrypoint 共用的 options response
  struct 加 `Probe bool json:"probe,omitempty"` + `toTunnelResponse` 里
  `Probe: opts.Probe`，照抄 `Keepalive` 那两行：约 232 行与 response struct 处）
- Modify: `wisper/web-src/src/api/types.ts`（`EntrypointOptions` 加
  `probe: boolean`；`EntrypointCreateRequest` 加 `probe?: boolean`）
- Modify: `wisper/web-src/src/pages/entrypoint-detail-page.ts`
  （`_probe` state 默认 `true`；load 处照抄 132 行 `?? true`；
  save 处照抄 253–255 行；在 **tun 类型**区块加 switch-row，照抄 1013–1020 行
  的 keepalive 开关 markup，文案键换掉；p2p 类型不动）
- Modify: `wisper/web-src/src/i18n/en.ts`、`zh.ts`
  （`switchProbe`/`probeHint`，照抄 `switchKeepalive`/`keepaliveHint` 旁边）
- Test: `wisper/api/*_test.go`（`race_probe_test.go` 的模式：建 entrypoint 带
  `probe:true` → GET 回来 `options.probe==true`；再 PUT 关掉 → 回来 false）

- [ ] **Step 1: 写 failing test（API 回显）**

```go
func TestCreateEntrypointProbeEcho(t *testing.T) {
    // POST /api/entrypoints {type: tun, ..., probe: true} → 201 且 options.probe==true；
    // PUT 同 id {probe: false} → options.probe==false。
}
```

（先读 `race_probe_test.go` 的 harness（建服/清场），照抄；tun 类型 create
需要 `net` 等字段，照抄 `validateTunEntryPoint` 要求的最小集合。）

- [ ] **Step 2: 运行，确认 FAIL**（`probe` 字段被忽略/回显缺失）

Run: `go test ./api/ -run TestCreateEntrypointProbeEcho -v`
Expected: FAIL。

- [ ] **Step 3: 实现 API 两处 + response 回显**

- [ ] **Step 4: 实现前端四处（types/page/i18n×2）**

- [ ] **Step 5: 运行后端测试 + 前端 typecheck**

Run: `go test -count=1 ./api/`
Expected: PASS（约 2min）。
Run: `cd web-src && npm run typecheck`
Expected: PASS（无输出即过）。

---

### Task 4: 看门狗（stats 映射 + 决策函数 + 接线）

**Files:**
- Modify: `wisper/config/config.go`（`ServiceStats` 加
  `ProbeSent/ProbeAcked uint64`，紧随 `OutputRateBytes`）
- Modify: `wisper/runner/task/stats.go`（`updateEntrypoint` 里加两行映射，
  照抄 136–137 行格式；`updateStatsTask` struct 加
  `probe map[string]*probeState`；`updateEntrypoint` 循环内调
  `t.checkProbe(ep)`——新文件见下）
- Create: `wisper/runner/task/probe.go`（`probeState` + 纯函数 +
  `checkProbe` 接线）
- Test: `wisper/runner/task/probe_test.go`（照抄 `stats_test.go` 的
  `event.Seed` 模式）

**Interfaces:**
- `type probeState struct { lastAcked uint64; misses int; lastRestart time.Time; seeded bool }`
- `func probeTick(st *probeState, acked uint64, now time.Time, tick time.Duration) (event, restart bool)`——纯函数，全部逻辑在此：
  tick 由调用方按 `StatsInterval` 传入（默认 1s）；
  `eventAfter = 60s`，`restartAfter = 120s`，`cooldown = 10min`
  （折算 ticks 时至少 1 tick）；
  acked 推进 → 清零 misses（不碰 lastRestart）；
  未推进 → misses++；达到 event 线 → event=true（每次都报？不——只在刚跨过
  线时报一次 + restart 时报，冷却内重复 tick 不报：用 `reported` 位；细节由测试 pin）；
  达到 restart 线且 `now-lastRestart > cooldown` → restart=true 并更新
  lastRestart；冷却内 → 只 event（已报过则连 event 都不重复）。
- `func (t *updateStatsTask) checkProbe(ep EntryPoint)`——守卫（三者全满足才看：
  `ep.Type()==entrypoint.TunEntryPoint`、`!ep.IsClosed()`、`ep.Options().Probe`），
  读 `ep.Stats().ProbeAcked` 调 `probeTick`，按返回值 `event.Record` /
  `entrypoint.Restart(ep.ID())` + 记录 event（文案常量，见 Review Focus）。
  （import cycle 注意：`runner/task` 已 import `entrypoint`（stats.go:15），安全。）

- [ ] **Step 1: 写 failing test（纯函数表驱动）**

```go
func TestProbeTick(t *testing.T) {
    // 推进→无动作；连停 60 ticks（tick=1s）→event 一次；连停 120→restart；
    // 重启后 10min 内再停→只 event 不 restart；恢复推进→计数清零。
}
```

- [ ] **Step 2: 运行，确认 FAIL**（函数未定义，编译失败）

Run: `go test ./runner/task/ -run TestProbeTick -v`
Expected: 编译失败。

- [ ] **Step 3: 实现 `probe.go`（纯函数 + 接线 + stats 映射两行 +
  `ServiceStats` 两字段）**

- [ ] **Step 4: 运行**

Run: `go test -count=1 ./runner/task/ ./tunnel/... ./config/...`
Expected: PASS。

---

### Task 5: 全链冒烟 + 收尾

- [ ] **Step 1: 全量构建**

Run: `go build ./...`
Expected: 通过。
- [ ] **Step 2: 受影响包全测**

Run: `go test -count=1 ./tunnel/... ./api/ ./runner/...`
Expected: PASS（api 约 2min）。
- [ ] **Step 3: 确认工作区只有本 plan 的文件**（`git status --short`），
  不 commit，交审。
- [ ] **Step 4（审后，另起验证任务，不在本 plan 内）**：按
  `.memory/notes/wisper-apk-build.md` 打包→重签→安装→`start`→
  `ping 10.10.100.1`；杀 VPN 复现 flap（或等自然 flap），看 event 出现
  "probe stalled" → Restart → 恢复。
