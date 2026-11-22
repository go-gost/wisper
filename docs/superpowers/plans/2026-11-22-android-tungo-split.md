# Android tungo 分流入口点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 wisper 增加一个 `tungo` entrypoint 类型：手机侧 tun 设备 → 用户态栈终止流 → 按域名/目的 IP 的 whitelist 决定「经 p2p tcp 流 + relay 协议送到家里的 pi 网关」还是「直连手机自己的网络」。

**Architecture:** 手机侧复用 `x/handler/tungo`（gVisor 栈 + sniffing）与 `x/connector/relay`；分流用链上 hop 的 **whitelist bypass**（清单内选中 relay 节点，清单外落到空路由 → `DefaultRoute.Dial` 直连）。pi 侧只增加一个只绑回环的 relay 服务，复用现有 `relay-wss` 链与 bypasses。

**Tech Stack:** Go 1.26（`x`、`wisper` 两个模块）、gVisor netstack（经 `xjasonlyu/tun2socks/v2`）、gost 的 chain/hop/bypass、Android VpnService（Kotlin + JNI）、`web-src` 的 lit 页面。

**Spec:** `wisper/docs/superpowers/specs/2026-11-22-android-tungo-split-design.md`

## Global Constraints

- 两个仓库：`x/`（module `github.com/go-gost/x`）与 `wisper/`（module `github.com/go-gost/wisper`）。**每个任务在它改动的仓库里单独提交**；x 的改动先提交，wisper 依赖它。
- 开发用工作区（`/root/code/go-gost/go.work` 默认生效，wisper 会用本地 `x`）；发布前必须给 `x` 打 tag 并在 `wisper/go.mod` 升版本。`GOWORK=off` 只用于验证模块图，不用于端到端。
- 永远不 push；每个任务完成后立即提交，commit 里包含该任务的 Implementation record。
- 测试按包运行（通配 `go test ./...` 在本机会挂）。`x`：`cd x && go test ./listener/tungo/...`；`wisper`：`cd wisper && go test ./tunnel/...`。
- 规则清单是 **whitelist**：清单内 → 走隧道；清单外 → 直连。**service 级 bypass 一律不配**（配了命中即丢弃）。
- v1 不实现 fail-open：隧道不通时白名单流量失败（`Router.Dial` 报错、app 的连接被关），这是自然行为，不需要代码。要变成「静默直连」是后续可选项。
- tungo 的服务上**不得**配置 `resolver` / `hosts`（否则 hop 看到的是 IP，域名规则静默失效）。
- 固定取值：pi 的 relay 监听 `127.0.0.1:18080`；手机 VPN 的 `dns` = `192.168.100.100`；内网网段 `192.168.100.0/24`；hub 侧 p2p tunnel 的 `endpoint` = `127.0.0.1:18080`。
- Android 侧：设备由 `VpnService` 创建，fd 经 JNI 交给 Go；app 用 `addDisallowedApplication(packageName)` 排除在 VPN 之外，`protect()` 不得引入。
- 代码注释只用英文。
- APK 构建必须走 `docker` 且 `--network host`（本机直接 `make android` 会失败）。

## Review Focus

1. **清单外的目标必须「直连」，不能「丢弃」** —— hop 命中必须返回 nil 节点并走到
   `DefaultRoute.Dial`；`x` 的 service 级 bypass 一旦被配上，TCP 会被直接丢弃。
   测试：Task 3 的 `TestTungoEntryPointRulesRouteUnlistedDirect`。
2. **CIDR 规则必须能匹配 `host:port`** —— DNS 是 `192.168.100.100:53`，靠
   `192.168.100.0/24` 命中。测试：Task 2 的 `TestRuleBypassCIDRMatchesHostPort`。
3. **运行中改规则不能重建 entrypoint（会 flap VPN）** —— 规则对象必须可原地替换。
   测试：Task 2 的 `TestRuleBypassSwapTakesEffect`，Task 6 的
   `TestEntrypointUpdateKeepsRulesWithoutRestart`。
4. **失败的 tungo 启动必须释放设备 claim** —— 否则之后所有 tun/tungo 都被拒。
   测试：Task 4 的 `TestTungoEntryPointRunFailureReleasesDevice`。
5. **Android 上缺 fd 时必须报错而不是 nil deref** —— 测试：Task 1 的
   `TestTungoListenerAndroidRequiresFD`（用 `fd` 缺失/负值两种输入）。

---

### Task 1: `x/listener/tungo` 的 Android fd 设备路径

**Files:**
- Modify: `x/listener/tungo/tun.go:75-98`（抽出 `newTunDevice`）
- Modify: `x/listener/tungo/tun_linux.go:1`（加 build tag）
- Modify: `x/listener/tungo/listener.go:96-99`（接口查询降级为日志）
- Modify: `x/listener/tungo/metadata.go`（新增 `fd`）
- Create: `x/listener/tungo/tun_android.go`
- Test: `x/listener/tungo/metadata_test.go`

**Interfaces:**
- Produces: metadata key `fd`，接受 `int` 与 `func() int`；`metadata.fd func() int`；
  `newTunDevice(ifce tun.Device) (io.ReadWriteCloser, error)`；Android 下
  `readOffset = 0`、`writeOffset = 0`。
- Consumes: `golang.zx2c4.com/wireguard/tun.CreateUnmonitoredTUNFromFD`（照
  `x/listener/tun/tun_android.go:38`）。

- [ ] **Step 1: 写失败的测试**

`x/listener/tungo/metadata_test.go`：

```go
func TestTungoListenerParsesFDMetadata(t *testing.T) // fd=42 → l.md.fd()==42
func TestTungoListenerParsesFDFuncMetadata(t *testing.T) // fd=func()int{return 7} → 7
func TestTungoListenerAndroidRequiresFD(t *testing.T) // 无 fd → l.md.fd == nil；fd=func()int{return -1} → fd()==-1（监听器据此报错，不 nil deref）
```

- [ ] **Step 2: 运行确认失败**

Run: `cd x && go test ./listener/tungo/ -run TestTungoListener -v`
Expected: FAIL（`l.md.fd` 未定义，编译错误）

- [ ] **Step 3: 实现 metadata 的 fd 解析**

`metadata.go` 的 `metadata` 结构加 `fd func() int`，`parseMetadata` 里按
`x/listener/tun/metadata.go:130-142` 的写法处理 `int` 与 `func() int` 两种类型。

- [ ] **Step 4: 运行确认通过**

Run: `cd x && go test ./listener/tungo/ -run TestTungoListener -v`
Expected: PASS

- [ ] **Step 5: 抽出 `newTunDevice`**

把 `createTunDevice()`（`tun.go:75-98`）里构造 `tunDevice` 缓冲区的部分抽成
`newTunDevice(ifce tun.Device) (io.ReadWriteCloser, error)`，`createTunDevice` 改为
`tun.CreateTUN` 后调用它。行为不变：`go test ./listener/tungo/` 仍应全绿。

- [ ] **Step 6: 加 Android 设备路径与 build tag**

`tun_linux.go` 首行加 `//go:build linux && !android`（否则 Go 会把 `_linux.go` 编给
`GOOS=android`，与 `tun_android.go` 重复定义 `createTun`/`readOffset`/`writeOffset`）。

新建 `tun_android.go`（`//go:build android`）：`readOffset=0`、`writeOffset=0`，
`createTun()` 照 `x/listener/tun/tun_android.go` —— 无 `l.md.fd` 报
`errors.New("tungo: no host device fd")`，`fd() < 0` 报
`errors.New("tungo: no device fd: is the host's VPN up?")`，`syscall.Dup` 后
`CreateUnmonitoredTUNFromFD`，再 `newTunDevice`；`ip` 取 `l.md.config.Net[0].IP`；
不做 netlink / 接口配置 / resolvectl。

- [ ] **Step 7: 验证两个平台都能编**

Run: `cd x && GOOS=android GOARCH=arm64 CGO_ENABLED=0 go build ./listener/tungo && GOOS=linux go build ./listener/tungo && go test ./listener/tungo/ -v`
Expected: 两条 build 都 exit 0（Android 上的重定义错误消失），测试 PASS

- [ ] **Step 8: 提交**

```bash
cd x && git add listener/tungo && git commit -m "feat(tungo): adopt an Android VpnService fd as the tun device"
```

**Implementation record:**

- **日期/状态:** 2026-11-22 — 已完成。
- **仓库 + commit:**
  - `x`（`github.com/go-gost/x`）：`2b43135` `feat(tungo): adopt an Android VpnService fd as the tun device`
  - `wisper`：本任务没有代码改动，只有本条记录（`docs(plan): implementation record for task 1`）。
- **实际改动文件（均在 `x`）:**
  - `listener/tungo/metadata.go` — `metadata` 增加 `fd func() int`，`parseMetadata` 接受
    `int` 与 `func() int`（照 `x/listener/tun/metadata.go`）。
  - `listener/tungo/metadata_test.go`（新增）— 三个 `TestTungoListener*` 测试。
  - `listener/tungo/tun.go` — 抽出 `newTunDevice(ifce tun.Device) (io.ReadWriteCloser, error)`，
    `createTunDevice` 改为 `tun.CreateTUN` + `newTunDevice`。
  - `listener/tungo/tun_linux.go` — 首行 `//go:build linux && !android`。
  - `listener/tungo/tun_android.go`（新增）— `readOffset=0`/`writeOffset=0`；
    `createTun` 缺 fd 报 `tungo: no host device fd`、fd 为负报
    `tungo: no device fd: is the host's VPN up?`，`syscall.Dup` 后
    `tun.CreateUnmonitoredTUNFromFD` + `newTunDevice`；`ip` 取 `config.Net[0].IP`；
    不碰 netlink/接口配置/resolvectl。
  - `listener/tungo/listener.go` — 接口查询（原 96-99 行）失败由 `return err` 降级为
    debug 日志，`addrs` 留空后继续；日志里的 name 改用设备自己报告的名字。
- **执行的命令与结果:**
  - RED：`cd x && go test ./listener/tungo/ -run TestTungoListener -v`
    → `l.md.fd undefined`（编译失败，符合预期）。
  - GREEN：同一条命令 → 3 个测试 PASS。
  - `cd x && GOOS=android GOARCH=arm64 CGO_ENABLED=0 go build ./listener/tungo` → exit 0
    （`tun_android.go` 与 `tun_linux.go` 不再重复定义；`!linux` 的 `tun_other.go` 在
    Android 上仍被排除，因为 `android` 满足 `linux` 标签）。
  - `cd x && GOOS=linux go build ./listener/tungo` → exit 0；
    `GOOS=darwin GOARCH=arm64 go build ./listener/tungo` 与
    `GOOS=windows go build ./listener/tungo` 亦为 exit 0。
  - `cd x && go vet ./listener/tungo`（含 `GOOS=android` 交叉 vet）→ 无输出。
  - `cd x && go test ./listener/tungo/ -count=1 -v` → 全部 PASS；`gofmt -l listener/tungo/` 无输出。
- **评审发现与修复（自审）:**
  - `newTunDevice` 按 plan 保留 `error` 返回值，虽然当前实现不会失败；两处调用点都在失败时
    关闭底层 `ifce`，与 `x/listener/tun/tun_android.go` 一致。
  - `listener.go` 的降级让「设备已建立但接口名查不到」不再丢弃设备；Linux 上
    `CreateTUN` 成功即意味着接口存在，实际不可达，行为等价。
  - 测试只断言 `fd` 语义，不依赖 Android 构建，因此在 Linux 上跑通。
- **遗留项/限制:**
  - `createTun` 的 Android 分支本身没有单测（需要真实 fd + `CreateUnmonitoredTUNFromFD`），
    只由编译与 Task 4 的 entrypoint 级测试覆盖。
  - `tunDevice` 没有 `maxPacket` 溢出保护（`x/listener/tun` 有，见其
    `ErrPacketTooLarge`）；本任务按「行为不变」不引入，Android 上设备 MTU 由 VpnService
    决定，超长写仍可能 panic —— 属既有问题，另行处理。
  - Android 上设备名通常查不到，`addrs` 日志为空属预期。

---

### Task 2: 可热替换的规则 bypass（whitelist）

