#!/usr/bin/env bash
# wisper tun direct-link e2e: one hub and two tun spokes on an isolated bridge.
#
# Why: the unit tests cover the mesh handler and the p2p host, but the feature
# only exists when two real tun devices reach each other through a real relay.
# This script starts a local derper (STUN included), puts the hub and both
# spokes in separate network namespaces, enables direct links on the spokes,
# and proves:
#   - A can ping B and B can ping A over their tun addresses;
#   - each spoke's peer list reports the other as state=direct;
#   - saving A's entrypoint (the restart that used to rebuild the relay
#     registration) keeps direct links working and does not record a new
#     "punch ... failed: caps timeout" event.
#
# Usage:
#   scripts/smoke-tun-direct.sh [workdir]
# Requires: root + CAP_NET_ADMIN + CAP_SYS_ADMIN + /dev/net/tun, ip(8),
# openssl, ping, curl, jq, and $DERPER_BIN or docker to extract the relay.

set -uo pipefail

W="${1:-/tmp/wisper-tun-direct}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/go/bin:/root/.local/bin:$PATH"

DERP_PORT=18443
STUN_PORT=13479
BR=wispdir0
BR_IP=10.97.0.1
HUB_VETH_IP=10.97.0.21
A_VETH_IP=10.97.0.22
B_VETH_IP=10.97.0.23
NS_HUB=wisp-dir-hub
NS_A=wisp-dir-a
NS_B=wisp-dir-b
HUB_API="$HUB_VETH_IP:8901"
A_API="$A_VETH_IP:8902"
B_API="$B_VETH_IP:8903"
HUB_IP=10.10.0.1
A_IP=10.10.0.2
B_IP=10.10.0.3

pass=0; fail=0
ok()  { echo "PASS $1"; pass=$((pass + 1)); }
bad() { echo "FAIL $1"; fail=$((fail + 1)); }
say() { echo "== $*"; }

if [ "$(id -u)" != 0 ]; then echo "SKIP: root is required"; exit 0; fi
if [ ! -c /dev/net/tun ]; then echo "SKIP: /dev/net/tun is not available"; exit 0; fi
for c in curl openssl ping ip jq; do
  command -v "$c" >/dev/null 2>&1 || { echo "SKIP: $c not found"; exit 0; }
done

mkdir -p "$W"
HUB_CFG="$W/hub"; A_CFG="$W/a"; B_CFG="$W/b"
rm -rf "$HUB_CFG" "$A_CFG" "$B_CFG"
mkdir -p "$HUB_CFG" "$A_CFG" "$B_CFG"

pids=()
cleanup() {
  for p in "${pids[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  wait 2>/dev/null
  for ns in "$NS_HUB" "$NS_A" "$NS_B"; do ip netns del "$ns" 2>/dev/null; done
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
  for ns in "$NS_HUB" "$NS_A" "$NS_B"; do ip netns del "$ns" 2>/dev/null || true; done
  ip link del "$BR" 2>/dev/null || true
  ip link add "$BR" type bridge
  ip addr add "$BR_IP/24" dev "$BR"
  ip link set "$BR" up
  add_instance "$NS_HUB" vh-hub "$HUB_VETH_IP"
  add_instance "$NS_A" vh-a "$A_VETH_IP"
  add_instance "$NS_B" vh-b "$B_VETH_IP"
)
if ! setup_netns; then echo "SKIP: cannot build the network namespaces"; exit 0; fi
say "bridge $BR_IP/24, three namespaces"

WISPER_BIN="${WISPER_BIN:-$W/wisper}"
if [ ! -x "$WISPER_BIN" ]; then
  say "building wisper"
  (cd "$ROOT" && CGO_ENABLED=0 go build -o "$WISPER_BIN" .) || { echo "build failed" >&2; exit 1; }
fi

DERPER_BIN="${DERPER_BIN:-}"
if [ -z "$DERPER_BIN" ]; then
  cache="$W/derper-root/usr/local/bin/derper"
  if [ ! -x "$cache" ]; then
    say "extracting derper from ${DERPER_IMAGE:-gogost/derper}"
    command -v docker >/dev/null 2>&1 || { echo "SKIP: no DERPER_BIN and no docker"; exit 0; }
    mkdir -p "$W/derper-root"
    name="wisper-tun-direct-derper-$$"
    docker create --name "$name" "${DERPER_IMAGE:-gogost/derper}" >/dev/null || { echo "docker create failed" >&2; exit 1; }
    docker export "$name" | tar -C "$W/derper-root" -xf -
    docker rm "$name" >/dev/null
  fi
  DERPER_BIN="$cache"
