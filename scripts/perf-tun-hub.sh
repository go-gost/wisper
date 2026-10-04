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

start_wisper() { ip netns exec "$1" env XDG_CONFIG_HOME="$2" "$WISPER_BIN" -addr "$3" >"$2/wisper.log" 2>&1 & pids+=($!); }
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
# level, which is why the config above turns the level up.
HUB_LOG=$(ls -1 "$HUB_CFG"/wisper/logs/*.log 2>/dev/null | head -1)

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

# Verdict. The signal is the hub log, not the throughput alone: a session that
# cannot realign logs a record-boundary failure on EVERY rebuild (the field saw
# 69 of them over ~2.5h), whereas a pair that re-handshakes logs at most a
# transient one while it learns of the new key.
desync=$(grep -c -e 'bad secure record length' -e 'secure record auth failed' "$HUB_LOG" 2>/dev/null)
rebuilds=$(grep -c 'relay session rebuilt' "$HUB_LOG" 2>/dev/null)
killed=$(grep -c 'peer session killed' "$HUB_LOG" 2>/dev/null)
reasons=$(grep -o '"relayReason":"[a-z-]*"' "$HUB_LOG" 2>/dev/null | sort | uniq -c | tr '\n' ' ')
say "hub log: $HUB_LOG"
say "hub log: session kills=$killed rebuilds=$rebuilds record-boundary failures=$desync"
say "kill reasons: ${reasons:-none}"

recovered=no
if awk "BEGIN{exit !($post_bps >= $INJECT_MIN_BPS)}" 2>/dev/null; then recovered=yes; fi
degraded=no
if [ -n "${base_bps:-}" ] && [ "$base_bps" != "0" ] && \
   awk "BEGIN{exit !($post_bps < $base_bps * $INJECT_DEGRADED_RATIO)}" 2>/dev/null; then degraded=yes; fi

if [ "$desync" -gt "$INJECT_MAX_DESYNC" ]; then
  say "FAIL: $desync record-boundary failures (> $INJECT_MAX_DESYNC) — the pair never realigned. This is the bug this plan fixes."
  exit 1
fi
# Throughput is reported, NOT gated. The datagram link dies on its own in this
# environment (cause 1 in docs/tun-hub-bandwidth-e2e.md, explicitly out of this
# plan's scope), which zeroes the data plane before and after any injection — so
# a throughput verdict would measure that, not the relay secure-session fix. The
# log signature above is the discriminating signal.
say "throughput (informational, gated by out-of-scope cause 1): post=${post_bps:-0} Mbit/s baseline=${base_bps:-0} Mbit/s recovered=$recovered degraded=$degraded"
# Refuse to pass vacuously. "0 record-boundary failures" means nothing if no
# relay session was ever built and nothing was ever replaced — that is the case
# when the data plane never came up at all (cause 1), and it must read as
# INCONCLUSIVE, never as PASS.
if [ "$rebuilds" -eq 0 ] || [ "$killed" -eq 0 ]; then
  say "INCONCLUSIVE: $rebuilds rebuild(s), $killed kill(s) — no relay session was ever replaced, so the fix was never exercised"
  exit 3
fi
if [ "$desync" -eq 0 ]; then
  say "PASS: $rebuilds rebuild(s), $killed kill(s), 0 record-boundary failures — every rebuild re-handshaked cleanly"
  exit 0
fi
say "PASS (with $desync transient record-boundary failure(s), within the $INJECT_MAX_DESYNC budget)"
exit 0