**Files:**
- Create: `wisper/tunnel/rulebypass.go`
- Test: `wisper/tunnel/rulebypass_test.go`
- Modify: `wisper/tunnel/tunnel.go`（`Options.Rules []string` + `RulesOption`）

**Interfaces:**
- Produces:
  - `type RuleBypass struct`（**导出**，`tunnel/entrypoint` 要用），实现
    `github.com/go-gost/core/bypass.Bypass`；
    `NewRuleBypass(rules []string) *RuleBypass`；方法 `SetRules(rules []string)`、
    `Contains(ctx context.Context, network, addr string, opts ...bypass.Option) bool`。
  - `tunnel.RulesOption(rules ...string) Option`；`Options.Rules []string`。
- 语义：内部用 `xbypass.NewBypass(xbypass.MatchersOption(rules), xbypass.WhitelistOption(true))`，
  **`Contains` 返回 true 表示「清单外」**（`x/bypass/bypass.go:431-455` 的 whitelist 取反）。

- [ ] **Step 1: 写失败的测试**

```go
func TestRuleBypassWhitelistSemantics(t *testing.T)     // 清单含 example.com：Contains("example.com:443")==false，Contains("other.test:443")==true
func TestRuleBypassCIDRMatchesHostPort(t *testing.T)    // 清单含 192.168.100.0/24：Contains("192.168.100.100:53")==false
func TestRuleBypassSwapTakesEffect(t *testing.T)        // SetRules 换成新清单后，旧条目立即变 true、新条目立即变 false（并发读 100 次无 race）
func TestRuleBypassEmptyListMatchesEverything(t *testing.T) // 空清单：Contains 对任何地址都 true（= 全部直连，绝不误送）
```

- [ ] **Step 2: 运行确认失败**

Run: `cd wisper && go test ./tunnel/ -run TestRuleBypass -v`
Expected: FAIL（`NewRuleBypass` 未定义）

- [ ] **Step 3: 实现**

`rulebypass.go`：`sync.RWMutex` + 内部 `bypass.Bypass`；`SetRules` 重新构造内部对象并替换
（不重建 chain、不重启 goroutine）。`Contains` 拿读锁后委托内部对象。
`tunnel.go` 的 `Options` 加 `Rules []string`，`RulesOption` 形如
`func RulesOption(rules ...string) Option`。

- [ ] **Step 4: 运行确认通过（含 race）**

Run: `cd wisper && CGO_ENABLED=1 go test ./tunnel/ -run TestRuleBypass -race -v`
Expected: PASS，无 DATA RACE 报告

- [ ] **Step 5: 提交**

```bash
cd wisper && git add tunnel/rulebypass.go tunnel/rulebypass_test.go tunnel/tunnel.go \
  && git commit -m "feat(tunnel): add a whitelist rule bypass that can be swapped in place"
```

**Implementation record:**

- **日期/状态:** 2026-11-22 — 已完成。
- **仓库 + commit:**
  - `wisper`（`github.com/go-gost/wisper`）：`3e551f9`
    `feat(tunnel): add a whitelist rule bypass that can be swapped in place`
    （代码 + 测试）；本条记录为随后的 `docs(plan)` 提交。
  - `x`：本任务没有改动（直接用 `x/bypass` 的 `MatchersOption` +
    `WhitelistOption(true)`）。
- **实际改动文件:**
  - `tunnel/rulebypass.go`（新增）— 导出 `RuleBypass`：`sync.RWMutex` 保护一个内部
    `bypass.Bypass`；`NewRuleBypass(rules)` 调 `SetRules`；`SetRules` 在锁外重建
    `xbypass.NewBypass(MatchersOption(rules), WhitelistOption(true))`，再在写锁内整体替换
    （不重建 chain、不起 goroutine）；`Contains` 读锁取出内部对象后委托（幂等读，
    不在持锁期间调用外部代码）；`IsWhitelist` 恒为 true。零值 `RuleBypass` 按空清单处理
    （`Contains` 返回 true），不会 nil deref。
  - `tunnel/rulebypass_test.go`（新增）— 四个测试：
    `TestRuleBypassWhitelistSemantics`、`TestRuleBypassCIDRMatchesHostPort`、
    `TestRuleBypassSwapTakesEffect`、`TestRuleBypassEmptyListMatchesEverything`
    （后者含 `nil` / `空切片` 两个子测试，外加「先设清单再清空」）。
  - `tunnel/tunnel.go` — `Options.Rules []string`（带语义注释：清单内走隧道、空清单全部直连、
    编辑由 `SetRules` 原地生效）与 `func RulesOption(rules ...string) Option`。
- **执行的命令与结果:**
  - RED：`cd wisper && go test ./tunnel/ -run TestRuleBypass -v`
    → 编译失败：`undefined: RuleBypass` / `undefined: NewRuleBypass`（符合预期）。
  - GREEN：`cd wisper && CGO_ENABLED=1 go test ./tunnel/ -run TestRuleBypass -race -v`
    → 4 个测试（+2 子测试）全部 PASS，无 DATA RACE 报告。
  - 加注释后再跑 `-race -count=2` → 仍全 PASS。
  - `cd wisper && CGO_ENABLED=1 go test ./tunnel/` → `ok ... 41.848s`。
  - `cd wisper && go vet ./tunnel/` → 无输出；`gofmt -l tunnel/` → 无输出；
    `CGO_ENABLED=1 go build ./...` → exit 0。
- **评审发现与修复（自审）:**
  - 语义核对：`x/bypass` 的 whitelist 是「匹配 = decisionProxy」，故 `Contains` 返回 true
    确实是「清单外 → 直连」，与本 plan 的 Global Constraints 一致；`RuleBypass` 的
    `IsWhitelist` 返回 true 也与这个语义相符。空清单时 `x` 的 `patterns` 保持 nil，走
    「no predicates has no base match」分支 → `decisionBypass` → true，因此无需在
    `RuleBypass` 里另写空清单短路；该不变量由
    `TestRuleBypassEmptyListMatchesEverything` 钉住（万一 `x` 改语义会立刻红）。
  - 锁的范围：`Contains` 只在读锁内拷贝指针，`SetRules` 在锁外构造新对象，避免在持锁时
    调用外部代码，也把写临界区压到一次指针赋值。
  - 命名冲突：本包 `natrules_test.go` 已有 `contains` 辅助函数，测试里的辅助函数改名为
    `ruleMatches`，避免遮蔽。
  - 测试卫生：SWAP 测试不依赖 `time.Sleep`，10 个 goroutine × 100 次并发读，配合 `-race`
    覆盖 `Contains`/`IsWhitelist` 与 `SetRules` 的并发；交换后的断言在 `wg.Wait()` 之后，
    结果确定。
- **遗留项/限制:**
  - `SetRules` 每次都会丢下旧的 `localBypass`；在无 loader 配置时 `x` 不起 goroutine，
    旧对象连同其 `context.CancelFunc` 一起被 GC，未显式 `Close`（`NewBypass` 返回的是
    `bypass.Bypass` 接口，没有 `Close`）。
  - `RuleBypass` 只表述规则，不认识 chain/hop：把它挂到 hop 上、在 entrypoint 里随
    `Options.Rules` 装配与热更新是 Task 3 / Task 6 的事。
  - `x/bypass` 的 `Contains` 对空 `addr` 一律返回 false（=「清单内」）；上层取到的目的地址
    来自 tun 栈，不会是空串，这里不额外处理。

---

### Task 3: `tungo` entrypoint 的类型与配置组装

**Files:**
- Create: `wisper/tunnel/entrypoint/tungo.go`
- Modify: `wisper/tunnel/entrypoint/entrypoint.go:458-470`（`NewByType` 加 case）
- Test: `wisper/tunnel/entrypoint/tungo_test.go`

**Interfaces:**
- Produces: `const TungoEntryPoint = "tungo"`；`NewTungoEntryPoint(opts ...tunnel.Option) EntryPoint`；
  `type tungoEntryPoint struct` 带 `init() error`（测试直接调用）；provider 命名
  `"tungo-ep-" + ID`；规则 bypass 注册名 `"tungo-rules-" + ID`。
- Consumes: `tunnel.NewRuleBypass`、`tunnel.RulesOption`/`Options.Rules`（Task 2）、`tunnel.ChainConfig(id, name, recordMode)`
  （照 `tunnel/entrypoint/p2p.go:125-175`）、`registry.BypassRegistry()`（注册规则对象，
  `x/config/parsing/bypass.List` 从那里取，见 `x/config/parsing/bypass/parse.go:88-99`）。

- [ ] **Step 1: 写失败的测试**

```go
func TestTungoEntryPointServiceConfig(t *testing.T)
// ep.Type()=="tungo"；Endpoint()==peer key；init() 后：
// svc.Handler.Type=="tungo"、svc.Listener.Type=="tungo"、svc.Handler.Chain==svc.Name
// svc.Listener.Metadata: name/mtu/net/routes/dns 与 Options 一致
// svc.Forwarder==nil（有 forwarder 时 tun 类 handler 会绕过 chain）
// node.Addr==peer key、node.Connector.Type=="relay"、node.Dialer.Type=="tcp"、node.Metadata["p2p"]=="tungo-ep-<id>"
// hop.Bypasses == ["tungo-rules-<id>"]
// cfg.Bypasses[0] = {Name: "tungo-rules-<id>", Whitelist: true, Matchers: rules}

func TestTungoEntryPointRulesRouteUnlistedDirect(t *testing.T)
// 用 entrypoint 生成的 config 调 chain_parser.ParseChain（规则对象已注册）
// route := ch.Route(ctx,"tcp","example.com:443"); len(route.Nodes())==1（清单内 → relay 节点）
// route  := ch.Route(ctx,"tcp","1.2.3.4:443");   len(route.Nodes())==0（清单外 → 空路由 = 直连）

func TestTungoEntryPointRequiresPeer(t *testing.T) // 无 peer：Run 前 init 或 Run 返回错误
```

- [ ] **Step 2: 运行确认失败**

Run: `cd wisper && go test ./tunnel/entrypoint/ -run TestTungoEntryPoint -v`
Expected: FAIL（`NewTungoEntryPoint` 未定义）

- [ ] **Step 3: 实现配置组装**

`tungo.go` 里 `init()` 组装与 `p2p.go:127-175` 同形的 `config.Config`：
`Services[0] = {Name, Addr: ":0", Handler{Type:"tungo", Chain: name},
Listener{Type:"tungo", Metadata{name,mtu,net,routes,dns}},
链 hop-0: Bypasses: [rulesName], Nodes[0]{Addr: peer, Connector{Type:"relay"},
Dialer{Type:"tcp"}, Metadata{"p2p": provider}}}`，并加
`Bypasses[0] = {Name: rulesName, Whitelist: true, Matchers: opts.Rules}`。
**不配** `svc.Handler.Bypass`、不配 resolver/hosts。
`NewByType` 加 `case TungoEntryPoint: return NewTungoEntryPoint(options...)`。

- [ ] **Step 4: 运行确认通过**

Run: `cd wisper && go test ./tunnel/entrypoint/ -run TestTungoEntryPoint -v`
Expected: PASS（含链选择的两条断言）

- [ ] **Step 5: 提交**

```bash
cd wisper && git add tunnel/entrypoint/tungo.go tunnel/entrypoint/tungo_test.go tunnel/entrypoint/entrypoint.go \
  && git commit -m "feat(entrypoint): add the tungo entrypoint type and its rule-whitelisted chain"
```

**Implementation record:**

- **日期/状态:** 2026-11-22 — 已完成（本任务只做类型与配置组装；Run/Close 的生命周期是 Task 4）。
- **仓库 + commit:**
  - `wisper`（`github.com/go-gost/wisper`）：`a64cfc7` `feat(entrypoint): add the tungo entrypoint type and its rule-whitelisted chain`
    （代码 + 测试）；`e7345c1` `refactor(entrypoint): keep the tungo rules object on the entrypoint`
    （评审修复轮：存下规则对象、克隆镜像里 `Matchers`、`init()` 的读取加锁、补重复 init 的测试）；
    本条记录为随后的 `docs(plan)` 提交。
  - `x`：本任务没有改动（README 里说的 `x/config`、`chain_parser`、`registry` 都按现状读取）。
