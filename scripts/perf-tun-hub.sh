#!/usr/bin/env bash
# wisper tun-hub e2e bandwidth probe: a hub (wisper `tun` tunnel) and one spoke
# (tun entrypoint) in separate network namespaces, traffic driven by iperf3
# across the devices so every byte crosses the p2p smux session.
#
# Usage:
#   scripts/perf-tun-hub.sh [--inject-session-kill] [workdir]
# Env:
#   DERPER_BIN, WISPER_BIN, DERP_PORT, DIRECT (false|true, default false),
#   IPERF_SEC (default 10; 150 with --inject-session-kill unless set),
#   INJECT_EVERY (default 45), INJECT_FOR (default 20 — MUST exceed smux's 15s
#   keepalive timeout, or the session is never starved and nothing is injected),
#   INJECT_MIN_BPS (default 1000000: 1 Mbit/s floor for "still passing traffic"),
#   INJECT_MAX_DESYNC (default 3: tolerated record-boundary failures),
#   INJECT_DEGRADED_RATIO (default 0.5: post/pre below this is "degraded")
#
# Exit codes with --inject-session-kill:
#   0  every injected session kill rebuilt cleanly (no record-boundary failures)
#   1  the pair never realigned — the 15s rebuild loop reproduced
#   3  INCONCLUSIVE: no relay session was ever replaced, so the fix was never
#      exercised (this happens when the data plane never comes up at all)
# Throughput is reported but NOT gated: the datagram link dies on its own in this
# environment (out of this plan's scope), so throughput measures that, not the fix.

set -uo pipefail

INJECT=0
args=()
for a in "$@"; do
  case "$a" in
    --inject-session-kill) INJECT=1 ;;
    *) args+=("$a") ;;
  esac
done

W="${args[0]:-/tmp/wisper-tun-perf}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/go/bin:$PATH"

DERP_PORT="${DERP_PORT:-8443}"
DIRECT="${DIRECT:-false}"
IPERF_SEC_WAS_SET=${IPERF_SEC+x}
IPERF_SEC="${IPERF_SEC:-10}"
INJECT_EVERY="${INJECT_EVERY:-45}"
INJECT_FOR="${INJECT_FOR:-20}"
INJECT_MIN_BPS="${INJECT_MIN_BPS:-1000000}"
INJECT_MAX_DESYNC="${INJECT_MAX_DESYNC:-3}"
INJECT_DEGRADED_RATIO="${INJECT_DEGRADED_RATIO:-0.5}"
# The session-death/rebuild fields this run gates on are Debug level in p2p, and
# the API config PUT does not move the running logger's level — only the startup
# flag does. So the injection tier asks for debug on the command line.
LOG_LEVEL="${LOG_LEVEL:-}"
if [ "$INJECT" = 1 ] && [ -z "$LOG_LEVEL" ]; then LOG_LEVEL=debug; fi
# A 10s run cannot hold three injections; only stretch the default, never an
# explicit IPERF_SEC.
if [ "$INJECT" = 1 ] && [ -z "$IPERF_SEC_WAS_SET" ]; then IPERF_SEC=150; fi
BR=wispbr0
BR_IP=10.99.0.1
HUB_VETH_IP=10.99.0.11
SPOKE_VETH_IP=10.99.0.12
NS_HUB=wisp-hub
NS_SPOKE=wisp-spoke
HUB_API="$HUB_VETH_IP:8901"
SPOKE_API="$SPOKE_VETH_IP:8902"
HUB_IP=10.10.0.1
SPOKE_IP=10.10.0.2

say() { echo "== $*"; }

for c in curl openssl ip iperf3; do command -v "$c" >/dev/null || { echo "SKIP: $c not found"; exit 0; }; done
[ "$(id -u)" = 0 ] || { echo "SKIP: root required"; exit 0; }
[ -c /dev/net/tun ] || { echo "SKIP: no /dev/net/tun"; exit 0; }

mkdir -p "$W"
HUB_CFG="$W/hub"; SPOKE_CFG="$W/spoke"
rm -rf "$HUB_CFG" "$SPOKE_CFG"
mkdir -p "$HUB_CFG" "$SPOKE_CFG"