fi

DERP_DIR="$W/derper"
mkdir -p "$DERP_DIR/certs"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$DERP_DIR/certs/$BR_IP.key" -out "$DERP_DIR/certs/$BR_IP.crt" -days 3 \
  -subj "/CN=$BR_IP" -addext "subjectAltName=IP:$BR_IP" >/dev/null 2>&1 \
  || { echo "cert generation failed" >&2; exit 1; }
DERP_URL="wss://$BR_IP:$DERP_PORT/derp"
STUN_URL="$BR_IP:$STUN_PORT"

say "starting derper (DERP $DERP_PORT, STUN $STUN_PORT)"
"$DERPER_BIN" -c "$DERP_DIR/derper.json" -hostname "$BR_IP" -certmode manual \
  -certdir "$DERP_DIR/certs" -a "$BR_IP:$DERP_PORT" -http-port -1 \
  -stun-port "$STUN_PORT" >"$DERP_DIR/derper.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do
  curl -sk --max-time 1 "https://$BR_IP:$DERP_PORT/" >/dev/null 2>&1 && break
  sleep 0.2
done
if curl -sk --max-time 2 "https://$BR_IP:$DERP_PORT/" >/dev/null 2>&1; then
  ok "local derper is up on $BR_IP:$DERP_PORT"
else
  bad "derper did not start (see $DERP_DIR/derper.log)"; exit $fail
fi

