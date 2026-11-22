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

**Implementation record:** _完成后填写：日期/状态、仓库 + commit SHA、实际改动文件、
执行的命令与结果、评审发现与修复、遗留项。_

---

### Task 2: 可热替换的规则 bypass（whitelist）

**Files:**
- Create: `wisper/tunnel/rulebypass.go`
- Test: `wisper/tunnel/rulebypass_test.go`
- Modify: `wisper/tunnel/tunnel.go`（`Options.Rules []string` + `RulesOption`）

**Interfaces:**
- Produces:
  - `type ruleBypass struct`，实现 `github.com/go-gost/core/bypass.Bypass`；
    `newRuleBypass(rules []string) *ruleBypass`；方法 `SetRules(rules []string)`、
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
Expected: FAIL（`newRuleBypass` 未定义）

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

**Implementation record:** _完成后填写（同上字段）。_

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
- Consumes: `tunnel.RulesOption`/`Options.Rules`（Task 2）、`tunnel.ChainConfig(id, name, recordMode)`
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

**Implementation record:** _完成后填写。_

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

**Implementation record:** _完成后填写。_

---

### Task 5: 端到端 —— relay over p2p（TCP 与 DNS/UDP）

**Files:**
- Test: `wisper/tunnel/tungo_e2e_test.go`（可复用 `p2p_e2e_test.go` 的
  `startEchoServer`/`startDerper`/`newDialingHost`/`registerProvider` 封装，同包 + 同 build tag）

**Interfaces:**
- Consumes: Task 3 的 `tungoEntryPoint.init()`（取它生成的 chain 配置）、
  `x/handler/relay`、`x/listener/tcp`、Task 6 之前不需要 API。
- Produces: 两个测试，证明 spec 的传输核心。

- [ ] **Step 1: 写失败的测试**

```go
func TestTungoChainRelaysOverP2P(t *testing.T)
// 起一个本地 relay 服务（x/listener/tcp + x/handler/relay，chain 指向 echo server）
// 用 entrypoint 生成的 chain 配置 ParseChain，Router.Dial("tcp", echoAddr)
// 断言：数据往返成功，且流量确实经过 relay 服务（relay 服务侧记录一次连接）

func TestTungoChainRelaysUDPOverP2P(t *testing.T)
// 同样的链路，Router.Dial("udp", udpEchoAddr)：起一个 UDP echo（DNS 形状：收到什么回什么）
// 断言：FUDP 帧化的数据往返成功（这是 DNS 走隧道的唯一依赖）

func TestTungoChainUnlistedGoesDirect(t *testing.T)
// 清单只含 example.com；Router.Dial("tcp", <本地 echo 地址>) 必须成功且不产生 relay 连接
```

- [ ] **Step 2: 运行确认失败**

Run: `cd wisper && go test ./tunnel/ -run TestTungoChain -v -count=1`
Expected: FAIL（entrypoint 生成的链尚不能连接 relay 服务，或 FUDP 路径报错）

- [ ] **Step 3: 修到通过**

失败通常只会暴露接线问题（relay 服务的 chain 目标、p2p provider 命名、network 参数）。
改 `tungo.go` 的组装或测试里的 server 配置，**不要改 x**。

- [ ] **Step 4: 运行确认通过**

Run: `cd wisper && go test ./tunnel/ -run TestTungoChain -v -count=1`
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