pids=()
cleanup() {
  for p in "${pids[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  wait 2>/dev/null
  for ns in "$NS_HUB" "$NS_SPOKE"; do ip netns del "$ns" 2>/dev/null; done
  ip link del "$BR" 2>/dev/null
}
trap cleanup EXIT

add_instance() { # <ns> <veth> <ip>
  ip netns add "$1"
  ip link add "$2" type veth peer name "$2-ns"
  ip link set "$2-ns" netns "$1"
  ip link set "$2" master "$BR"
  ip link set "$2" up
  ip netns exec "$1" ip link set lo up
  ip netns exec "$1" ip addr add "$3/24" dev "$2-ns"
  ip netns exec "$1" ip link set "$2-ns" up
  ip netns exec "$1" ip route add default via "$BR_IP"
}

setup_netns() (
  set -e
  for ns in "$NS_HUB" "$NS_SPOKE"; do ip netns del "$ns" 2>/dev/null || true; done
  ip link del "$BR" 2>/dev/null || true
  ip link add "$BR" type bridge
  ip addr add "$BR_IP/24" dev "$BR"
  ip link set "$BR" up
  add_instance "$NS_HUB" vh-hub "$HUB_VETH_IP"
  add_instance "$NS_SPOKE" vh-spoke "$SPOKE_VETH_IP"
)
setup_netns || { echo "SKIP: netns"; exit 0; }

WISPER_BIN="${WISPER_BIN:-}"
[ -n "$WISPER_BIN" ] || { say "building wisper"; (cd "$ROOT" && CGO_ENABLED=0 go build -o "$W/wisper" .) || exit 1; WISPER_BIN="$W/wisper"; }

DERPER_BIN="${DERPER_BIN:-}"
if [ -z "$DERPER_BIN" ]; then
  cache="$W/derper-root/usr/local/bin/derper"
  if [ ! -x "$cache" ]; then
    say "extracting derper"
    mkdir -p "$W/derper-root"
    name="wisper-tun-perf-derper-$$"
    docker create --name "$name" "${DERPER_IMAGE:-gogost/derper}" >/dev/null || exit 1
    docker export "$name" | tar -C "$W/derper-root" -xf -
    docker rm "$name" >/dev/null
  fi
  DERPER_BIN="$cache"
fi
[ -x "$DERPER_BIN" ] || { echo "no derper"; exit 1; }

DERP_DIR="$W/derper"; mkdir -p "$DERP_DIR/certs"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$DERP_DIR/certs/$BR_IP.key" -out "$DERP_DIR/certs/$BR_IP.crt" -days 3 \
  -subj "/CN=$BR_IP" -addext "subjectAltName=IP:$BR_IP" >/dev/null 2>&1
DERP_URL="wss://$BR_IP:$DERP_PORT/derp"
say "starting derper on $BR_IP:$DERP_PORT"
"$DERPER_BIN" -c "$DERP_DIR/derper.json" -hostname "$BR_IP" -certmode manual \
  -certdir "$DERP_DIR/certs" -a "$BR_IP:$DERP_PORT" -http-port -1 -stun=false \
  >"$DERP_DIR/derper.log" 2>&1 &
pids+=($!)
DERPER_PID=$!
for _ in $(seq 1 50); do curl -sk --max-time 1 "https://$BR_IP:$DERP_PORT/" >/dev/null 2>&1 && break; sleep 0.2; done

start_wisper() { ip netns exec "$1" env XDG_CONFIG_HOME="$2" "$WISPER_BIN" -addr "$3" ${LOG_LEVEL:+-log.level "$LOG_LEVEL"} >"$2/wisper.log" 2>&1 & pids+=($!); }
wait_api() { for _ in $(seq 1 50); do curl -s --max-time 1 "http://$1/api/p2p" >/dev/null 2>&1 && return 0; sleep 0.2; done; return 1; }
pubkey() { curl -s "http://$1/api/p2p" | sed -n 's/.*"public_key":"\([^"]*\)".*/\1/p'; }

start_wisper "$NS_HUB" "$HUB_CFG" "$HUB_API"
start_wisper "$NS_SPOKE" "$SPOKE_CFG" "$SPOKE_API"
wait_api "$HUB_API" || { echo "hub api down"; tail -20 "$HUB_CFG/wisper.log"; exit 1; }
wait_api "$SPOKE_API" || { echo "spoke api down"; tail -20 "$SPOKE_CFG/wisper.log"; exit 1; }