- **实际改动文件:**
  - `tunnel/entrypoint/tungo.go`（新增）— `tungoEntryPoint`：`opts`/`peer`/`provider`
    （`tungo-ep-<ID>`）/`rulesName`（`tungo-rules-<ID>`）/`rules`（注册的 `*tunnel.RuleBypass`）/`config` + favorite/stats/cclose 那一套
    （与 `p2p.go`、`tun.go` 同形）。`NewTungoEntryPoint`：ID 为空取 uuid、`MTU<=0` 取
    `tunnel.DefaultTunMTU`（1300，与 tun entrypoint 一致）、Name 默认 `tungo-ep-<ID前8位>`、
    CreatedAt 补当前时间。`ID/Type/Name/Endpoint(=peer key)/Entrypoint(=Net)/Options/Favorite/
    IsFavorite/Stats/SetStats/StatsBaseline/SetStatsBaseline/IsClosed/Err/setErr` 全部就位，
    所以 `createEntryPoint` 的 `SetStats`/`SetStatsBaseline` 可用。
  - `tunnel/entrypoint/tungo.go` 的 `init()`：先校验 peer（为空直接报
    `tungo entrypoint requires a peer public key`，不注册任何东西），再
    `registry.BypassRegistry().Unregister(s.rulesName)` + `Register(s.rulesName, ruleBypass)`,
    并把 `ruleBypass` 存进 `s.rules`（`s.mu` 保护下读取 `opts.Rules` 的克隆），
    然后组装 `x/config.Config`：
    `Services[0] = {Name, Addr: ":0", Handler{Type:"tungo", Chain: name},
    Listener{Type:"tungo", Metadata{name,mtu,net,routes,dns}}}`（**无** Forwarder、**无**
    `svc.Bypass`/`svc.Bypasses`、**无** resolver/hosts）；链由
    `tunnel.ChainConfig(id, name, recordMode)` 生成后把 hop-0 改成
    `Bypasses: [s.rulesName]`、其唯一 node 改成
    `{Addr: peer, Connector: relay, Dialer: tcp, Metadata: {"p2p": "tungo-ep-<id>"}}`；
    `Bypasses[0] = {Name: s.rulesName, Whitelist: true, Matchers: <opts.Rules 的克隆>}`
    作为自描述副本（运行期权威仍是注册表里的 `*tunnel.RuleBypass`）。
  - `tunnel/entrypoint/tungo.go` 的 `Close()`：幂等，关 `cclose` 并 unregister 规则 bypass
    （设备 claim、host 引用与 service 随 Task 4 到来）。
  - `tunnel/entrypoint/entrypoint.go` — `TungoEntryPoint = "tungo"` 常量（带语义注释）与
    `NewByType` 的 `case TungoEntryPoint: return NewTungoEntryPoint(options...)`。
  - `tunnel/entrypoint/tungo_test.go`（新增）— `tungoCleanup` 辅助（`t.Cleanup` 清理
    `tungo-rules-*` 与 `tungo-ep-*`）+ 三个测试 + 一个 `stubTunnel`
    （`xp2p.Tunnel` 的空实现，只让链能 parse/route，不碰网络）。
- **执行的命令与结果:**
  - RED：`cd wisper && go test ./tunnel/entrypoint/ -run TestTungoEntryPoint -v`
    → 编译失败：`undefined: NewTungoEntryPoint`、`undefined: TungoEntryPoint`（符合预期）。
  - GREEN：同一条命令 → 3 个测试（+3 子测试）全部 PASS；修复轮后为 4 个测试（+4 子测试）。
  - 变异验证（证明断言的力度）：把 `hop.Bypasses = []string{s.rules}` 临时删掉后
    `-run TestTungoEntryPointRulesRouteUnlistedDirect` → `unlisted_address` 子测试报
    `Route("1.2.3.4:443") has 1 nodes, want 0`；恢复后全绿。
  - `cd wisper && CGO_ENABLED=1 go test ./tunnel/entrypoint/ -run TestTungoEntryPoint -race -count=2`
    → PASS，无 DATA RACE。
  - `cd wisper && go test ./tunnel/entrypoint/ -count=1` → `ok ... 20.330s`（整包回归）。
  - `cd wisper && go vet ./tunnel/entrypoint/` → 无输出；`gofmt -l tunnel/entrypoint/` → 无输出；
    `go build ./...` → exit 0。
- **评审发现与修复（自审）:**
  - `config.HandlerConfig` 没有 `Bypass` 字段：service 级 bypass 只能落在
    `ServiceConfig.Bypass/Bypasses`，断言据此改为对这两个字段的「必须为空」检查。
  - 规则 bypass 必须在 `ParseChain` 之前注册（`x/config/parsing/bypass.List` 只查注册表，
    `config.Bypasses` 里的条目永远不会被解析），因此注册放在 `init()` 里、
    并在注册前 `Unregister` 掉上一次运行留下的同名条目（照 `p2p.go` 的 provider 写法）。
  - 服务上刻意不配 resolver/hosts：`x/chain/router.go` 会先 resolve，域名规则就再也看不到
    域名（spec §3.8）。测试用「resolver/hosts 必须为空」把它钉住。
  - 测试不依赖真实配置目录（`t.Setenv("XDG_CONFIG_HOME", t.TempDir())`，并
    `cfg.Set(&cfg.Config{})` 让 `tunnel.ChainConfig` 有 Settings 可读），注册表条目全部
    由 `tungoCleanup` 的 `t.Cleanup` 收走，`-count=2` 通过说明没有跨测试泄漏。
  - `Options()` 克隆 `Rules`（这是唯一可被原地修改的字段），其余保持不可变；
    `Endpoint()` 返回 peer key、`Entrypoint()` 返回设备地址（`Net`），与 tun entrypoint 一致。
- **遗留项/限制:**
  - **`Run()` 目前是明确的未实现桩**（返回 `tungo entrypoint: the run lifecycle is not
    implemented yet`），`Status()` 返回 nil，`Close()` 只回收规则 bypass：设备 claim、
    `AcquireP2PHost`、provider 注册、Android `WaitTunFD`、`xservice.NewService` 与 stats
    基线都是 Task 4 的内容。类型为了实现 `tunnel.Tunnel` 接口无法省略这些方法。
  - **`restoreAsync` 仍只认 `tun`**、`CheckTunDeviceFree` 的措辞仍只讲 tun——按分工留给
    Task 4（设备互斥泛化）与 Task 6（API/UI）。
  - **规则热更新接缝已就位**：`s.rules` 是注册的那个 `*tunnel.RuleBypass`，Task 6 直接
    `s.rules.SetRules(...)` 即可原地更新。注意 `init()` 是「先克隆 `opts.Rules`、后写
    `s.rules`」两段临界区，Task 6 的热更新若正好落在中间会被 init 覆盖 —— 接缝时应把两段
    合成一段，或在 init 里复用既有对象而不是新建。
  - **`Close()` 仍按名字无条件注销**：只有 Task 4 用 `s.rules` 与注册表里的对象做身份比较，
    才能保证「失败的 init 之后 Close 不会误撤掉后任实例的注册」。
  - `NewByType(TungoEntryPoint)` 生成的 entrypoint 在 Task 6 的 API 校验之前若被直接
    `Start`，会得到上面的「未实现」错误而不是半启动——这是刻意的失败方式。
  - 健康/观测（v1 不实现包级 liveness）与 `relay` 的 FUDP 端到端都还没验证（Task 5）。

---

### Task 4: `tungo` entrypoint 的生命周期

**Files:**
- Modify: `wisper/tunnel/entrypoint/tungo.go`
- Modify: `wisper/tunnel/entrypoint/entrypoint.go`（`restoreAsync` 认 tungo；
  `CheckTunDeviceFree` 的注释与「谁持有设备」的措辞）
- Test: `wisper/tunnel/entrypoint/tungo_test.go`

**Interfaces:**
- Consumes: `tunnel.AcquireP2PHost`/`ReleaseP2PHost`、`registry.P2PRegistry()`、
  `tunnel.ClaimTunDevice(id,name)`/`ReleaseTunDevice(id)`/`WaitTunFD(d)`、
  `vpnDeviceWait`（`tunnel/entrypoint/tun.go:47`）
- Produces: `Run`/`RunContext`/`Close`；Android 上
  `svc.Listener.Metadata["fd"] = func() int { return tunnel.WaitTunFD(vpnDeviceWait) }`
  （照 `tun.go:487-493`）；失败路径回滚 claim、provider 注册与 host 引用。

- [ ] **Step 1: 写失败的测试**

```go
func TestTungoEntryPointRequiresPeerKey(t *testing.T)        // Run 无 peer → 错误信息含 "peer"
func TestTungoEntryPointClaimsDevice(t *testing.T)           // 运行中 ClaimTunDevice 冲突：TunDeviceOwner()==(id,name)
func TestTungoEntryPointRunFailureReleasesDevice(t *testing.T) // 注入 parse 失败（如非法 rules）后 TunDeviceOwner()==""
func TestTungoEntryPointCloseReleasesProvider(t *testing.T)  // Close 后 registry.P2PRegistry().Get("tungo-ep-<id>")==nil
```

- [ ] **Step 2: 运行确认失败**

Run: `cd wisper && go test ./tunnel/entrypoint/ -run TestTungoEntryPoint -v`
Expected: FAIL（Run/Close 未实现）

- [ ] **Step 3: 实现**

照 `tunnel/entrypoint/p2p.go:186-260` 的 acquire → register provider → punch → parse chain
→ `xservice.NewService` → serve 顺序，加上 `tun.go:673-693` 的
claim（无设备则失败并回滚）/release、Android 的 `WaitTunFD` 注入、stats 基线
（`StatsOption`）。`Close` 幂等：unregister provider、release host、release device、
关 service。**device listener 要挂 `stats`（`listener.StatsOption(pStats)`），与 `tun.go:749`、
`p2p.go:272` 的 spoke 写法一致** —— 这一侧只有 listener 会写这些计数器（`x/service` 只计错误），
所以不存在双计；hub 的「device 被算成一条连接」问题只发生在 hub 的 device handler 侧。
失败必须能看见：
`setErr` + `event.Record`，让 entrypoint 在列表里显示失败；v1 不实现包级 liveness。

- [ ] **Step 4: 运行确认通过（含 race）**

Run: `cd wisper && CGO_ENABLED=1 go test ./tunnel/entrypoint/ -race -v`
Expected: PASS，无 DATA RACE

- [ ] **Step 5: 提交**

```bash
cd wisper && git add tunnel/entrypoint && git commit -m "feat(entrypoint): run and tear down the tungo entrypoint"
```

**Implementation record:**

- **日期/状态:** 2026-11-22 — 已完成。
- **评审修复轮:** `1a87d0f` `fix(entrypoint): restart and count the tungo entrypoint like the other spokes`
  —— 两个 Important（`RestartP2PRunning` 补 `tungo` + 重启测试；device listener 挂 `listener.StatsOption`，
  与 `tun.go:749`/`p2p.go:272` 一致，反转了原先「不带 stats」的测试缝）与两个 Minor（`init()` 赋完
  `s.rules` 后重查 `IsClosed()` 并按身份注销；`Close` 的 provider 按名字注销处补顺序假设注释）。
  re-review 另指出：扩张后的重启路径会走 `restartRunning`，而它的 `Options` 字面量与
  `tunnel.TunnelOptions` 都没有 `Rules` —— 这会把清单清空成「全部直连」。当前不可达（API/config 还没有
  `rules` 字段），已移交 Task 6 并写进它的文件清单与测试清单。
- **仓库 + commit:** `wisper` — `feat(entrypoint): run and tear down the tungo entrypoint`（本次提交，见下）；
  计划文档的记录另用 `docs(plan)` 提交。不涉及 `x`。
