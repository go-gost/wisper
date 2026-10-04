#!/usr/bin/env bash
# wisper tun smoke: two tun entrypoints joined directly, no hub.
#
# Why: a tun entrypoint is a client — it owns a device and dials one peer —
# but the p2p host's rendezvous pairs two mutual dials onto one shared edge,
# so two entrypoints that point at each other ARE a symmetric link (the
# tun client <-> tun client shape). smoke-tun.sh always puts a hub in the
# middle; this script proves the direct shape works, and that a peer can
# leave and come back on the same key.
#
# Usage:
#   scripts/smoke-tun-tun.sh [workdir]
# Requires: root + CAP_NET_ADMIN + CAP_SYS_ADMIN, /dev/net/tun, ip(8),
# openssl, ping, curl, and either $DERPER_BIN or docker.

set -uo pipefail

W="${1:-/tmp/wisper-tun-tun-smoke}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/go/bin:$PATH"

DERP_PORT="${DERP_PORT:-8444}"
BR=wispbr1
BR_IP=10.98.0.1
A_VETH_IP=10.98.0.21
B_VETH_IP=10.98.0.22
NS_A=wisp-tt-a
NS_B=wisp-tt-b
A_API="${A_API:-$A_VETH_IP:8901}"
B_API="${B_API:-$B_VETH_IP:8902}"
A_IP=10.20.0.1
B_IP=10.20.0.2

pass=0; fail=0
ok()  { echo "PASS $1"; pass=$((pass + 1)); }
bad() { echo "FAIL $1"; fail=$((fail + 1)); }
say() { echo "== $*"; }

if [ "$(id -u)" != 0 ]; then
  echo "SKIP: root is required"; exit 0
fi
if [ ! -c /dev/net/tun ]; then
  echo "SKIP: /dev/net/tun is not available"; exit 0
fi
for c in curl openssl ping ip; do
  command -v "$c" >/dev/null 2>&1 || { echo "SKIP: $c not found"; exit 0; }
done

mkdir -p "$W"
A_CFG="$W/a"; B_CFG="$W/b"
rm -rf "$A_CFG" "$B_CFG"
mkdir -p "$A_CFG" "$B_CFG"

pids=()
cleanup() {
  for p in "${pids[@]:-}"; do
    [ -n "$p" ] && kill "$p" 2>/dev/null
  done
  wait 2>/dev/null
  for ns in "$NS_A" "$NS_B"; do ip netns del "$ns" 2>/dev/null; done
  ip link del "$BR" 2>/dev/null
}
trap cleanup EXIT

add_instance() { # <ns> <veth-name> <veth-ip>
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
  for ns in "$NS_A" "$NS_B"; do ip netns del "$ns" 2>/dev/null || true; done
  ip link del "$BR" 2>/dev/null || true
  ip link add "$BR" type bridge
  ip addr add "$BR_IP/24" dev "$BR"
  ip link set "$BR" up
  add_instance "$NS_A" vh-a "$A_VETH_IP"
  add_instance "$NS_B" vh-b "$B_VETH_IP"
)

setup_netns
if [ $? -ne 0 ]; then
  echo "SKIP: cannot build the network namespaces"; exit 0
fi
say "a bridge ($BR_IP/24) and one namespace per peer"

WISPER_BIN="${WISPER_BIN:-}"
if [ -z "$WISPER_BIN" ]; then
  say "building wisper"
  (cd "$ROOT" && CGO_ENABLED=0 go build -o "$W/wisper" .) || { echo "build failed" >&2; exit 1; }
  WISPER_BIN="$W/wisper"
fi