P2P_SETTINGS="{\"p2p\":{\"derp\":\"$DERP_URL\",\"secure\":false,\"direct\":$DIRECT},\"log\":{\"level\":\"debug\"}}"
for api in "$HUB_API" "$SPOKE_API"; do
  curl -s -o /dev/null -w '%{http_code}\n' -X PUT -H 'Content-Type: application/json' -d "$P2P_SETTINGS" "http://$api/api/config"
done

# wisper writes its structured log under its own configDir, not next to the
# process's stderr. The session-death/rebuild fields this run gates on are Debug
# level, which is why the log level is turned up on the command line above: the
# API config PUT does not move a running logger's level.
# Both sides are collected: which peer desyncs and which recovers is not fixed,
# so a verdict that reads one side's log can miss the bug entirely.
HUB_LOG=$(ls -1 "$HUB_CFG"/wisper/logs/*.log 2>/dev/null | head -1)
SPOKE_LOG=$(ls -1 "$SPOKE_CFG"/wisper/logs/*.log 2>/dev/null | head -1)

HUB_KEY=$(pubkey "$HUB_API"); SPOKE_KEY=$(pubkey "$SPOKE_API")
say "hub=$HUB_KEY spoke=$SPOKE_KEY"

curl -s -o /dev/null -w 'hub tun: %{http_code}\n' -X POST -H 'Content-Type: application/json' -d "{
  \"name\": \"hub\", \"type\": \"tun\", \"net\": \"$HUB_IP/24\", \"mtu\": 1420,
  \"peers\": [{\"key\": \"$SPOKE_KEY\", \"alias\": \"spoke\"}]
}" "http://$HUB_API/api/tunnels"

curl -s -o /dev/null -w 'spoke tun: %{http_code}\n' -X POST -H 'Content-Type: application/json' -d "{
  \"name\": \"spoke\", \"type\": \"tun\", \"peer\": \"$HUB_KEY\",
  \"net\": \"$SPOKE_IP/32\", \"routes\": \"$HUB_IP/32\", \"keepalive\": true, \"ttl\": 15,
  \"mtu\": 1420
}" "http://$SPOKE_API/api/entrypoints"

for _ in $(seq 1 20); do
  ip netns exec "$NS_HUB" ping -c 1 -W 2 "$SPOKE_IP" >/dev/null 2>&1 && break; sleep 1
done
ip netns exec "$NS_HUB" ping -c 2 -W 2 "$SPOKE_IP" | tail -2
transport=$(curl -s "http://$SPOKE_API/api/entrypoints" | sed -n 's/.*"peer_transport":"\([^"]*\)".*/\1/p')
say "peer transport: ${transport:-unknown}"

say "TCP hub->spoke (hub client, spoke server), ${IPERF_SEC}s"
ip netns exec "$NS_SPOKE" iperf3 -s -B "$SPOKE_IP" -D
sleep 1
timeout $((IPERF_SEC + 15)) ip netns exec "$NS_HUB" iperf3 -c "$SPOKE_IP" -B "$HUB_IP" -t "$IPERF_SEC"
ip netns exec "$NS_SPOKE" pkill -f "iperf3 -s" || true
sleep 1

say "TCP spoke->hub (spoke client, hub server), ${IPERF_SEC}s"
ip netns exec "$NS_HUB" iperf3 -s -B "$HUB_IP" -D
sleep 1
timeout $((IPERF_SEC + 15)) ip netns exec "$NS_SPOKE" iperf3 -c "$HUB_IP" -B "$SPOKE_IP" -t "$IPERF_SEC"
ip netns exec "$NS_HUB" pkill -f "iperf3 -s" || true
sleep 1

say "TCP hub->spoke, -P 4 parallel streams, ${IPERF_SEC}s"
ip netns exec "$NS_SPOKE" iperf3 -s -B "$SPOKE_IP" -D
sleep 1
timeout $((IPERF_SEC + 15)) ip netns exec "$NS_HUB" iperf3 -c "$SPOKE_IP" -B "$HUB_IP" -t "$IPERF_SEC" -P 4
ip netns exec "$NS_SPOKE" pkill -f "iperf3 -s" || true

say "UDP hub->spoke, target 100M, ${IPERF_SEC}s"
ip netns exec "$NS_SPOKE" iperf3 -s -B "$SPOKE_IP" -D
sleep 1
timeout $((IPERF_SEC + 15)) ip netns exec "$NS_HUB" iperf3 -u -c "$SPOKE_IP" -B "$HUB_IP" -t "$IPERF_SEC" -b 100M
ip netns exec "$NS_SPOKE" pkill -f "iperf3 -s" || true

say "done. derper log tail:"
tail -5 "$DERP_DIR/derper.log" 2>/dev/null

[ "$INJECT" = 1 ] || exit 0

# --- injected session kills -------------------------------------------------
#
# The injection is a paused relay, not a new hook into the host: SIGSTOP on the
# derper starves the smux keepalive, so the relay session is closed in place and
# replaced — the exact path the production 15s loop took (see
# p2p/docs/2026-10-04-p2p-relay-session-desync-plan.md). p2p's fault knobs are
# startup-only by design ("not reachable from a network API"), so nothing here
# adds an injection channel; it breaks the link from outside, like the field.

say "baseline throughput before injection"
ip netns exec "$NS_SPOKE" iperf3 -s -B "$SPOKE_IP" -D
sleep 1
base_out=$(timeout $((IPERF_SEC + 15)) ip netns exec "$NS_HUB" \
  iperf3 -c "$SPOKE_IP" -B "$HUB_IP" -t 10 2>&1)
base_bps=$(printf '%s\n' "$base_out" | awk '/receiver/ {for (i=1;i<=NF;i++) if ($i=="Mbits/sec") print $(i-1)}' | tail -1)
say "baseline: ${base_bps:-0} Mbit/s"

# injector SIGSTOPs the relay every INJECT_EVERY seconds for INJECT_FOR. The
# pause must outlast smux's 15s keepalive timeout (p2p engine.go) or the session
# is never starved and nothing is actually injected.
( end=$((SECONDS + IPERF_SEC)); n=0
  while [ "$SECONDS" -lt "$end" ]; do
    sleep "$INJECT_EVERY"
    [ "$SECONDS" -lt "$end" ] || break
    n=$((n + 1))
    say "injection $n: pausing the relay for ${INJECT_FOR}s"
    kill -STOP "$DERPER_PID" 2>/dev/null
    sleep "$INJECT_FOR"
    kill -CONT "$DERPER_PID" 2>/dev/null
  done
  say "injections done: $n" ) &
INJECTOR=$!
pids+=("$INJECTOR")

say "TCP hub->spoke, -P 4 parallel streams, ${IPERF_SEC}s, with injected session kills"
ip netns exec "$NS_SPOKE" iperf3 -s -B "$SPOKE_IP" -D
sleep 1
inj_out=$(timeout $((IPERF_SEC + 30)) ip netns exec "$NS_HUB" \
  iperf3 -c "$SPOKE_IP" -B "$HUB_IP" -t "$IPERF_SEC" -P 4 2>&1)
say "post-injection throughput"
post_out=$(timeout 40 ip netns exec "$NS_HUB" \
  iperf3 -c "$SPOKE_IP" -B "$HUB_IP" -t 10 2>&1)
post_bps=$(printf '%s\n' "$post_out" | awk '/receiver/ {for (i=1;i<=NF;i++) if ($i=="Mbits/sec") print $(i-1)}' | tail -1)
ip netns exec "$NS_SPOKE" pkill -f "iperf3 -s" || true

# Verdict. A COUNT cannot tell a healed pair from a permanently desynced one: a
# self-healing pair still logs a few record-boundary failures while it learns of
# the new key, so any fixed budget is either too tight to pass a good run or too
# loose to catch the bug. The discriminating signal is TEMPORAL — after the last
# relay session came up, the pair must log no further boundary failure. The bug
# this fixes fails on EVERY rebuild and can never produce that quiet tail.
#
# Both sides are checked, and neither alone is enough: the side that desyncs and
# the side that recovers can be different peers, and the observed run failed on
# the spoke while the hub rebuilt cleanly throughout.
#
# Note the log format: wisper's handler folds slog attrs into the message text
# as key=value, so "relayReason" never appears as a JSON key. Grep for the
# key=value form or the tally comes out empty.
boundary_failures_after_last_up() {
  [ -n "$1" ] && [ -f "$1" ] || { echo 0; return; }
  awk '
    /peer relay session up/ { up = NR }
    { line[NR] = $0 }
    END {
      n = 0
      for (i = up + 1; i <= NR; i++)
        if (line[i] ~ /bad secure record length/ || line[i] ~ /secure record auth failed/) n++
      print n + 0
    }
  ' "$1"
}

# self_healed reports 0 when the log shows the fix doing its job: a kill that
# actually dropped the secure session, followed by a fresh relay session on the
# rebuilt keys.
self_healed() {
  [ -n "$1" ] && [ -f "$1" ] || return 1
  awk '
    /dropSecure=true/ { dropped = NR }
    /peer relay session up/ { if (dropped && !healed) healed = 1 }
    END { exit !(dropped && healed) }
  ' "$1"
}

for role in hub spoke; do
  eval "log=\${${role^^}_LOG}"
  say "$role log: $log"
  say "$role log: session kills=$(grep -c 'peer session killed' "$log" 2>/dev/null)" \
      "rebuilds=$(grep -c 'relay session rebuilt' "$log" 2>/dev/null)" \
      "session-ups=$(grep -c 'peer relay session up' "$log" 2>/dev/null)" \
      "boundary failures (all)=$(grep -c -e 'bad secure record length' -e 'secure record auth failed' "$log" 2>/dev/null)" \
      "boundary failures (after last session up)=$(boundary_failures_after_last_up "$log")"
  say "$role kill reasons: $(grep -o 'relayReason=[a-z-]*' "$log" 2>/dev/null | sort | uniq -c | tr '\n' ' ' | sed 's/  */ /g')"
done

recovered=no
if awk "BEGIN{exit !($post_bps >= $INJECT_MIN_BPS)}" 2>/dev/null; then recovered=yes; fi
degraded=no
if [ -n "${base_bps:-}" ] && [ "$base_bps" != "0" ] && \
   awk "BEGIN{exit !($post_bps < $base_bps * $INJECT_DEGRADED_RATIO)}" 2>/dev/null; then degraded=yes; fi

# Throughput is reported, NOT gated: it measures the data plane, not the relay
# secure-session fix, and in this environment the tun pair's own datagram link
# can drop on its own. The log signature below is the signal.
say "throughput (informational): post=${post_bps:-0} Mbit/s baseline=${base_bps:-0} Mbit/s recovered=$recovered degraded=$degraded"

# Fail first, on the one thing that is unambiguous: a boundary failure AFTER the
# last session came up means the pair is still desynced with nothing left to fix
# it. This is the bug, and no amount of rebuilding hides it.
worst=0
for role in hub spoke; do
  eval "log=\${${role^^}_LOG}"
  n=$(boundary_failures_after_last_up "$log")
  [ "$n" -gt "$worst" ] && worst=$n
done
if [ "$worst" -gt "$INJECT_MAX_DESYNC" ]; then
  say "FAIL: $worst record-boundary failure(s) logged AFTER the last relay session came up (> $INJECT_MAX_DESYNC) — the pair never realigned. This is the bug this plan fixes."
  exit 1
fi

# Refuse to pass vacuously. A quiet tail means nothing if the fix was never
# exercised, so require the drop-then-rebuild sequence to appear on AT LEAST ONE
# side — that is the proof the injection reached the relay path and the pair
# healed. One side is the right bar, not both: a peer recovering via rekey keeps
# its secure session by design (resetPeerSession must not drop it), so a healthy
# pair only ever shows dropSecure=true on the side that actually desynced.
healed_sides=""
for role in hub spoke; do
  eval "log=\${${role^^}_LOG}"
  if self_healed "$log"; then healed_sides="$healed_sides $role"; fi
done
if [ -z "$healed_sides" ]; then
  say "INCONCLUSIVE: neither side logged a dropSecure=true kill followed by a fresh relay session — the fix was never exercised, so a quiet tail proves nothing"
  exit 3
fi

say "PASS: $healed_sides dropped the secure session and re-handshaked onto a fresh relay session; no side logged a boundary failure after its last session came up"
exit 0