- **实际改动的文件:**
  - `tunnel/entrypoint/tungo.go`：`Run`/`RunContext`/`Status` 落地（acquire host → claim 设备
    → 注册 provider → punch → `ParseChain` → 建 device listener → handler → `xservice.NewService`
    → 发布 → `Serve` goroutine），`claimDevice`/`releaseDevice`/`fail` 三个私有方法，
    `Close` 补全；类型新增 `forward`/`acquired`/`claimed` 字段；`newDeviceListener`、
    `sharedDevice` 两个包级接缝；`init()` 增加 Android `fd` 注入、`Register` 失败清空 `s.rules`，
    并改写 `s.rules` 的字段注释。
  - `tunnel/entrypoint/entrypoint.go`：`restoreAsync` 认 `TungoEntryPoint`；
    `CheckTunDeviceFree` 注释与错误措辞泛化为「持有设备」；`restore`/`Start` 的注释同步。
  - `tunnel/entrypoint/tungo_test.go`：`TestTungoEntryPointRequiresPeer`（改为驱动 `Run`）+
    新增 `TestTungoEntryPointClaimsDevice`、`TestTungoEntryPointRunFailureReleasesDevice`、
    `TestTungoEntryPointCloseReleasesProvider`、`TestTungoEntryPointAndroidAsksForTheDeviceFD`、
    `TestTungoStaleCloseKeepsSuccessorRules`，以及 `tungoRunConfig`/`useSharedDevice`/
    `useDeviceListener`/`loopbackDeviceListener`/`failingDeviceListener` 辅助件。
    `TestTungoEntryPointServiceConfig` 增加「桌面上不该有 `fd`」断言。
  - `tunnel/entrypoint/restore_test.go`：`TestRestoreAsyncOnAndroidTun` →
    `TestRestoreAsyncOnAndroidDevice`（两种设备类型）；新增谓词表测试
    `TestRestoreAsyncPredicate`；`TestRestoreWaitsEverywhereElse` 增加 `tungo` 的非 Android 用例。
- **测试/命令与结果:**
  - RED：`cd wisper && go test ./tunnel/entrypoint/ -run 'TestTungo|TestRestore' -count=1`
    → `FAIL [build failed] ... undefined: sharedDevice / newDeviceListener`（新生命周期测试
    引用的实现与接缝尚不存在）。
  - GREEN：`cd wisper && CGO_ENABLED=1 go test ./tunnel/entrypoint/ -race -count=1`
    → `ok github.com/go-gost/wisper/tunnel/entrypoint 37.256s`，无 DATA RACE。
  - `cd wisper && go test ./tunnel/entrypoint/ -count=2` → `ok ... 72s`（无跨测试泄漏）。
  - `cd wisper && go test ./tunnel/ ./api/ -count=1` → `ok tunnel 41.795s`、`ok api 134.063s`。
  - `GOOS=android GOARCH=arm64 CGO_ENABLED=0 go build ./tunnel/... && GOOS=linux go build ./...`
    → 两条均 exit 0。
  - 变异验证（逐条临时改坏实现，确认对应测试会红，随后逐一还原）：
    注释掉 `RunContext` 里的 `claimDevice()` → `TestTungoEntryPointClaimsDevice` 红
    （`device owner = ("", ""), want ("tungo-device", "phone")`）；去掉回滚里的
    `releaseDevice()` → `TestTungoEntryPointRunFailureReleasesDevice` 红
    （`a failed Run kept the device claimed by ("tungo-run-fail", "phone")`）；`Close` 改回按名字
    无条件注销规则 → `TestTungoStaleCloseKeepsSuccessorRules` 红；`Close` 去掉 provider 注销 →
    `TestTungoEntryPointCloseReleasesProvider` 红；`restoreAsync` 改回只认 `tun` →
    `TestRestoreAsyncPredicate` 红（`restoreAsync(android, tungo) = false, want true`）。
- **评审发现与修复（自审）:**
  - `x/registry` 的 **bypass** 注册表 `Get` 返回的是 `*bypassWrapper`（每次调用新建），不是
    注册时的对象，因此「身份比较」必须读 `GetAll()[name]`；否则 `Close` 永远认为名字不是自己的，
    规则永不注销（`TestTungoEntryPointServiceConfig` 立刻抓到）。
  - `claimDevice` 把 `ClaimTunDevice` 放在 `s.mu` 内完成（`Close` 读 `claimed` 也在同一把锁内），
    于是「Close 正好落在 claim 中间」只有两种结局：Close 看到 claim 并释放，或 claim 看到
    `IsClosed` 并拒绝。`releaseDevice` 只在 `claimed` 为真时释放，避免更新后同 ID 的后任实例
    被前任的 Close 解掉。
  - 回滚只做 `provider`+`host`+`device` 三件（规则属 `init` 的注册物，由 `Close` 负责）；
    `Close` 先于发布落地时（Android 后台 restore），`Run` 的发布锁内检查会走
    `ErrEntryPointClosed` 分支并自己关掉服务，避免「没人关的服务」。
  - `ErrEntryPointClosed` 不再 `setErr`/记事件：关闭是「停止」而非失败（`handleStart` 用
    `Err() != nil` 判定「failed 但没关」的卡死状态，误记会让已关闭的 entrypoint 被当成卡死）。
  - 测试辅助件 `loopbackDeviceListener` 顺带钉住两条硬约束：device listener **不带** stats
    （否则设备被算成一条连接、字节双计）、地址只能是 `:0`。
  - `tungoRunConfig` 用**独立**的 derp URL 并在结束时还原全局 config：共享 p2p host 在最后一次
    release 后有 30s 宽限期，若沿用 p2p 测试的 settings，下一轮（`-count=2`）会复用上一轮
    host 与旧身份目录，`TestP2PEntryPointLifecycle` 找不到自己的 `host.key`。这是本包既有的
    顺序敏感性，用「不同 settings」隔离而不是去动它。
- **遗留项/限制:**
  - `RestartP2PRunning`（`entrypoint.go:267-273`）仍只匹配 `p2p`/`tun`：tungo 同样消费共享 host，
    身份重置后不会被重建。不在本任务文件清单内（Task 6 的 API/类型收尾处一并处理），且在
    linux 上驱动一次真实重建会去建 tun 设备，测试面需要另设接缝。
  - `Close` 的**身份比较只覆盖规则 bypass**：provider 仍按名字注销（与 `p2p`/`tun` 一致）。
    现有 `Restart`/`Delete` 路径都是「先关旧、再建新」，所以名字不会被后任抢走；若将来出现
    「先建新后关旧」，同一 ID 的后任 provider 会被前任的 Close 撤掉（`x` 的 Unregister 会
    close 它找到的值，但 `p2pProvider.Close` 是 no-op，故实际影响限于按名字查找）。
  - `init()` 里 `BypassRegistry().Register` 失败时的 `s.rules = nil` 分支没有测试：失败只可能
    来自「Unregister 与 Register 之间有人抢先注册同名」，无法在不加接缝的情况下注入。
  - 代价：`Close` 为一次身份比较会 `GetAll()` 复制整张 bypass 表（条目数＝entrypoint/tunnel
    的 bypass 数，量级很小）。
  - 设备 fd 的等待（`WaitTunFD(vpnDeviceWait)`）在测试里只验证了「注入的是 provider 而不是
    固定值」，真实 10s 等待行为仍只有 Android 真机/`x` 侧覆盖。

---

### Task 5: 端到端 —— relay over p2p（TCP 与 DNS/UDP）

**Files:**
- Test: `wisper/tunnel/tungo_e2e_test.go`，**必须带 `//go:build p2ppoc`** —— 它复用的
  `startEchoServer`/`startDerper`/`newDialingHost`/`registerProvider` 全在
  `tunnel/p2p_e2e_test.go`、`p2p_poc_test.go`、`p2p_udp_poc_test.go` 的同一 tag 下，
  所以默认 `go test ./tunnel/` 不会跑到它。

**Interfaces:**
- Consumes: Task 3 的 `tungoEntryPoint.init()`（取它生成的 chain 配置）、
  `x/handler/relay`、`x/listener/tcp`、Task 6 之前不需要 API。
- Produces: 两个测试，证明 spec 的传输核心。

- [ ] **Step 1: 写失败的测试**

```go
func TestTungoChainRelaysOverP2P(t *testing.T)
// 起一个本地 relay 服务 = xservice.NewService(name, tcp listener(127.0.0.1:0), handler relay)，
// **不配 chain**：relay handler 直接拨请求里带的地址。把它的地址作为 wisper p2p tunnel 的
// endpoint（runTunnel 的 echo 参数处），于是「手机 → p2p 流 → 这层 → echo」成立。
// 用 entrypoint 生成的 chain 配置 ParseChain，Router.Dial("tcp", echoAddr)
// 断言：数据往返成功，且 relay 服务侧确实处理过连接

func TestTungoChainRelaysUDPOverP2P(t *testing.T)
// 同样的链路，Router.Dial("udp", udpEchoAddr)：起一个 UDP echo（DNS 形状：收到什么回什么）
// 断言：FUDP 帧化的数据往返成功（这是 DNS 走隧道的唯一依赖）

func TestTungoChainUnlistedGoesDirect(t *testing.T)
// 清单只含 example.com；Router.Dial("tcp", <本地 echo 地址>) 必须成功且不产生 relay 连接
```

- [ ] **Step 2: 运行确认失败**

Run: `cd wisper && go test -tags p2ppoc ./tunnel/ -run TestTungoChain -v -count=1`
Expected: FAIL（entrypoint 生成的链尚不能连接 relay 服务，或 FUDP 路径报错）

- [ ] **Step 3: 修到通过**

失败通常只会暴露接线问题（relay 服务是否接受请求里的地址、p2p provider 命名、network 参数）。
只允许改测试里的 server 配置或 `tungo.go` 的组装，**不要改 x**。

- [ ] **Step 4: 运行确认通过**

Run: `cd wisper && go test -tags p2ppoc ./tunnel/ -run TestTungoChain -v -count=1`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd wisper && git add tunnel/tungo_e2e_test.go && git commit -m "test(tunnel): relay and FUDP over the p2p link end to end"
```

**Implementation record:**

- **日期/状态:** 2026-11-22 — 已完成。
- **评审修复轮:** `69998bb` `test(tunnel): keep the tungo e2e output pristine and its assertions tight`
  —— Important（`-v` 输出不干净）+ 三个 Minor（`!= 1` 断言、接缝的注册副作用注释、`RunContext` 里不可达的 err 分支）。
  全套 p2ppoc 里 `TestP2PTunnelDirectPath` 的失败在改动前就存在（stash 后同样失败），与本任务无关。
- **仓库 + commit:** `wisper` —
  `0895c14` `test(tunnel): relay and FUDP over the p2p link end to end`（新测试 + `ChainConfig` 接缝）、
  `1201271` `fix(tunnel): keep one logger type in the test binary`（先决修复，见下）；
  计划文档的记录另用 `docs(plan)` 提交。不涉及 `x`，也没有改 `api/`、`config/config.go`、`web-src/`、Kotlin。
- **实际改动的文件:**
  - `tunnel/tungo_e2e_test.go`（新，`//go:build p2ppoc`）：三个测试 + 三个辅助件。
    `countingListener` 包一层 tcp listener 数「服务接受了几条连接」，是「这条流到底走没走 relay」
    的唯一证据；`startRelayService` 起 pi 那侧的替身 =
    `xservice.NewService(name, tcp(127.0.0.1:0), handler relay)`，**不配 chain**，所以 handler 直接
    拨请求里的地址；`startSplitLink` 串起整条链路：derper → 全局 config（relay only）→ relay 服务
    → 近侧 host（`newDialingHost`）→ wisper p2p tunnel（`runTunnel`，endpoint = relay 服务地址，
    allowlist = 近侧 host 的 key）→ `NewTungoEntryPoint(peer = hub key, rules = [listed])` →
    `ChainConfig()` → 按链节点的 `metadata.p2p` 注册 provider → `ParseChain` → `xchain.NewRouter`。
  - `tunnel/entrypoint/tungo.go`：新增 `ChainConfig() (*xconfig.ChainConfig, error)`
    （`s.config == nil` 时先 `init()`，之后返回 `s.config.Chains[0]`），`RunContext` 的
    `ParseChain` 改为从它取配置。这是本次唯一的实现改动：`init()` 是同包私有方法，而测试必须留在
    `tunnel/`（复用 p2ppoc 辅助件，且验收命令就是 `./tunnel/`），所以把「组装」暴露成一个接缝，
    Run 与测试读同一份 —— 而不是让测试照抄那 20 行组装（那样只证明测试自己的拷贝能跑）。
  - `tunnel/lan_allow_test.go`：`init()` 的 logger 从 `xlogger.Nop()` 改成
    `xlogger.NewLogger(OutputOption(io.Discard))`（见「评审发现」）。
