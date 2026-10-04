# wisper tun hub 端到端性能测试报告（默认 smux 配置）

> 测试日期：2026-10-04
> 可复现脚本：`scripts/perf-tun-hub.sh`（需要 root + /dev/net/tun + docker+`gogost/derper`）

## 结论

**默认 smux 配置下，tun hub 的端到端带宽上限约等于 0 Mbit/s（持续）。**
实测只在 TCP 连接的最初约 1 秒看到 8–20 Mbit/s 的突发，随后窗口坍缩、靠重传维持、
整个连接停滞；UDP 同样无法持续通送（所有 UDP 数据报在首个链路死亡后穿不过）。

## 测试条件

- 拓扑：`hub`（wisper `tun` 隧道，设备 `10.10.0.1/24`）+ `spoke`（wisper tun entrypoint，
  设备 `10.10.0.2/32`），各自独占 network namespace；中间经 `derper` 中继连接。
- p2p 设置：`direct:false`、`secure:false`、`derp: wss://10.99.0.1:8443/derp`，设备 MTU=1420。
- 流量：iperf3（TCP 单方向各 10s ×2、双向 `-P 4`、UDP `-b 100M`）。
- smux 配置：`smux.DefaultConfig()`（仅 keepAliveInterval/Timeout 被 p2p engine 覆盖为 3s/15s）。
  默认值：MaxFrameSize=32768、MaxStreamBuffer=65536、MaxReceiveBuffer=4194304、Version=1。

## 测试结果

| 方向 | 测试 | 初始 1 秒 | 总体 |
|---|---|---|---|
| hub→spoke | TCP 单流 | 5–18 Mbit/s | 后续 0.00 Bytes/s，Retr 6–7，整体约 210 Kbit/s |
| spoke→hub | TCP 单流 | ~0 | 0.00 Bytes/s，两端同时失败 |
| hub→spoke | TCP `-P 4` | 0 | 0 |
| hub→spoke | UDP `-b 100M` | — | 0 吞吐 |

对比：`ping` 可以约 0.7 ms RTT 正常往返，说明链路"能通"，但承载不住大流量。

## 根因链

1. **数据报链路在首个窗口内死亡**
   spoke 与 hub 之间的 datagram link 两端在同一时间点一起 `down`
   （日志：`datagram link down` / hub 的 `route dropped: 10.10.0.2 -> <peer>` / `EOF`），
   实测从启动后约 2s 到约 44s 不等。此后数据面永久不可用。
2. **链路死亡后会话永远无法自愈**
   之后所有重新打开的 smux 流均在 AEAD 记录边界上出错：
   ```
   link: open presentation ... error=...: p2p: bad secure record length 705665690
   secure record auth failed ... chacha20poly1305: message authentication failed
   ```
   `secureSession` 在 relay mux session 重建时复用同一密钥与同一 nonce 计数，但
   cryptoConn 的读缓存（`rbuf`）/peerConn 的 inbound queue 中仍有旧 session 的残留字节。
   每次新 session 的第一个记录就在这个陈旧偏移上解包失败，之后所有报文在密文层错位，
   除非重启进程，否则一直无法恢复；日志中每 ~15s 重复出现 `secure record auth failed`。
3. 排除：将 hub/spoke 设备 MTU 统一为 1420 后同样故障；本机 `derper` 不提供 STUN，
   `direct:true` 时会退化为 relay-only，同样落到本报告路径上。

## 影响

- “默认 smux + tun hub + relay”的数据面在第一个链路抖动后即进入不可恢复状态，
  TCP/UDP 隧道吞吐降至接近零；ping 可通，会掩盖问题（`scripts/smoke-tun.sh` 只测 ping，
  因此通过）。
- **结论：该环境组合下 tun hub e2e 带宽上限 ≈ 0 Mbit/s（持续吞吐）。** 修复应从两处入手：
  datagram link 的意外终止原因、以及 cryptoConn/peerConn 在 session 重建后的状态清理。

## 复现