start_wisper() { # <ns> <config-dir> <api-addr>
  ip netns exec "$1" env XDG_CONFIG_HOME="$2" "$WISPER_BIN" -addr "$3" >"$2/wisper.log" 2>&1 &
  pids+=($!)
}
wait_api() { # <api>
  for _ in $(seq 1 80); do curl -s --max-time 1 "http://$1/api/p2p" >/dev/null 2>&1 && return 0; sleep 0.2; done
  return 1
}
get_json() { curl -s --max-time 3 "http://$1$2"; }
post_json() { curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$3" "http://$1$2"; }
put_json() { curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' -d "$3" "http://$1$2"; }
pubkey() { get_json "$1" /api/p2p | jq -r '.public_key // empty'; }

say "starting hub, spoke A, spoke B"
start_wisper "$NS_HUB" "$HUB_CFG" "$HUB_API"
start_wisper "$NS_A" "$A_CFG" "$A_API"
start_wisper "$NS_B" "$B_CFG" "$B_API"
wait_api "$HUB_API" || { bad "hub API did not come up"; exit $fail; }
wait_api "$A_API" || { bad "A API did not come up"; exit $fail; }
wait_api "$B_API" || { bad "B API did not come up"; exit $fail; }
ok "all three APIs are up"

P2P_SETTINGS="{\"p2p\":{\"derp\":\"$DERP_URL\",\"stun\":\"$STUN_URL\",\"secure\":false,\"direct\":true}}"
for api in "$HUB_API" "$A_API" "$B_API"; do
  code=$(put_json "$api" /api/config "$P2P_SETTINGS")
  [ "$code" = 200 ] || { bad "PUT /api/config on $api returned $code"; exit $fail; }
done
ok "all three point at the local relay and STUN"

HUB_KEY=$(pubkey "$HUB_API"); A_KEY=$(pubkey "$A_API"); B_KEY=$(pubkey "$B_API")
if [ -n "$HUB_KEY" ] && [ -n "$A_KEY" ] && [ -n "$B_KEY" ] \
  && [ "$HUB_KEY" != "$A_KEY" ] && [ "$HUB_KEY" != "$B_KEY" ] && [ "$A_KEY" != "$B_KEY" ]; then
  ok "three distinct identities"
else
  bad "identities missing or identical"; exit $fail
fi

say "hub tun device with both spokes allowlisted"
code=$(post_json "$HUB_API" /api/tunnels "{
  \"name\": \"hub\", \"type\": \"tun\", \"net\": \"$HUB_IP/24\", \"mtu\": 1420,
  \"peers\": [
    {\"key\": \"$A_KEY\", \"alias\": \"spoke-a\"},
    {\"key\": \"$B_KEY\", \"alias\": \"spoke-b\"}
  ]
}")
[ "$code" = 201 ] || { bad "creating the hub returned $code"; exit $fail; }
ok "hub is up at $HUB_IP/24"

say "spoke A and B tun entrypoints with direct=true"
code=$(post_json "$A_API" /api/entrypoints "{
  \"name\": \"spoke-a\", \"type\": \"tun\", \"peer\": \"$HUB_KEY\",
  \"net\": \"$A_IP/24\", \"routes\": \"$A_IP/24\", \"keepalive\": true, \"direct\": true
}")
[ "$code" = 201 ] || { bad "creating spoke A returned $code"; exit $fail; }
A_ID=$(get_json "$A_API" /api/entrypoints | jq -r '.[]|select(.name=="spoke-a")|.id')
code=$(post_json "$B_API" /api/entrypoints "{
  \"name\": \"spoke-b\", \"type\": \"tun\", \"peer\": \"$HUB_KEY\",
  \"net\": \"$B_IP/24\", \"routes\": \"$B_IP/24\", \"keepalive\": true, \"direct\": true
}")
[ "$code" = 201 ] || { bad "creating spoke B returned $code"; exit $fail; }
B_ID=$(get_json "$B_API" /api/entrypoints | jq -r '.[]|select(.name=="spoke-b")|.id')
[ -n "$A_ID" ] && [ -n "$B_ID" ] || { bad "entrypoint IDs missing"; exit $fail; }
ok "both spoke devices are up"

wait_running() { # <api> <id>
  for _ in $(seq 1 40); do
    s=$(get_json "$1" "/api/entrypoints/$2" | jq -r '.status // empty')
    [ "$s" = running ] && return 0
    sleep 0.5
  done
  return 1
}
wait_running "$A_API" "$A_ID" || bad "spoke A did not become running"
wait_running "$B_API" "$B_ID" || bad "spoke B did not become running"

peer_state() { # <api> <id> <peer-key>
  get_json "$1" "/api/entrypoints/$2/peers" | jq -r --arg k "$3" '.peers[]?|select(.key==$k)|.state' 2>/dev/null | head -1
}
wait_direct() { # <api> <id> <peer-key> <label>
  for _ in $(seq 1 60); do
    [ "$(peer_state "$1" "$2" "$3")" = direct ] && { ok "$4 peer state is direct"; return 0; }
    sleep 1
  done
  bad "$4 peer state never became direct (last: $(peer_state "$1" "$2" "$3"))"
  return 1
}
ping_until() { # <ns> <dst> <checks> <label>
  for _ in $(seq 1 "$3"); do
    ip netns exec "$1" ping -c 1 -W 2 "$2" >/dev/null 2>&1 && { ok "$4"; return 0; }
    sleep 1
  done
  bad "$4"
  return 1
}

# The ping is what triggers the on-demand direct dial; poll the peer lists while
# retrying so a dropped first packet cannot make the test flaky.
say "A -> B and B -> A over the tun devices"
ping_until "$NS_A" "$B_IP" 30 "spoke A reaches spoke B ($B_IP)"
ping_until "$NS_B" "$A_IP" 30 "spoke B reaches spoke A ($A_IP)"
wait_direct "$A_API" "$A_ID" "$B_KEY" "spoke A -> B"
wait_direct "$B_API" "$B_ID" "$A_KEY" "spoke B -> A"

# The regression this script exists for: saving a tun entrypoint restarts it.
# Before the grace period, the shared host was torn down on that gap, the hub's
# relay registration blackholed, and the first punch logged caps timeout.
say "restarting spoke A and requiring direct to survive"
BEFORE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
code=$(put_json "$A_API" "/api/entrypoints/$A_ID" "{
  \"name\": \"spoke-a\", \"type\": \"tun\", \"peer\": \"$HUB_KEY\",
  \"net\": \"$A_IP/24\", \"routes\": \"$A_IP/24\", \"keepalive\": true, \"direct\": true
}")
[ "$code" = 200 ] || bad "put spoke A returned $code"
wait_running "$A_API" "$A_ID" || bad "spoke A did not return to running"
ping_until "$NS_A" "$B_IP" 30 "spoke A reaches B after restart"
ping_until "$NS_B" "$A_IP" 30 "spoke B reaches A after restart"
wait_direct "$A_API" "$A_ID" "$B_KEY" "spoke A -> B after restart"
wait_direct "$B_API" "$B_ID" "$A_KEY" "spoke B -> A after restart"

# A new caps-timeout event after the restart is the failure signature from the
# field report. The grace period must keep the host's relay registration alive.
sleep 3
EVENTS=$(get_json "$A_API" "/api/entrypoints/$A_ID" | jq -r --arg t "$BEFORE" \
  '.events[]? | select(.time >= $t) | select(.level=="warn" and (.message|test("punch .*failed"))) | .message' 2>/dev/null)
if [ -n "$EVENTS" ]; then
  bad "restart recorded a punch failure: $EVENTS"
else
  ok "restart did not record a punch failure"
fi

say "result: $pass passed, $fail failed"
exit "$fail"