- **测试/命令与结果:**
  - **先决阻塞（与本任务无关的既有破坏）**：HEAD 上任何 p2ppoc 运行都在 init 阶段 panic：
    `panic: sync/atomic: store of inconsistently typed value into Value`，栈指向
    `tunnel_test.init.0` → `p2p_poc_test.go:50`。同一个测试二进制里，`tunnel`（内部测试包，
    `lan_allow_test.go`，commit `50c314b`）先存了 `*logger.nopLogger`，`tunnel_test`（外部测试包）
    再存 `*logger.slogLogger`，而 `core/logger` 的默认值是 `atomic.Value`。把内部包改成存
    `NewLogger`（同类型）后套件重新可跑。
  - RED（接缝之前）：`cd wisper && go test -tags p2ppoc ./tunnel/ -run TestTungoChain -v -count=1`
    → 三条全红，`tungo entrypoint *entrypoint.tungoEntryPoint does not expose the chain it assembles`
    （16.73s / 0.29s / 0.28s）。
  - GREEN：同命令 → `--- PASS` ×3，`ok github.com/go-gost/wisper/tunnel 0.785s`。
  - `cd wisper && go test -tags p2ppoc ./tunnel/ -count=1` → `ok ... 83.958s`（新文件没有破坏既有
    p2ppoc 套件，含依赖 docker/derper 的 UDP 与 probe 场景）。
  - `cd wisper && CGO_ENABLED=1 go test ./tunnel/entrypoint/ -race -count=1` → `ok ... 43.315s`
    （`ChainConfig` 与 `Run` 的改动在既有 entrypoint 套件下无回归、无 DATA RACE）。
  - `cd wisper && go test ./tunnel/ -count=1` → `ok ... 41.732s`（不带 tag 的默认套件，覆盖
    `lan_allow_test.go` 的 init 改动）。
  - 变异验证（临时改坏「前提」，确认对应断言会红，随后还原）：把 `TestTungoChainRelaysOverP2P`
    的清单改成 `example.com` → 红
    （`relay service accepted 0 connections, want the listed flow to have gone through it`）；
    把 `TestTungoChainUnlistedGoesDirect` 的清单改成 echo 地址 → 红
    （`relay service accepted 1 connections, want an unlisted destination to stay off the tunnel`）。
    即两个方向都由计数断言兜住，不只是「数据能往返」。
- **评审发现与修复（自审）:**
  - 计划本身有矛盾：「测试放在 `tunnel/`、复用 `tunnel_test` 的辅助件」与「调用 `init()`（同包）」
    不能同时成立 —— `init()` 是 `entrypoint` 包私有，`tunnel/` 只能是 `tunnel`/`tunnel_test`。
    取了最贴近两者意图的做法（`ChainConfig` 接缝 + 测试留在 `tunnel/`），而不是把测试挪去
    `tunnel/entrypoint/`（那样 `go test ./tunnel/ -run TestTungoChain` 只会「no tests to run」，
    验收命令失效）或在那里重抄一遍 derper/echo 辅助件。
  - 规则 bypass 的 `t.Cleanup` 注册在断言之前：`len(hop.Bypasses) != 1` 之类的 `Fatalf` 若先发生，
    名字会漏在进程里留给后面的测试。provider 由 `registerProvider` 自带清理，p2p tunnel 与 key 由
    `runTunnel` 清理，derper/host/relay 服务/router 各自 `t.Cleanup`；LIFO 顺序保证 router 先关、
    名字后撤。
  - 无 `time.Sleep`、无固定端口（tcp/udp 都绑 `127.0.0.1:0`，derper 用 `freePort`），断言靠因果顺序
    而不是轮询：计数在往返成功时必然已经发生（流必须先到 relay 才能拿到 echo）；「未列」那条不需要
    等待，因为正确实现只做一次选择，而「先直连又偷偷摸到 relay」会让计数变 1。
  - 输出已干净：修复轮把 `ParseChain`/router/relay 服务换成 discard logger，并在链路存活期间临时替换进程
    默认 logger（`t.Cleanup` 最先注册、最后执行以还原）；`-v` 下只剩 p2p 库自己的 INFO 行。
  - 三处空白/显式导入（`x/connector/relay`、`x/dialer/tcp`、`x/handler/relay`、`x/listener/tcp`）
    是本文件自洽所需；没有改动 `x/`。
- **遗留项/限制:**
  - `ChainConfig` 是**为接缝而存在**的导出方法（外层类型未导出，包外只能靠接口断言拿到），Run 也改用它，
    所以不是死代码；但它确实给公开方法面加了一条。若评审更希望「测试进 entrypoint 包」，代价是复制
    ~120 行 derper/echo 辅助件，并且验收命令要跟着改。
  - 远侧是**替身**：无 chain 的 relay 服务。证明的是「手机侧组装 + p2p 流 + relay 协议 + FUDP 帧化」；
    pi 真实的 `relay-wss` 链与它的 hop bypasses（`bypass-gfw`/`bypass-local`）不在本测试内。
  - FUDP 只验证小载荷（DNS 形状）。relay 的 UDP 数据面是「流上 2 字节长度前缀 + `xnet.Pipe` 把一次
    Read 写成一次 Write」，大报文会被拆/并；这不是本任务引入的行为，也未覆盖。
  - 失败策略（spec §8.1：隧道不可用时 fail-closed 还是静默直连）、观测、以及 p2p 断链时的表现都未覆盖
    （留给 Task 7）。
  - 套件依赖 docker 或缓存里的 derper 二进制（`derperBin`）；缺失时 `startDerper` skip，本文件的三个
    测试随之 skip —— 这是既有的 p2ppoc 约定。

---

### Task 6a: Go 侧 —— 配置、API、以及三条重建路径的 `Rules`

**Files:**
- Modify: `wisper/config/config.go`（`Tunnel` 加 `Rules []string` yaml/json `rules`）
- Modify: `wisper/tunnel/entrypoint/entrypoint.go:304-343`（`restartRunning` 的 `tunnel.Options` 字面量要复制 `Rules`）
- Modify: `wisper/tunnel/tunnel.go:874-907`（`TunnelOptions` 要带上 `RulesOption(opts.Rules)` —— 否则
  `Restart` / `handleStartEntrypoint` / `restartRunning` 三条重建路径都会把清单清空成「全部直连」）
- Modify: `wisper/api/entrypoint_handler.go`（create request 的 `Rules *[]string`（缺席=沿用、`[]`=清空，
  与 `blocked_peers` 同语义）+ `toOptions` 里的 `tunnel.RulesOption(derefStrings(r.Rules)...)`；
  `entrypoint_handler.go:143-147` 的类型校验加 `case entrypoint.TungoEntryPoint:
  validateTungoEntryPoint(req)` —— 要求 `net` 与 `peer`，`rules` 可空（空=全部直连））
- Modify: `wisper/api/entrypoint_handler.go:24`（`Peer` 字段的注释从 "p2p and tun" 改成含 tungo）
- Test: `wisper/api/api_test.go`、`wisper/tunnel/entrypoint/restart_test.go`、`restart_p2p_test.go`

**Interfaces:**
- Consumes: `tunnel.RulesOption`（Task 2）、`TungoEntryPoint`（Task 3）、`s.rules`（Task 3 的修复轮）
- Produces: JSON 字段 `rules: ["example.com","home.pi","192.168.100.0/24"]`；`config.Tunnel.Rules`；
  三条重建路径都保留 `Rules`

- [ ] **Step 1: 写失败的测试**

```go
func TestEntrypointCreateTungoWithRules(t *testing.T)          // POST type=tungo+rules → 201；GET 回读 rules 一致
func TestEntrypointCreateTungoRequiresNetAndPeer(t *testing.T) // 缺 net 或 peer → 400，错误信息点名缺哪个
func TestEntrypointUpdateKeepsRulesWithoutRestart(t *testing.T) // PUT 只改 rules → entrypoint ID 不变、服务未重建（统计基线保留）、新规则立即生效
func TestRestartRunningKeepsRules(t *testing.T)                // restartRunning → 重建后的 Options.Rules 与旧值一致
func TestRestartP2PRunningKeepsTungoRules(t *testing.T)        // ResetP2PIdentity 触发的重启同样保留 Rules
```

- [ ] **Step 2: 运行确认失败**

Run: `cd wisper && go test ./api/ -run "TestEntrypointCreateTungo|TestEntrypointUpdateKeepsRules" -v`
Expected: FAIL（未知类型 `tungo` / 字段被忽略）

- [ ] **Step 3: 实现**

`config.Tunnel.Rules`、`api` 的 `Rules *[]string` + `toOptions`、`restartRunning` 复制、
`tunnel.TunnelOptions` 带上 `RulesOption`。**热更新**：`SetRules`（`s.rules.SetRules(...)` 原地替换）
要绕开 Task 3 记录里指出的「init 两段临界区」隐患 —— 在两个临界区之间落地会被覆盖，所以把
「克隆 `opts.Rules` + 赋值 `s.rules` + 写镜像」收进同一段锁内。

- [ ] **Step 4: 运行确认通过**

Run: `cd wisper && CGO_ENABLED=1 go test ./api/ ./tunnel/entrypoint/ -race -count=1`
Expected: PASS，无 DATA RACE

- [ ] **Step 5: 提交**

```bash
cd wisper && git add config api tunnel/entrypoint tunnel/tunnel.go \
  && git commit -m "feat(api): expose the tungo entrypoint type and its domain rules"
```

**Implementation record:**

- **日期/状态:** 2026-11-22 — 已完成。
- **评审修复轮:** `dba2ee7` `test(api): pin the tungo create and update premises`
  —— create 测试的「内核拒绝设备名」前提改为轮询断言（1s 内必失败，不再可能悄悄建出真实接口）；
  新增「改 `net` 必须重建」的反方向用例；`s.config` 的读进锁；测试断言改 comma-ok。
- **行为变化（要告诉 UI）：** 以前每次 `PUT` 都会重建运行中的 entrypoint（等于「保存即重启」），
  现在只有真正改了非规则字段才重建。想重启一个健康运行的 tungo entrypoint 需要**先停再启**；
  `POST /start` 对运行中的实例返回 `409 already running`。
- **仓库 + commit:**
  - `wisper`（`github.com/go-gost/wisper`）：`beebd17`
    `feat(api): expose the tungo entrypoint type and its domain rules`（代码 + 测试）；本条记录为随后的
    `docs(plan)` 提交。
  - `x`：本任务没有改动（按分工不改 `x/`；期间发现的 `x/handler/tungo` 关闭竞态见「遗留项」）。
