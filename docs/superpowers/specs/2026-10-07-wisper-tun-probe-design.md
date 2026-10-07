# Tun entrypoint 探针设计（fd-write 回环看门狗）

- 日期：2026-10-07（v2 重写；v1 的 L2-hub-echo 方向已证伪，见〈已证伪的方向〉）
- 状态：设计已确认，待实现计划
- 背景：2026-10-07 真机直连黑洞——VPN flap（release→establish）绕过 running holder，
  holder 手里是已销毁 tun0 的 dup，系统把新包路由到 tun1。症状：双 tun 同 IP、
  entrypoint stats 双向冻结、hub 无 `no route`。idle 与 device-fd 死亡在 stats 上
  不可区分（都是双向冻结），且 x 读环路在无入站流量时不写 device、不报错，
  于是整个死亡是静默的。
- 关联：`wisper-vpn-flap-blackhole`（cause-level 修复 `5a7e587`）、
  `wisper-tun-conn-probe-eval`（L1/L2/L3 分层）。

## 目标与非目标

- 目标：running 的 tun entrypoint 在 device fd 死亡（写侧）时，
  ~1min 上报 event，~2min 无恢复则自动 Restart（重拿当前 fd）。
- 非目标：v6 探针、间隔/阈值可调、L3 公网 ping、hub 侧任何改动、
  读侧单死（无解，见覆盖声明）。

## 方案（x 发包计数 + wisper 看门狗）

- 机制在 x、策略在 wisper，复用现有 1s stats 流。
- 否决过：x 自己 redial（redial 不重拿 device fd，修不了 fd 死亡）、
  wisper 全包（拿不到 conn）、Android 经 tun fd 发包做出方向探测（双 reader）。
- `core/` 不动：`stats.Kind` 只是 int 类型，探针 Kind 常量在 x 内定义
  （`101` 起），`x/observer/stats` 自家 switch 加 case。gost 侧默认零值、无影响。

## §1 x 侧探针（`x/handler/tun` client，fd-write 回环）

- 语义：TUN `write(fd)` = 把包递给本机协议栈（不进隧道），`read(fd)` = 拿 app
  发进隧道的包。所以往 fd 写包测的是 **fd 写侧 + 内核本地交付**，不碰读环路。
- 做法：tun client 里一个探针 goroutine（metadata `probe` 开才起，缺省关），
  每 30s 往 device `write` 一个 IPv4 UDP 包：spokeIP→spokeIP（注册地址里的
  第一个 v4；无 v4 则探针禁用记 warn），目的端口是 prober 自绑 socket 的端口，
  payload 带 magic。prober socket 只收不发，recv 命中 magic 即记 acked。
- 并发：与读环路的 `tun.Write`（入站转发）并发写同一 fd——TUN 写是按 datagram
  原子的，不加锁（plan 里 pin：若 x 有现成写锁模式则复用，否则不加）。
- 读环路零改动、不动 wire、hub 零感知（包不出本机，hub 看不到任何东西）。
- spike 实证（2026-10-07，Linux，`tunspike/`）：建 tun → dup fd → 关原 fd →
  删接口 → `write(dup)` 直接报错（`file descriptor in bad state`），读亦然。
  所以观测到的死亡形态下 write 报错即信号；socket recv 另盖
  "write 成功但吞掉" 的 hypothetical 状态，并避免无收包时的 ICMP
  port-unreachable 噪声。

## §2 配置与观测

- handler metadata 加 `probe`（bool，缺省 false；wisper 的 tun entrypoint
  `init()` 在表单开关开时显式置 true——gost 默认行为不变）。
- `x/observer/stats.Stats` 加 `probeSent/probeAcked`（atomic，Get 加 case），
  Kind 常量在 x 内定义；`config.ServiceStats`（wisper）加同名字段；
  `runner/task/stats.go:updateEntrypoint` 加两行映射。entrypoint
  Restart/stats carry-over 原样带上新字段（struct 整体拷贝）。
- x 侧单测：
  1. 活 fd：acked 推进、包被 socket 收走不进隧道（读环路无感）；
  2. 死 fd（ device mock 写报错）：acked 停滞、sent 推进；
  3. metadata 缺省：探针 goroutine 不起（gost 路径零变化）。
- `x` 测试全绿是合入 wisper 侧的门槛。

## §3 wisper 侧 watchdog

- 每个 running 的 tun entrypoint 一个 goroutine，随 entrypoint 生命周期启停
  （复用现有 `Close` 路径；表单开关关→不起）。
- 节拍 30s，看 `probeAcked` 快照差值是否推进（防重启清零/溢出误判）：
  - 连丢 2（~1min）→ `event.Record(warn)`，UI 可见；
  - 仍丢到 4（~2min）→ 调 `entrypoint.Restart`（与 `RestartForVpnSwap` 同款动作，
    重拿当前 fd——正好也是 flap 的修复动作）。
- 重启后计数清零，进 10min 冷却：冷却内只 event 不重启，防抖动闪断循环。

## §4 UI

- tun entrypoint 表单加探针开关，默认开；文案只说开/关，不暴露间隔阈值。
- event（§3 的 warn）进现有 event 流，UI 变红由现有机制承载，不新增展示通道。

## §5 不做清单

- v6 探针、间隔/阈值可调、L3 经 hub ping 公网、hub 侧改动。
- 不恢复 `33d957c` 移除的 keepalive 开关（环路不经过 device fd，对本故障全盲）。
- 读侧单死不覆盖（见下）。

## 覆盖声明

| 故障 | 结论 |
|---|---|
| flap（fd 读写双死，2026-10-07 实案） | 抓（write 报错；spike 实证） |
| fd 写侧死、读侧活 | 抓 |
| fd 读侧死、写侧活 | 盲——读侧只能靠 app 真实流量证明，用户态无解，认了 |
| hub 侧 stall、回程丢 | 盲（包不出本机；hub 侧问题看 hub 日志/`no route`） |

## 参数表（写死常量）

| 项 | 值 |
|---|---|
| echo 间隔 | 30s（x 探针 ticker） |
| 看门狗节拍 | 30s（wisper 侧） |
| event 阈值 | acked 连 2 周期不推进（~1min） |
| restart 阈值 | acked 连 4 周期不推进（~2min） |
| 重启后冷却 | 10min（只 event 不重启） |
| 范围 | IPv4，tun entrypoint（spoke 侧；hub 不需要） |

## 已证伪的方向（留档，勿重踩）

1. **L2-hub-echo（v1 §1）**：x 自己组包经 `conn.Write` 发出，全程不经过 device
   fd——flap 下链路是好的，echo 照常来回，探针全绿、黑洞照黑。只有从 fd 里
   `Read` 出来的包才算穿过读侧，只有 `Write` 进 fd 的才算穿过写侧。
2. **被动读内核计数器**：`/sys/class/net/tun0/statistics/*` 连 shell 都
   Permission denied；`/proc/net/dev` shell 可读但 `run-as` 进 app 沙盒同样
   Permission denied；`ip link` 也无权。用户态在 Android 上没有 device 健康的
   地面真值。
3. **app socket 自发包穿 VPN**：VPN 应用自身流量不进自己的 VPN（ desert 评估
   笔记约束），in-band 自探测无门。