```bash
cd /root/code/go-gost/wisper
./scripts/perf-tun-hub.sh /tmp/wisper-tun-perf-n
```

## 修复后复测（relay 会话重建失步）

对应计划：`p2p/docs/2026-10-04-p2p-relay-session-desync-plan.md`（Task 1–3 已落地：
会话被替换即重新握手、记录边界连续 3 次失败即强制重置、会话死亡/重建原因结构化日志）。
注入档位已加入本脚本：

```bash
./scripts/perf-tun-hub.sh --inject-session-kill [workdir]
```

注入方式为**暂停 relay**（对脚本自己拉起的 derper 发 `SIGSTOP`/`SIGCONT`，默认每 45s 停 20s）。
停时长必须超过 smux 的 15s keepalive timeout（`p2p/internal/host/engine.go`），
否则会话不会被饿死、什么也注入不到。p2p 的 fault 开关按设计只在启动时从配置文件读、
不可从网络 API 改动，所以这里从外部打断链路，不新增任何注入通道。

### 本环境复测结果：**INCONCLUSIVE（退出码 3），未能验证**

| 观测 | 数值 |
|---|---|
| 注入次数 | 2（各暂停 20s） |
| hub 日志 `relay session rebuilt` | **0** |
| hub 日志 `peer session killed` | **0** |
| 记录边界失败（`bad secure record length` / `secure record auth failed`） | 0 |
| 吞吐（注入前 / 注入后） | 0 / 0 Mbit/s |
| `peer transport` | `disabled` |

**为什么无结论**：hub 侧从头到尾没有建立过 relay 会话（0 rebuild / 0 kill），所以
"0 次记录边界失败"是**空断言**——被测代码根本没被执行。hub 日志里是
305 条 `no route for 10.10.0.2, packet discarded` 与 1 条 `route dropped`，即上面
根因链第 ① 条（datagram link 意外终止）在本环境依旧先发，数据面从未建立。

因此脚本加了防空判：若 `rebuilds == 0 || killed == 0`，一律返回 3（INCONCLUSIVE），
绝不返回 0。首次实现时它曾返回 0，那是一个会骗人的假通过。

### 判据设计（与计划不同，已按实际改写）

- 计划要求用吞吐判定（0=恢复且达标 / 2=恢复但降级 / 1=未恢复）。**本环境做不到**：
  数据面在注入之前就是 0，吞吐量到的是 ① 而不是本次修复的对象。
- 现判据改为**以日志为准**：记录边界失败数 > `INJECT_MAX_DESYNC`（默认 3）→ 退出 1
  （修复失效，15s 循环复现）；否则退出 0；未发生替换 → 退出 3。吞吐只打印，不参与判定。
- 计划里"有 `secureReuse=true` 即 PASS"是**错的**：修复生效时被丢弃记录的会话本来就会
  `secureReuse=false`（重新握手）。按原判据，修复成功反而会 FAIL。

### 仍然成立的验证

修复的证据目前只有单元测试（`p2p/internal/host/`）：会话被替换必须换新 secure 会话、
连续记录边界失败必须触发重置、重建出的新会话不得继承旧 streak。
e2e 注入档位已就绪但**尚未能实际验证**，要等根因 ①（datagram link 意外终止）先解决。

### 为什么 ping-only 的 smoke 不算回归门禁

`scripts/smoke-tun.sh` 只做 ping 往返，而 ping 走的是控制面小包：即使密文层永久错位、
数据面吞吐为 0，ping 依然通（约 0.7ms RTT）。它会掩盖本次修复所针对的整类故障，
因此任何回归门禁都必须断言吞吐或记录边界日志，不能只断言可达性。

- 测试覆盖同一代码树下当前状态；另有两个基线观察：
  - `scripts/smoke-tun.sh`（仅 ping 检查）全部通过，不覆盖 TCP 吞吐。
  - `s/p2p/engine` 的 smux keepAlive 改为 3s/15s，记录在 `p2p/internal/host/engine.go:512`。