- **实际改动文件:**
  - `config/config.go` — `Tunnel.Rules []string`，yaml/json 都是 `rules,omitempty`
    （带语义注释：whitelist、空=全部直连、编辑原地生效不重建）。
  - `tunnel/tunnel.go` — `TunnelOptions` 加 `RulesOption(opts.Rules...)`；`TunnelOptions` 的注释补上
    「它也是三条重建路径共用的那组字段」。
  - `tunnel/entrypoint/entrypoint.go` — `restartRunning` 的 `tunnel.Options` 字面量加
    `Rules: p.opts.Rules`（并加注释说明这个字面量漏字段会静默丢）；`LoadConfig` 加
    `Rules: cfg.Rules`、`SaveConfig` 加 `Rules: opts.Rules`（持久化两腿，缺任一都会在重启后清空清单）；
    新增 `RuleSetter`（`SetRules(rules []string)`）作为「运行中可换清单」的接缝。
  - `tunnel/entrypoint/tungo.go` — `init()` 改为**单段临界区**：先把与规则无关的 `svc`/`chCfg`/node
    组装完，再在一段 `s.mu.Lock()` 内做「克隆 `opts.Rules`、建 `RuleBypass`、Unregister+Register、
    赋 `s.rules`、写 `s.config` 的 Bypasses 镜像」；`IsClosed` 复查与身份注销也在同一段锁内（配置在
    复查之后才写，所以已关闭的 init 不会留下可被 `ChainConfig` 读到的 `s.config`）。新增 `SetRules`：
    同一把锁内克隆进 `s.opts.Rules`、调用 `s.rules.SetRules(...)` 原地替换、同步
    `s.config.Bypasses[].Matchers`。`ChainConfig()` 的 `s.config` 读取改到 `s.mu` 下（写入现在也在
    锁内，读侧跟上同一套锁纪律）。
  - `api/entrypoint_handler.go` — `Rules *[]string`（`json:"rules,omitempty"`，缺席=沿用/`[]`=清空，
    与 `blocked_peers` 同语义）+ `toOptions` 的 `tunnel.RulesOption(derefStrings(r.Rules)...)`；
    `Peer` 注释改成「p2p, tun and tungo」；校验拆成 `validateTungoEntryPoint`（net/routes/dns/peer，
    rules 可空）与 `validateTunEntryPoint`（tungo 的那套 + share_lan），create/update 的类型 switch
    都接上 `case entrypoint.TungoEntryPoint`；update 里 `Rules` 与 `BlockedPeers`/`Direct` 一样做
    「缺席=沿用」填空，并在 `old.Close()` **之前**就构建替代对象；`rulesOnlyUpdate` + `sameRunOptions`
    判定「只改清单」时走热更新（`rs.SetRules(...)`，不 Close、不 Start、不换对象，`event` 记
    updated、`SaveConfig` 落盘、响应的仍是同一个 entrypoint）。
  - `api/tunnel_handler.go` — `tunnelOptionsResp.Rules`（`json:"rules,omitempty"`），`toTunnelResponse`
    回写 `opts.Rules`。
  - 测试：`api/api_test.go`（`TestEntrypointCreateTungoWithRules`、
    `TestEntrypointCreateTungoRequiresNetAndPeer`、`TestEntrypointUpdateKeepsRulesWithoutRestart`，外加
    `useGostLogger`/`refusedDeviceName`/`entrypointRules` 辅助件，并把既有的
    `TestCreateTunEntrypointShareFields` 改为复用 `useGostLogger`）；
    `tunnel/entrypoint/restart_test.go`（`TestRestartRunningKeepsRules` +
    `runningTungoWithRules`/`requireTungoRules` 辅助件）；`tunnel/entrypoint/restart_p2p_test.go`
    （`TestRestartP2PRunningKeepsTungoRules`）；`tunnel/entrypoint/tungo_test.go`
    （`TestTungoSetRulesWhileInitKeepsTheEdit`、`TestTungoRulesRoundTrip`）。
- **测试/命令与结果:**
  - RED（先只落地配置字段，行为尚未实现）：
    `cd wisper && go test ./api/ -run "TestEntrypointCreateTungo|TestEntrypointUpdateKeepsRules" -v`
    → `RequiresNetAndPeer` 四个子用例全部 201（`want 400`）、
    `TestEntrypointUpdateKeepsRulesWithoutRestart` → `the rule edit replaced the entrypoint`；更早一步
    （`config.Tunnel.Rules` 都没有时）是编译失败 `ep.Rules undefined`。都是「字段/行为缺失」的失败。
  - GREEN：同命令 → 3 个测试（+4 子测试）全 PASS。
  - `cd wisper && CGO_ENABLED=1 go test ./api/ ./tunnel/entrypoint/ -race -count=1`
    → `ok api 163.910s`、`ok tunnel/entrypoint 55.418s`，`WARNING: DATA RACE` 出现 0 次。
  - `cd wisper && go test ./tunnel/ ./api/ -count=1` → `ok tunnel 41.842s`、`ok api 139.008s`。
  - `cd wisper && go build ./...`、`go vet ./api/ ./tunnel/ ./tunnel/entrypoint/ ./config/`、
    `gofmt -l api config tunnel` → 均无输出。
  - 变异验证（逐条临时改坏实现，确认对应测试会红，随后逐一还原）：
    去掉 `restartRunning` 字面量里的 `Rules:` → 两个重启测试红（`restarted rules = [], want [...]`）；
    去掉 `TunnelOptions` 里的 `RulesOption` → 同样两个测试红；去掉 `LoadConfig` 的 `Rules: cfg.Rules`
    → `TestTungoRulesRoundTrip` 红（`loaded Rules = []`）；去掉 `SaveConfig` 的 `Rules: opts.Rules`
    → 同测试红（`persisted Rules = []`）；把 `init()` 退回「先 RLock 克隆、后 Lock 赋值」两段 →
    `TestTungoSetRulesWhileInitKeepsTheEdit` 红
    （`the running split does not tunnel the edited rule new.example`）。
- **评审发现与修复（自审）:**
  - **init 两段临界区（Task 3 记录的遗留）**：选了「合成一段临界区」而不是「热路径复用既有对象」。
    理由：复用对象救不了顺序 —— init 若在锁外先读快照、再对对象调 `SetRules`，中间落地的编辑照样被覆盖；
    只有把「读快照 → 建立/写入对象 → 写镜像」放进同一段锁，两种顺序才都以「编辑胜出」收场。锁内只有
    注册表调用与几次结构体构造（不含网络、不含回调），且 `Close` 是先 `close(cclose)` 再取锁，不形成
    反向锁序。
  - **`restartRunning` 的字面量与 `TunnelOptions` 是同一组字段的两份表述**：两边都补了 `Rules`，并在
    字面量处留下「漏字段会静默丢」的注释（这轮 re-review 就是从这条路发现的）。
  - **热更新的判定**用「按构造器生成替代对象、与旧 options 整体比对」，而不是逐字段枚举：构造器负责套
    默认值（name、MTU），所以「表单没重述 mtu」不会被误判成变化；整体比对让**将来新增的字段自动落到
    重建路径**（fail-safe），不需要有人记得同步比较函数。`ID`/`CreatedAt`/`Stats`/`StatsBaseline` 属于
    对象而不是请求、`Rules` 是这次允许改的字段，比对前清空；`ShareMode` 按规范化值比较 —— 这点是
    `TestEntrypointUpdateKeepsRulesWithoutRestart` 第一次跑红时暴露的：响应把未设置映射成 `auto`，
    `""` vs `auto` 会让每一次保存都重建。
  - 热更新只对「类型未变、未关闭、`Err()` 为空、`IsServiceFailed()` 为假」的 entrypoint 生效：把失败/
    停机的 entrypoint 保存一次本来就是让它重新起来的方式，这条行为没有改。
  - 替代对象在 `old.Close()` **之前**构建：非法类型/无法满足的请求不再先把运行中的 entrypoint 关掉
    （旧顺序是先关再 400）。
  - `ChainConfig()` 的 `s.config` 读也纳入 `s.mu`：写入现在在锁内，读侧跟上才不会留下半套锁纪律。
  - **`-race` 撞到 `x/handler/tungo` 的关闭竞态**：整个 `api` 包 `-race` 跑下来报
    `handler/tungo.Close`（读 `h.stack`）与 `Handle`（写 `h.stack`）竞态，栈经
    `Delete → tungoEntryPoint.Close → xservice.Close`。这是 `x` 的既有缺陷（本任务不改 `x/`），触发点是
    「测试里真的起了一个 tungo service 又立刻关掉」。修法在测试侧：两个 create 用例用一个内核拒绝的
    设备名（`refusedDeviceName`，超过接口名长度上限）让 Run 在建设备那步失败，从而不在这台机器上真建
    设备、也不起 serve goroutine（`status=stopped`，201 与字段往返照旧）。顺带也满足「测试不该动宿主
    设备」。
  - 规则/持久化测试的清理都走已有的 `tungoCleanup`；重启测试沿用 `TestRestartP2PRunningRestartsTungo`
    的 `tungoRunConfig` + `t.Chdir` + `loopbackDeviceListener` 组合，`-count=2`/`-count=3` 未见跨用例泄漏。
- **遗留项/限制:**
  - **`x/handler/tungo` 的 `Close`/`Handle` 竞态没有修**（按分工不改 `x/`）：`Handle` 在
    `core.CreateStack` 之后无锁写 `h.stack`，`Close` 无锁读它。真机上「entrypoint 刚起就停/更新」会
    命中，`-race` 下必然报。这是 `x` 的独立缺陷，建议单独开一个 x 任务（加互斥，或让 `Close` 不读
    尚未发布的 `stack`）。
  - **热更新只覆盖「清单」**：改 `net`/`mtu`/`routes`/`dns`/`peer`/`name` 仍然重建（本来就必须重建）。
  - **UI 还没有 `rules` 字段**（Task 6b）：App/详情页要自己把 `rules` 当换行文本收发；本任务只保证
    API/JSON/配置这一层。
  - **规则条目的语法不在 API 层校验**：`rules` 里写错一个 CIDR 只会被 `x/bypass` 当成普通地址匹配
    （与 pi 的 `bypass-gfw` 行为一致），不报错。要「创建即拒绝」需要一份与 `x/bypass` 同步的校验器。
  - **`SetRules` 在 entrypoint 已关闭时只写 `opts`/镜像**：`s.rules` 指向的对象已从注册表撤下，调它
    不产生效果；这也是热更新只对运行中的 entrypoint 生效的原因之一。
  - `restartRunning` 的字面量仍是「手抄 TunnelOptions」：本轮只补 `Rules`，没有换成
    `tunnel.TunnelOptions(p.opts)`（那会连带改 `StatsBaseline` 的来源，超出本任务范围）。


---

### Task 6b: UI 与 web 产物

**Files:**
- Modify: `wisper/web-src/src/pages/entrypoint-detail-page.ts`（**不要**把 `'tun'` 全量替换：
  - 设备字段与 peer 选择：`302`、`313`、`343-347`、`945-961` 改成「`tun` 或 `tungo`」；
  - **仅 `tun` 保留**：`share_lan`/`share_mode`/`direct`（`350-354`）与 hub 侧的
    liveness 横幅（`911`、`923`）—— 它们对 tungo 没有意义；
  - 新增 `rules` 文本域（仅 tungo 显示，换行分隔，保存时 `split/trim/去空`）。）
- Modify: `wisper/web-src/src/pages/home-page.ts:726-740`（`type === 'tun'` → 含 `'tungo'`，
  armVpn 前取 tungo 的 net/routes/mtu/dns）
- Modify: `wisper/web-src/src/i18n/en.ts` 与 `web-src/src/i18n/zh.ts`（`fieldRules` 等新文案，
  两套 key 必须一致）
- Regenerate: `wisper/web/assets`（受跟踪的构建产物）
- Test: `wisper/web-src` 的既有 ui-test（`make ui-test`）

**Interfaces:**
- Consumes: Task 6a 的 `rules` 与 `tungo` 类型
- 注意：保存**不再**自动重启运行中的 entrypoint（只有非规则字段变更才重建）；UI 不要给用户「保存即生效并重启」
  的暗示，重启入口是停+启。
- Produces: 详情页/首页能创建与编辑 tungo entrypoint，`rules` 以换行文本往返

- [x] **Step 1: 写失败的 ui-test**

在既有测试里加一条：`tungo` 类型渲染出设备字段（net/mtu/routes/dns）、peer 选择与 `rules` 文本域，
且**不**渲染 `share_lan`/`share_mode`/`direct`。

- [x] **Step 2: 运行确认失败**

Run: `cd wisper && make ui-test`
Expected: FAIL（现有按 `'tun'` 判定的分支不覆盖 tungo）

- [x] **Step 3: 实现**

按上面的文件清单改类型判定、加 `rules` 文本域与 i18n 两套 key。

- [x] **Step 4: 运行确认通过并重建 web 产物**

Run: `cd wisper && make typecheck && make ui-test && make web`
Expected: 三条都成功，`web/assets` 出现新的哈希产物

- [x] **Step 5: 提交**

```bash
cd wisper && git add web-src web/assets && git commit -m "feat(web): edit the tungo entrypoint and its rules"
```

**Implementation record:**

- **日期/状态:** 2026-11-22 — 已完成。详情页与首页都能创建、编辑 tungo entrypoint，`rules` 以换行文本
  往返（保存时 `split('\n')` → trim → 去空，空文本域传 `[]`）。