DERPER_BIN="${DERPER_BIN:-}"
if [ -z "$DERPER_BIN" ]; then
  cache="$W/derper-root/usr/local/bin/derper"
  if [ ! -x "$cache" ]; then
    say "extracting derper from ${DERPER_IMAGE:-gogost/derper}"
    command -v docker >/dev/null 2>&1 || { echo "SKIP: no \$DERPER_BIN and no docker"; exit 0; }
    mkdir -p "$W/derper-root"
    name="wisper-tun-tun-smoke-derper-$$"
    docker create --name "$name" "${DERPER_IMAGE:-gogost/derper}" >/dev/null || { echo "docker create failed" >&2; exit 1; }
    docker export "$name" | tar -C "$W/derper-root" -xf -
    docker rm "$name" >/dev/null
  fi
  [ -x "$cache" ] || { echo "derper not found in the image" >&2; exit 1; }
  DERPER_BIN="$cache"
fi

DERP_DIR="$W/derper"
mkdir -p "$DERP_DIR/certs"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$DERP_DIR/certs/$BR_IP.key" -out "$DERP_DIR/certs/$BR_IP.crt" -days 3 \
  -subj "/CN=$BR_IP" -addext "subjectAltName=IP:$BR_IP" >/dev/null 2>&1 \
  || { echo "cert generation failed" >&2; exit 1; }
DERP_URL="wss://$BR_IP:$DERP_PORT/derp"

say "starting derper on $BR_IP:$DERP_PORT"
"$DERPER_BIN" -c "$DERP_DIR/derper.json" -hostname "$BR_IP" -certmode manual \
  -certdir "$DERP_DIR/certs" -a "$BR_IP:$DERP_PORT" -http-port -1 -stun=false \
  >"$DERP_DIR/derper.log" 2>&1 &
pids+=($!)

for _ in $(seq 1 50); do
  curl -sk --max-time 1 "https://$BR_IP:$DERP_PORT/" >/dev/null 2>&1 && break
  sleep 0.2
done
if curl -sk --max-time 2 "https://$BR_IP:$DERP_PORT/" >/dev/null 2>&1; then
  ok "derper is up on $BR_IP:$DERP_PORT"
else
  bad "derper did not start (see $DERP_DIR/derper.log)"
  exit $fail
fi

start_wisper() { # <ns> <config-dir> <api-addr>
  ip netns exec "$1" env XDG_CONFIG_HOME="$2" "$WISPER_BIN" -addr "$3" >"$2/wisper.log" 2>&1 &
  pids+=($!)
}

wait_api() { # <api-addr>
  for _ in $(seq 1 50); do
    curl -s --max-time 1 "http://$1/api/p2p" >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  return 1
}

pubkey() { # <api-addr>
  curl -s "http://$1/api/p2p" | sed -n 's/.*"public_key":"\([^"]*\)".*/\1/p'
}

say "starting the two peers ($A_API, $B_API)"
start_wisper "$NS_A" "$A_CFG" "$A_API"
start_wisper "$NS_B" "$B_CFG" "$B_API"

wait_api "$A_API" || { bad "peer A API did not come up"; exit $fail; }
wait_api "$B_API" || { bad "peer B API did not come up"; exit $fail; }
ok "both instances are up"

P2P_SETTINGS="{\"p2p\":{\"derp\":\"$DERP_URL\",\"secure\":false,\"direct\":false}}"
for api in "$A_API" "$B_API"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' \
    -d "$P2P_SETTINGS" "http://$api/api/config")
  [ "$code" = 200 ] || { bad "PUT /api/config on $api returned $code"; exit $fail; }
done
ok "both instances point at $DERP_URL (relay-only)"

A_KEY=$(pubkey "$A_API")
B_KEY=$(pubkey "$B_API")
[ -n "$A_KEY" ] && [ -n "$B_KEY" ] && [ "$A_KEY" != "$B_KEY" ] || { bad "identities missing or identical"; exit $fail; }
ok "identities exist and differ"

post() { # <api-addr> <path> <json>
  curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d "$3" "http://$1$2"
}

# --- the link ---------------------------------------------------------------

