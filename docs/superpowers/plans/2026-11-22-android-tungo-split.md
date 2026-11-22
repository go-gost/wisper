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
关 service。**不给 device listener 挂 stats**（避免连接数双计）。失败必须能看见：
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

**Implementation record:** _完成后填写。_

---

### Task 6: 配置 / API / UI（类型 + 规则），含重启不丢字段

**Files:**
- Modify: `wisper/config/config.go`（`Tunnel` 加 `Rules []string` yaml/json `rules`）
- Modify: `wisper/tunnel/entrypoint/entrypoint.go:304-320`（`restartRunning` 复制 `Rules`）
- Modify: `wisper/api/entrypoint_handler.go`（create request 的 `Rules` + `toOptions`；
  `entrypoint_handler.go:143-147` 的类型校验加 `case entrypoint.TungoEntryPoint:
  validateTungoEntryPoint(req)` —— 要求 `net` 与 `peer`，`rules` 可空（空=全部直连））
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
- Test: `wisper/api/api_test.go`（新增用例）、`wisper/tunnel/entrypoint/restart_test.go`

**Interfaces:**
- Consumes: `tunnel.RulesOption`（Task 2）、`TungoEntryPoint`（Task 3）
- Produces: JSON 字段 `rules: ["example.com","home.pi","192.168.100.0/24"]`；
  `PUT /api/entrypoints/{id}` 对 `rules` 的语义与 `blocked_peers` 一致（缺席=沿用，
  `[]`=清空 → 用 `*[]string`）

- [ ] **Step 1: 写失败的测试**

```go
func TestEntrypointCreateTungoWithRules(t *testing.T)         // POST type=tungo+rules → 201；GET 回读 rules 一致
func TestEntrypointCreateTungoRequiresNetAndPeer(t *testing.T) // 缺 net 或 peer → 400，错误信息点名缺哪个
func TestEntrypointUpdateKeepsRulesWithoutRestart(t *testing.T) // PUT 只改 rules → entrypoint ID 不变、服务未重建（stats 基线保留）、新规则立即生效（TunDeviceOwner 名称不变）
func TestRestartRunningKeepsRules(t *testing.T)               // 触发 restartRunning → 重建后的 Options.Rules 与旧值一致（防静默丢字段）
```

- [ ] **Step 2: 运行确认失败**

Run: `cd wisper && go test ./api/ -run "TestEntrypointCreateTungo|TestEntrypointUpdateKeepsRules" -v`
Expected: FAIL（未知类型 `tungo` / 字段被忽略）

- [ ] **Step 3: 实现**

`config.Tunnel.Rules`、`api` 的 `Rules *[]string` + `toOptions` 里的
`tunnel.RulesOption(derefStrings(r.Rules)...)`、`restartRunning` 复制、UI 的类型判定与
rules 文本域（`split('\n')` + trim + 去空行），最后重建 web 资源。

- [ ] **Step 4: 运行确认通过**

Run: `cd wisper && go test ./api/ ./tunnel/entrypoint/ -v && make typecheck && make ui-test && make web`
Expected: 测试 PASS；typecheck / ui-test / web 全部成功，`web/assets` 有新的哈希产物

- [ ] **Step 5: 提交**

```bash
cd wisper && git add config api tunnel/entrypoint web-src web/assets \
  && git commit -m "feat(api): expose the tungo entrypoint type and its domain rules"
```

**Implementation record:** _完成后填写。_

---

### Task 7: 部署接线（pi + hub）与验收

**Files:**
- Modify: `wisper/docs/tun-integration.md`（新增一节「手机上按域名分流（tungo entrypoint）」：
  配置形状、规则语义、DNS 取舍、故障时的行为）
- 运维（不在仓库）：`pi@192.168.100.100` 的 `/etc/gost/gost.yaml` 与 hub 的
  `wisper.yaml`

**Interfaces:**
- Consumes: Task 1–6 的全部产出
- Produces: 一份可复制的配置清单 + 验收记录

- [ ] **Step 1: pi 增加 relay 服务**（复用 `relay-wss` 与既有 bypasses）

```yaml
- name: relay-phone
  addr: 127.0.0.1:18080
  handler:
    type: relay
    chain: relay-wss
```

推送方式（pi 上 sudo 需密码，走 docker 写盘）：本地改 → `python -c` 校验 YAML →
`docker run --rm -i -v /etc/gost:/etc/gost alpine sh -c 'cp gost.yaml gost.yaml.bak.$(date +%Y%m%d-%H%M%S)
&& cat > gost.yaml.tmp && mv gost.yaml.tmp gost.yaml'` → SIGHUP 热重载（`kill -HUP <MainPID>`）。
Expected: 日志出现 `relay-phone` 的监听，且 `ss -ltnp | grep 18080` 只绑 127.0.0.1。

- [ ] **Step 2: hub 增加 p2p tunnel 并把手机从 tun tunnel 移出**

wisper 的 `p2p-tun`（type `tun`）的 `peers` 移除 pixel-9 的 key；新增一个 type `p2p` 的
tunnel：`endpoint: 127.0.0.1:18080`、`peers: [pixel-9 的 key]`。
Expected: `/api/tunnels` 里两者并存；tun tunnel 的 peers 只剩 dadax / dadax-PC。

- [ ] **Step 3: 建立手机侧的 tungo entrypoint（值照抄，别临场决定）**

```
type:  tungo
peer:  <hub 的 base64 公钥>
net:   10.10.100.250/32,fd00:10:10:100::250/128
mtu:   1300
routes: 0.0.0.0/0, ::/0
dns:   192.168.100.100
rules:
  - 192.168.100.0/24        # DNS（UDP/53）+ 按 IP 访问的兜底
  - home.pi                 # 内网子域名
  - gost.local
  - dadax
  - <pi 的 gost:bypass:gfw 里的域名，逐条粘贴>
```

内网子域名要能解析，必须已经在 pi 的 `hosts-dns` 里（spec §8.7）。

- [ ] **Step 4: 打 APK 并在真机按 spec §7 验收**

```bash
cd wisper && make apk   # 走 docker，Makefile 已带 --network host；本机直接 make android 会失败
```

逐条记录 spec §7 的 1–8（白名单域名 / 非白名单域名 / 内网子域名 / DNS / IPv6 /
互斥 / 回归 / 隧道不可用）。Expected: 每条都有「命令 + 输出」形式的证据。

- [ ] **Step 5: 提交文档与验收记录**

```bash
cd wisper && git add docs/tun-integration.md && git commit -m "docs: document the tungo split entrypoint and its deployment"
```

**Implementation record:** _完成后填写（含 pi / hub 配置的备份文件名与验收结论）。_