- **仓库 + commit:** `wisper`（`github.com/go-gost/wisper`）：`a379334`
  `feat(web): edit the tungo entrypoint and its rules`（`web-src`、`web-e2e` 的新 spec、
  重建后的 `web/assets` + `web/index.html`）；本条记录为随后的 `docs(plan)` 提交。
  不涉及 `x`、Go 代码或 Kotlin 桥。
- **实际改动文件:**
  - `web-src/src/api/types.ts` — `EntrypointType` 加 `'tungo'`；`ENTRYPOINT_TYPES` 加一项
    （picker 是唯一能新建入口的路径，不加就永远创建不出来）；`EntrypointOptions.rules?`、
    `EntrypointCreateRequest.rules?`（注释写明「每次保存整份发送，`[]` 是显式清空」）。
  - `web-src/src/pages/entrypoint-type-select-page.ts` — `TYPE_COLORS` 加 tungo（绿色，与 tun 的青色区分）。
  - `web-src/src/utils/type-icons.ts` + `utils/icons.ts` — tungo 用新加的 `branch` 图标
    （一分二：清单内进隧道、其余直出），避免与 `tun` 的 `network` 撞图。
  - `web-src/src/utils/vpn.ts` — `tunDeviceHolder` 从「运行中的 tun」扩成「运行中的设备型入口
    （tun 或 tungo）」。Android 只有一个 VpnService 设备，只认 tun 会让 tungo 抢走 tun 的设备。
  - `web-src/src/pages/entrypoint-detail-page.ts` —
    - 新增 `_usesDevice` getter（`'tun' || 'tungo'`）承载「设备字段 + peer + armVpn」这一组，
      对应任务书的 302/313/343-347/945-961；`_handleStart` 的 armVpn 也走它。
    - `_rules` state：`_resetForm` 清空，`_populateForm` 用 `(options.rules ?? []).join('\n')`。
    - 保存体新增 `rules`（仅 tungo，整份发送，trim + 去空）。
    - 文本域（仅 tungo）：`<textarea class="form-input" rows="6">`，放在 DNS 之后、LAN 共享之前；
      新增 `textarea.form-input` 样式（等宽、可纵向拉伸、最小高度）。
    - 视图模式：`fieldNet` 标签、MTU/设备名/routes/dns/peer/transport 对 tungo 生效；
      `share_lan`、`direct`、`lan_routes` 与两条 hub liveness 横幅**保持仅 tun**；
      tungo 增加 `fieldRules` 行（空清单显示 `—`，因为「全部直连」是可用状态而不是未配置）。
    - `tunNetMatchesHub` 提示仅 tun 保留（tungo 的地址不由任何 hub 分配）；DNS 占位符按类型区分
      （tun `10.10.0.1`，tungo `192.168.100.100`，即计划里固定的家庭网关）。
    - 设备型入口的顶部提示换成按类型选 `tunPeerHint` / 新 `tungoPeerHint`；管理员权限提示两者共用。
  - `web-src/src/pages/home-page.ts:723-741` — `_handleStart` 的设备判定含 `'tungo'`，
    armVpn 用该入口自己的 `net/routes/mtu/dns`（字段名与 tun 相同，无需另取）。
  - `web-src/src/i18n/en.ts`、`zh.ts` — 新增 `typeTungo`、`typeTungoDesc`、`typeTungoEntryDesc`、
    `tungoPeerHint`、`fieldRules`、`fieldRulesHint`；两套 key 数量一致（412/412，脚本核对无单边）。
    顺带修正 `p2pKeyResetWarning`：重置身份后 tungo 入口点也会重启（Task 4 的 `1a87d0f`），原文只提
    tun。
  - `web-e2e/tests/entrypoint-tungo-form.spec.ts`（新增）— 4 个 ui-test（见下）。
  - `web/assets/*`、`web/index.html` — `make web` 重建（18 个哈希产物替换，CSS 未变，
    `index.html` 只换了入口脚本名）。
- **测试/命令与结果:**
  - RED：`cd wisper && scripts/ui-test.sh tests/entrypoint-tungo-form.spec.ts`
    → 3 failed（当时的 3 条）：
    `the tungo entrypoint form shows the device fields…` 在
    `input[placeholder="10.10.0.2/24"]` 上 `element(s) not found`（tungo 落到 p2p/其他分支，
    没有设备字段也没有 rules）；`…saves its rules as a trimmed list` 等不到
    `Base64 public key` 输入框；`…renders its saved rules…` 找不到 `Split rules` 行。
    即「按 `'tun'` 判定的分支不覆盖 tungo」。
  - GREEN（本文件）：同一命令 → 4 passed。
  - `cd wisper && make typecheck` → 无输出（exit 0）。
  - `cd wisper && make ui-test` → **35 passed / 4 failed**，4 条失败与 tungo 无关且**改动前就有**
    （把 `web-src` stash 掉、用 HEAD 源码重建 `web` 后跑同样三条 spec，得到完全相同的 4 条失败）：
    `entrypoint-tun-form` 的「peer key under the device address」（断言 MTU 占位符 `1420`，
    表单早已是 `1300`）与「keeps LAN sharing last」（`.switch-row` 在 tun 表单本就有两个，
    Playwright strict mode 报歧义）；`home-navigation` / `tunnel-detail` 的
    「…carries the encryption badge」（`.secure` 徽标已不在 `tunnel-card` 上）。
    新增的 4 条 tungo 断言全部 PASS，其余 31 条 PASS。
  - `cd wisper && make web` → `✓ built in 673ms`，`web/assets` 出现新哈希产物（见上）。
  - 重建可复现性：改动前跑过一次 `make web`，产出的哈希文件名与仓库里的已跟踪产物**完全一致**
    （`git status web` 无输出），所以提交里的产物差异只来自本任务的源码改动。
  - i18n 一致性脚本：`en` 412 keys / `zh` 412 keys，互差为空、无重复 key。
- **评审发现与修复（自审）:**
  - 任务书只点了 4 行改动位置，但**只加类型判定是创建不出来的**: `EntrypointType` 不含
    `'tungo'` 时详情页的 `=== 'tungo'` 连 TS 都编不过，而 picker（`ENTRYPOINT_TYPES`）里没有卡片
    就永远拿不到 `/entrypoint/tungo/new` 的入口。所以补了 `api/types.ts`、picker 配色、图标表与
    `icons.ts` 的 `branch` 字形；这些都在同一处「类型即入口」的链上。
  - `tunDeviceHolder` 必须一起扩：它守的是「Android 只有一个 VpnService 设备」。只改
    `_handleSave`/`_handleStart` 的 `'tun'` 判定会漏掉「tun 在跑、再 arm 一个 tungo」这条把设备
    抢走的路径。
  - 任务书要求「不要给用户『保存即生效并重启』的暗示」：详情页本来就没有这类提示，新增的
    `fieldRulesHint`/`tungoPeerHint` 只描述分流语义，未提保存/重启；也没有借用 peers 页的
    `peersRestartHint`。
  - 空清单的展示：视图模式显示 `—` 而不是隐藏该行——空清单是「全部直连」，是个可用状态；
    隐藏会让「我来过这里、确实清空了」无从判断。
  - `fieldRoutesHint` 是 tun 的文案（「留空则默认走本机 net 所在网段（含 hub 及其他 peer）」），
    对 tungo 略偏；**评审修复轮已改为 tungo 专用** `fieldTungoRoutesHint`（见下）。`tunNetMatchesHub`
    则对 tungo 是错的（没有 tun hub 分配地址），已收窄到 tun。
  - `textarea` 用 `.value=${...}` 绑定而非 `value=` 属性，poll 时重填不会打断输入焦点；
    同时保证 `?edit` 首次渲染就带上已保存的清单。
- **遗留项/限制:**
  - `make ui-test` 曾有 4 条既有失败（上面点名），与本任务无关；**已在评审修复轮修掉**（见下一条），
    现在整套是绿的。那次失败分别属于 tun 表单测试的过期 MTU 占位符、tun 表单的歧义 `.switch-row`
    locator、以及 `tunnel-card` 的加密徽标测试漂移（徽标在 `f0419ed` 已被有意移除）。
  - tungo 不显示「本地对端（blocked_peers）」卡片：`blocked_peers` 只接了 tun spoke
    （Task 6a 未给 tungo 接这条），页面按 tun-only 保留。
  - View 模式的 `rules` 以 `, ` 连接显示（长清单会折行）；没有逐条可编辑的列表控件，编辑只有文本域。
  - 设备真正建立仍只有 Android 真机/root 覆盖；ui-test 的保存用例改为拦截 `POST /api/entrypoints`
    校验请求体（桌面无权限建设备，且不想污染夹具），设备创建本身由 Task 7 真机验收。
- **评审修复轮:** `92e0b94` `test(web): green the ui suite and pin the tungo form's wire body`
  —— Important（`make ui-test` 红：35 passed / 4 failed，违背本任务的验收门槛）+ 三个 Minor：
  - 四红全部收掉，**没有**为了绿而删产品行为：`entrypoint-tun-form` 的 MTU 断言从 `1420` 改成表单实际渲染的
    `1300`（`a730e43` 就把默认 MTU 降到了 1300）；「keeps LAN sharing last」的 `.switch-row` 收窄成
    `.switch-row:has-text("Sharing Backend")`。
  - `.secure` 徽标：`git log -S 'secure' -- web-src/src/components/tunnel-card.ts` 只有两条提交——
    `b406bcd`（加上锁徽标）与 `f0419ed`（`replace lock badge with RTT on list`，注释写「now redundant」，
    同一提交里 `home-page.ts` 的 `_secure()` 换成 `_rtt()`、也没人再设 `.secure`）。即**有意移除**
    （p2p 加密是强制的，「不加密就拒绝建链」，逐项徽标不携带信息），不是重构丢失，所以更新测试而不是恢复元素：
    `home-navigation` 的那条改成「card 存在且没有 `.secure`」并保留截图，`tunnel-detail` 的徽标测试删除；
    同时清掉 `tunnel-card` 里已死的 `secure` 属性与 `.secure` CSS，并把两处仍在描述徽标的注释改成描述 RTT。
  - 保存请求体加了防线：tungo 保存必须带 `net`（`10.10.100.250/32`，`validateTungoEntryPoint` 的硬要求）
    且 `rules` 键必须存在（空清单也是 `[]`）；顺带断言 tun 保存体**没有** `rules`。
  - 去掉死 key `typeTungoDesc`（两语言一致），并给 tungo 补自己的路由提示 `fieldTungoRoutesHint`
    （逗号分隔 CIDR、`0.0.0.0/0` 表示全部，去向由分流规则决定）——不再复用 tun 的「留空默认走本机 net 网段」。
  - 顺手删掉误提交的 `web-src/node_modules/nanoid/.claude/settings.local.json`（nanoid 包自带的本地
    agent 设置，不是我们的文件），并在 `.gitignore` 加 `**/.claude/settings.local.json`
    （带 `**/` 前缀，因为 vendored `node_modules` 在子目录里，只有 `.claude/settings.local.json`
    这种带斜杠的写法只匹配仓库根）。
  - 结果：`make typecheck` 无输出、`make ui-test` **38 passed**、`make web` `✓ built in 643ms`，
    重建产物随本条一起提交。


---

### Task 6c: x —— 修 `handler/tungo` 的 `Close`/`Handle` 竞态（真机验收前必须）

**为什么在这里：** Task 6a 的测试发现 `x/handler/tungo` 有一个既有竞态：`Handle` 在
`core.CreateStack` 之后无锁写 `h.stack`（`x/handler/tungo/handler.go:159`），`Close()` 无锁读它
（`:171`）。tungo entrypoint 每一次「起来就停」都会命中（VPN 重建、restart、用户点停），`-race`
下必然报；生产上是未同步的指针读写。`x/` 在前面的任务里是禁区，所以单列在这里。

**Files:**
- Modify: `x/handler/tungo/handler.go`（`h.stack` 的读写加同一把锁；`Close` 取到栈后只关一次）
- Test: `x/handler/tungo/handler_test.go`（若不存在则新建）

**Interfaces:**
- Consumes: 现有 `Handle`/`Close` 形状不变（`handler.Handler` + `io.Closer`）。
- Produces: `Close` 与 `Handle` 并发安全；重复 `Close` 幂等。

