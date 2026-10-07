# Tun entrypoint L2 探针设计（device-fd 死亡看门狗）

- 日期：2026-10-07
- 状态：**已否决，不实现**（见末尾〈否决结论〉）。留档备查。
- 背景：2026-10-07 真机直连黑洞——VPN flap（release→establish）绕过 running holder，
  holder 手里是已销毁 tun0 的 dup，系统把新包路由到 tun1。症状：双 tun 同 IP、
  entrypoint stats 双向冻结、hub 无 `no route`。idle 与 device-fd 死亡在 stats 上
  不可区分（都是双向冻结），必须发 in-band 流量才能探测。
- 关联：`wisper-vpn-flap-blackhole`（修复）、`wisper-tun-conn-probe-eval`（L1/L2/L3 分层）、
  `33d957c`（keepalive 开关移除——本次不恢复它，见 §5）。

## 目标与非目标

- 目标：running 的 tun entrypoint 在 device fd 死亡、hub wedge、回程丢失时，
  ~1min 上报 event，~2min 无恢复则自动 Restart（重拿当前 fd）。
- 非目标：v6 探针、间隔/阈值可调、L3 公网 ping、hub 侧任何改动。

## 方案（已选 A）

- A（采用）：x 发包计数 + wisper 看门狗。机制在 x、策略在 wisper，复用现有 stats 流。
- B（备选未选）：x 暴露 `ProbeStatus()` 直连 accessor——更实时但要新增跨模块实例
  plumbing，30s 探针不需要。
- C（否决）：wisper 全包（拿不到 conn）、Android 经 tun fd 发包（双 reader）、
  x 自己 redial（redial 不重拿 device fd，修不了 fd 死亡）。

## §1 x 侧 wire 与读写环路（`x/handler/tun`）

- Echo 请求：IPv4 ICMP echo，src=spoke 地址、dst=hub 地址，identifier 取保留值
  `0x5749`（"WI"）+ magic payload；经 `conn.Write` 发出（与读环路的用户包写共享
  p2p 写锁，已有序列化保证，见 `p2p_test.go` 交错测试）。
- 读环路在现有 keepalive 帧识别之后加一段：identifier+magic 命中即记 acked、算 RTT、
  丢弃不进 device；未命中走老路。
- hub 侧零改动：hub 内核原生回 ICMP（真机 `ping 10.10.100.1` 已证）。
- 只做 v4。发送间隔与判定阈值见 §3（x 只管按配置发包，所有策略在 wisper）。
- keepalive echo 与本探针的关系：keepalive 环路只经过 conn、不碰 device fd，
  对 fd 死亡全盲——两者正交，不互相替代。

## §2 配置与观测

- handler metadata 加 `probe`（bool，默认开；表单开关关→`false`→x 不发包）。
- stats 加 `probeSent/probeAcked/probeRTTms`（last RTT），走现有 stats 流（1s 粒度，
  30s 探针够用）。
- x 侧单测（缺一不可）：
  1. 回包被认出、计数、不进 device；
  2. identifier/payload 错位不误认（普通 ICMP 照常进 device）；
  3. hub 无回包时 acked 停在原地（watchdog 能看到停滞）。
- `x` 测试全绿是合入 wisper 侧的门槛；gost 共用该 handler，默认行为不变
  （metadata 关即回老路）。

## §3 wisper 侧 watchdog

- 每个 running 的 tun entrypoint 一个 goroutine，随 entrypoint 生命周期启停
 （复用现有 `Close` 路径，不另起全局循环）。
- 节拍 30s，看 `probeAcked` 是否推进：
  - 连丢 2（~1min）→ `event.Record(warn)`，UI 可见；
  - 仍丢到 4（~2min）→ 调 `entrypoint.Restart`（与 `RestartForVpnSwap` 同款动作，
    重拿当前 fd——正好也是 flap 的修复动作）。
- 重启后计数清零，进 10min 冷却：冷却内只 event 不重启，防抖动闪断循环。
- 表单探针开关关→不起 watchdog（与 §2 联动）。

## §4 UI

- tun entrypoint 表单加探针开关，默认开；文案只说开/关，不暴露间隔阈值。
- event（§3 的 warn）进现有 event 流，UI 变红由现有机制承载，不新增展示通道。

## §5 不做清单

- v6 探针、间隔/阈值可调、L3 经 hub ping 公网、hub 侧改动。
- 不恢复 `33d957c` 移除的 keepalive 开关：keepalive echo 环路不经过 device fd，
  对本故障全盲；恢复它还要推翻 guard test 且在 p2p 下只剩 one-shot 语义。

## 参数表（写死常量，见 §5）

| 项 | 值 |
|---|---|
| echo 间隔 | 30s |
| event 阈值 | 连丢 2（~1min） |
| restart 阈值 | 连丢 4（~2min） |
| 重启后冷却 | 10min（只 event 不重启） |
| identifier | `0x5749` + magic payload |
| 范围 | IPv4，tun entrypoint |

## 自查

- 无 TBD/占位；阈值、动作、归属（x 机制/wisper 策略）均已定。
- 一致性：§2 的 metadata 门控与 §3/§4 的开关语义一致（关=两边都停）；
  §3 的 Restart 与 flap 修复同动作，无第二套恢复路径。
- 范围：单 spec 可覆盖（x 改动 + wisper 改动 + UI 开关），不拆分。
- 歧义：`probeAcked` 推进指"本周期内 acked 增加"，实现时按周期快照差值判，
  不按累计值判（防重启清零/溢出误判）——实现计划里展开。

## 否决结论（2026-10-07 真机 spike 后追加，不实现）

- §1 方向先被证伪：x 自己组包经 `conn.Write` 发出，全程不经过 device fd——
  flap 死的是 fd 而链路是好的，echo 照常来回，探针全绿、黑洞照黑。
  只有从 fd 里 `Read` 出来的包才算穿过读侧，只有 `Write` 进 fd 的才算穿过写侧。
- 替代方向（被动读内核计数器）也被证伪：`/sys/class/net/tun0/statistics/*`
  连 shell 都 Permission denied（SELinux 挡 stat）；`/proc/net/dev` shell 可读
  但 `run-as` 进 app 沙盒同样 Permission denied；`ip link` 也无权。
  app 自己的 socket 流量又不进自己的 VPN——用户态在 Android 上没有 device
  健康的地面真值，被动主动两条路都走不通。
- 结论：探针整个砍掉。同类故障已有 cause-level 根治（`5a7e587` flapPending +
  轮询失败不再 release）；`RestartForVpnSwap` 重启即记 event，
  下次 stall 时间线上有嫌疑人。spoke 跑 Linux 那天（sysfs 可读）可复活此方案。