# Each side is a tun entrypoint peered at the other. No hub: the two dials
# rendezvous onto one shared edge, and each device is the link's far end.
say "A: a tun entrypoint peered at B"
code=$(post "$A_API" /api/entrypoints "{
  \"name\": \"ta\", \"type\": \"tun\", \"peer\": \"$B_KEY\",
  \"net\": \"$A_IP/32\", \"routes\": \"$B_IP/32\"
}")
[ "$code" = 201 ] || { bad "creating A's entrypoint returned $code"; exit $fail; }
ok "A device is up"

say "B: a tun entrypoint peered at A"
code=$(post "$B_API" /api/entrypoints "{
  \"name\": \"tb\", \"type\": \"tun\", \"peer\": \"$A_KEY\",
  \"net\": \"$B_IP/32\", \"routes\": \"$A_IP/32\"
}")
[ "$code" = 201 ] || { bad "creating B's entrypoint returned $code"; exit $fail; }
ok "B device is up"

ping_until() { # <ns> <dst> <checks>
  for _ in $(seq 1 "$3"); do
    ip netns exec "$1" ping -c 1 -W 2 "$2" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

# The first packet triggers the dial, the presentation and the rendezvous,
# so allow a few seconds.
if ping_until "$NS_A" "$B_IP" 20; then
  ok "A reaches B ($B_IP)"
else
  bad "A cannot reach B ($B_IP)"
fi

if ping_until "$NS_B" "$A_IP" 5; then
  ok "B reaches A ($A_IP)"
else
  bad "B cannot reach A ($A_IP)"
fi

# The peers sit in crossed network namespaces, so the reached pings below
# are already the proof that traffic crossed the device and the tunnel: no
# local route can answer a packet destined for the peer's address. (The
# entrypoint's own byte counters lag the stream and are not a reliable
# signal, so they are not asserted here.)

transport=$(curl -s "http://$A_API/api/entrypoints" | sed -n 's/.*"peer_transport":"\([^"]*\)".*/\1/p')
if [ -n "$transport" ]; then
  ok "A reports its peer's path ($transport)"
else
  bad "A's entrypoint carries no peer path: $(curl -s "http://$A_API/api/entrypoints")"
fi

# --- leaving and coming back ------------------------------------------------

B_ID=$(curl -s "http://$B_API/api/entrypoints" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "http://$B_API/api/entrypoints/$B_ID")
[ "$code" = 200 ] || { bad "deleting B's entrypoint returned $code"; }

sleep 5
if ping_until "$NS_A" "$B_IP" 5; then
  bad "A still reaches B after B left"
else
  ok "A lost B when B left"
fi

# B comes back on the same key; the rendezvous reforms and the link resumes.
if true; then :; fi
code=$(post "$B_API" /api/entrypoints "{
  \"name\": \"tb\", \"type\": \"tun\", \"peer\": \"$A_KEY\",
  \"net\": \"$B_IP/32\", \"routes\": \"$A_IP/32\"
}")
[ "$code" = 201 ] || { bad "re-creating B's entrypoint returned $code"; }

if ping_until "$NS_A" "$B_IP" 20; then
  ok "A reaches B again after B returned"
else
  bad "A cannot reach B after B returned"
fi

if ping_until "$NS_B" "$A_IP" 5; then
  ok "B reaches A after B returned"
else
  bad "B cannot reach A after B returned"
fi

if [ "$fail" != 0 ]; then
  say "A wisper log"; tail -n 40 "$A_CFG/wisper/logs/wisper.log" 2>/dev/null || tail -n 20 "$A_CFG/wisper.log"
  say "B wisper log"; tail -n 40 "$B_CFG/wisper/logs/wisper.log" 2>/dev/null || tail -n 20 "$B_CFG/wisper.log"
  say "derper log"; tail -n 20 "$DERP_DIR/derper.log"
fi

say "$pass passed, $fail failed (workdir $W)"
exit "$fail"