- [ ] **Step 1: 写失败的测试**

```go
func TestHandlerCloseRacesHandle(t *testing.T)
// net.Pipe 当设备 conn，ctx 里塞 &tun_util.Config{MTU: 1400}
// go h.Handle(ctx, c)；等栈建立（轮询 h.stack 非 nil 的**测试内**观察点，或用 Close 的同步点）
// 再 h.Close()；断言不 panic、Handle 返回、第二次 Close 也返回 nil
Run: `cd x && CGO_ENABLED=1 go test ./handler/tungo/ -run TestHandlerCloseRacesHandle -race -count=1`
Expected: FAIL，`-race` 报 `handler.go:159` 与 `:171` 的 data race
```

- [ ] **Step 2: 实现**

`tungoHandler` 加 `mu sync.Mutex`；`Handle` 里写 `h.stack` 与 `Close` 里读/关它都在这把锁下
（不要在锁内 `stack.Wait()`）；`Close` 取到指针后置 nil，保证只关一次。

- [ ] **Step 3: 运行确认通过**

Run: `cd x && CGO_ENABLED=1 go test ./handler/tungo/ -race -count=1` → PASS，无 DATA RACE

- [ ] **Step 4: 提交（`x` 仓库）**

```bash
cd x && git add handler/tungo && git commit -m "fix(tungo): guard the handler stack against Close racing Handle"
```

**Implementation record:**

- **日期/状态:** 2026-11-22 — 已完成。`Close` 与 `Handle` 对 `h.stack` 的读写已同一把锁；重复/并发
  `Close` 幂等；`Close` 先于 `Handle` 发布栈时不再泄漏。
- **评审修复轮:** `0d006b9` `test(tungo): make the close-vs-handle race test deterministic`
  —— Important（`time.Sleep(100ms)` 会让测试从 `closed` 分支绿着通过）+ 三个 Minor（`Init` 复位 `closed`、
  调用方义务注释、管道清理）。RED 用提交的这版测试在回退守卫后重新取证。
- **仓库 + commit:**
  - `x`（`github.com/go-gost/x`）：`0316d18` `fix(tungo): guard the handler stack against Close racing Handle`
    （`handler/tungo/handler.go` + 新增 `handler/tungo/handler_test.go`）。
  - `wisper`（`github.com/go-gost/wisper`）：本任务只有这条 Implementation record，
    `docs(plan): implementation record for task 6c`。
- **实际改动文件:**
  - `x/handler/tungo/handler.go`：
    - `tungoHandler` 新增 `mu sync.Mutex` 与 `closed bool`；`cancel`/`stack` 移到锁下（字段注释写明
      「不在锁内 `stack.Wait`/`stack.Close`」）。`Init` 写 `h.cancel` 也走同一把锁。
    - `Handle`：`core.CreateStack` 成功后 `h.mu.Lock()`；若 `h.closed` 则解锁、
      **自己** `stack.Close()` 并返回 nil（该栈从未发布，没人会来关它）；否则 `h.stack = stack`、
      解锁，然后照旧 `stack.Wait()`。
    - `Close`：锁内取走 `h.stack`/`h.cancel` 并**置 nil**、置 `h.closed = true`，解锁后再 `cancel()`
      与 `s.Close()`；因此第二次（含并发的第二次）`Close` 只返回 nil，不会关两次。
    - 公开形状、metadata、stats、其它 handler 均未改动；`stack.go` 未改。
  - `x/handler/tungo/handler_test.go`（新增）：
    - `var _ io.Closer = (*tungoHandler)(nil)` 钉住 `handler.Handler` + `io.Closer` 形状。
    - `deviceConn`：包住设备 conn，在 link endpoint 第一次 `Read` 时关闭 `read` 通道——这是唯一
      不碰被发布的 `h.stack` 的外部观察点。
    - `TestHandlerCloseRacesHandle`：`net.Pipe` 当设备、ctx metadata 里
      `&tun_util.Config{MTU: 1400}`、`Handle` 在 goroutine、读到设备后 `Close`（**两个 goroutine
      并发**各调一次，都要求返回 nil）、断言 `h.stack` 在锁下已为 nil、关闭 pipe 对端放行 link
      endpoint 后 `Handle` 在 5s 内返回且 error 为 nil（不 panic 由测试进程本身兜底）。
    - `TestHandlerCloseBeforeHandle`：先 `Close` 再 `Handle`，`Handle` 必须在 5s 内返回 nil
      （即自己关掉刚建的栈，而不是 `stack.Wait()` 卡死）。
- **执行的命令与结果:**
  - RED（竞态）：`cd x && CGO_ENABLED=1 go test ./handler/tungo/ -run TestHandlerCloseRacesHandle -race -count=1`
    → FAIL，`WARNING: DATA RACE`：`Read ... (*tungoHandler).Close() handler.go:171` 与
    `Previous write ... (*tungoHandler).Handle() handler.go:159`（正是任务书点名的一对）。
    当时的测试用顺序两次 `Close`、且不含「`h.stack` 已为 nil」的内部断言（该断言要 `h.mu`，
    修复前无法编译）。
  - RED（Close 先行）：`-run TestHandlerCloseBeforeHandle -race` → FAIL
    `handler_test.go: Handle did not return after Close`（5s 超时，修复前 `stack.Wait()` 永不返回）。
  - GREEN：`cd x && CGO_ENABLED=1 go test ./handler/tungo/ -race -count=3` → PASS，无 DATA RACE；
    `cd x && go test ./handler/tungo/ -count=1` → `ok ... 0.107s`；`go vet ./handler/tungo/`、
    `gofmt -l handler/tungo/` → 均无输出；`cd x && go build ./...` → exit 0。
  - 变异验证（证明断言有力，均当场恢复）：删掉 `Close` 里的 `h.stack = nil` →
    `TestHandlerCloseRacesHandle` 报 `Close left the stack published on the handler`；
    把 `Handle` 的 `if h.closed` 改成 `if false && h.closed` → `TestHandlerCloseBeforeHandle`
    重新 5s 超时。
- **评审发现与修复（自审）:**
  - 只锁 `h.stack` 不够：`Close` 若在 `CreateStack` 期间跑完，`Handle` 仍会发布栈并 `Wait` 到天荒地老，
    所以补了 `closed` 标志与「自建自关」分支（否则就是任务书禁止的泄漏）。
  - `Close` 必须锁内取指针并置 nil：先解锁再关、或关完再置 nil，都会让并发第二次 `Close` 关两次。
    测试因此改成两个 goroutine 并发 `Close`，而不是顺序两次。
  - `h.cancel` 虽然只在 `Init` 写，也一并纳入同一把锁，避免「同一字段两种纪律」的读法歧义。
  - 测试助手原先在类型断言失败时用 `%T` 打印已被置零的断言结果，改为先取接口再断言。
  - `handler.Handler` 接口本身没有 `Close`，测试用 `io.Closer` 断言确认服务侧形状未变。
- **遗留项/限制:**
  - `Close` 只关 gvisor 栈，不会关设备 conn：`Handle` 仍卡在 `stack.Wait()`，直到设备读失败
    （tun fd 被撤销 / conn 被关）才返回。测试用关闭 `net.Pipe` 对端模拟这一点。若真机上「停 VPN」
    不先让设备读返回错误，`Handle` goroutine 会滞留到 fd 消失——这是既有设计，本任务不改变，
    真机验收（Task 7）时值得确认停/启能立刻回收。
  - 同一实例上 `Init` 后再 `Close` 再 `Handle` 会立刻关闭新栈（`closed` 不复位）；`x` 每次解析
    配置都新建 handler 实例，故不构成实际问题。
  - 未处理同一实例上并发两次 `Handle`（既有行为，任务范围外）。

---

### Task 7a: 部署（只做加法）并在 pi 上验证 relay 腿

**安全性前提：** 本步骤**只做加法** —— 加 pi 的 relay 服务、加 hub 的 p2p tunnel。
**不要**在手机上还没切过来之前把 pixel-9 从现有 `p2p-tun`（type `tun`）的 `peers` 里移除，
否则用户会立刻失去现在能用的隧道。

**Files:**
- Modify: `wisper/docs/tun-integration.md`（新增一节「手机上按域名分流（tungo entrypoint）」，含规则语义、
  DNS 取舍、失败时的行为、以及「保存不再重启」）
- 运维（不在仓库）：`pi@192.168.100.100` 的 `/etc/gost/gost.yaml`、hub 的 `wisper.yaml`

- [ ] **Step 1: pi 增加 relay 服务**（复用 `relay-wss` 与既有 bypasses，只绑回环）

```yaml
- name: relay-phone
  addr: 127.0.0.1:18080
  handler:
    type: relay
    chain: relay-wss
```

推送：本地改 → `python3 -c "import yaml,sys;yaml.safe_load(open('gost.yaml'))"` 校验 →
`docker run --rm -i -v /etc/gost:/etc/gost alpine sh -c 'cp gost.yaml gost.yaml.bak.$(date +%Y%m%d-%H%M%S)
&& cat > gost.yaml.tmp && mv gost.yaml.tmp gost.yaml'` → `kill -HUP <MainPID>` 热重载。
Expected: 日志出现 `relay-phone` 的监听；`ss -ltn | grep 18080` 只绑 `127.0.0.1`。**记录备份文件名**。

- [ ] **Step 2: 在 pi 上验证 relay 腿本身**（不需要手机）

```sh
# 用 gost 客户端经 relay 入口取一次公网地址；白名单外的域名应当从家宽直连
gost -F relay://127.0.0.1:18080 -L tcp://127.0.0.1:18081 &
curl -x http://127.0.0.1:18081 -sS -o /dev/null -w '%{http_code}\n' https://www.baidu.com
curl -x http://127.0.0.1:18081 -sS -o /dev/null -w '%{http_code}\n' https://www.google.com
```
Expected: 两条都 200（第二条经 `relay-wss`）；gost 日志里能看到 `relay-phone` 的连接与链选择。

- [ ] **Step 3: hub 增加 p2p tunnel（加法）**

新增一个 type `p2p` 的 tunnel：`endpoint: 127.0.0.1:18080`、`peers: [pixel-9 的 key]`。
Expected: `/api/tunnels` 里新 tunnel 存在且 running；现有 `p2p-tun` 的 peers **不变**。

- [ ] **Step 4: 提交文档**

```bash
cd wisper && git add docs/tun-integration.md && git commit -m "docs: document the tungo split entrypoint and its deployment"
```

**Implementation record:** _完成后填写（含 pi 配置的备份文件名、两条 curl 的实测结果）。_

---

### Task 7b: 切到手机并做真机验收（需要设备在场）

**为什么单列：** 这一步会让手机从 `tun` entrypoint 切到 `tungo`，并且要在手机上建 tungo entrypoint
（`net: 10.10.100.250/32,fd00:10:10:100::250/128`、`routes: 0.0.0.0/0, ::/0`、`dns: 192.168.100.100`、
`rules: [192.168.100.0/24, home.pi, gost.local, dadax, <gost:bypass:gfw 里的域名>]`）。
**这一步必须和设备的使用者一起做**，因为 `adb devices` 当前没有连接（无线调试端口会轮换），
而且切换瞬间会重建 VPN。

- [ ] **Step 1: 构建 APK**（`cd wisper && make apk`，走 docker + `--network host`），确认产物存在。
- [ ] **Step 2: 设备接入**（`adb connect <p2p 隧道地址>:<端口>`，见记忆里的无线调试流程），安装新 APK。
- [ ] **Step 3: 在 App 里停掉旧 `tun` entrypoint、建 `tungo` entrypoint**（用上面那组值），启动。
- [ ] **Step 4: 把 pixel-9 从 `p2p-tun` 的 peers 里移除**（此时手机已不再需要它）。
- [ ] **Step 5: 按 spec §7 的 8 条逐条验收并留证**（白名单域名 / 非白名单域名 / 内网子域名 / DNS /
  IPv6 / 互斥 / 回归 / 隧道不可用），外加本计划 §3.5 的三次「启动→有流量→停止」。

**Implementation record:** _完成后填写（含每条的实测命令与输出、以及回滚方式：把 pixel-9 加回 `p2p-tun` 的 peers 并重新启动旧 `tun` entrypoint）。_
