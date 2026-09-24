#!/usr/bin/env bash
# wisper tun smoke: a gost tun server as the hub, a wisper p2p tunnel as its
# outlet, and a wisper tun entrypoint as a spoke — pinged across the devices.
#
# Why: the unit tests stop at the metadata the spoke describes — the device
# itself needs /dev/net/tun and CAP_NET_ADMIN, so nothing in `go test` can prove
# the data path. This script starts a real relay, the hub (gost holds the
# device; wisper routes the spokes to it) and a spoke (a wisper tun entrypoint),
# then pings across the devices in both directions.
#
# The hub is deliberately NOT a wisper type: gost owns the device (so the wisper
# process on the hub needs no privileges), and the existing p2p tunnel type
# carries the spokes — its peer allowlist is the admission, in front of the tun
# server's UDP port.
#
# The two devices live in ONE network namespace, which is why each side uses a
# /32 address plus an explicit host route to the peer: two devices claiming the
# same /24 would leave the kernel to pick one of them at random.
#
# Usage:
#   scripts/smoke-tun.sh [workdir]
# Requires: root + CAP_NET_ADMIN + /dev/net/tun, openssl, ping, curl, a gost
# checkout next to this repo (or $GOST_BIN), and either $DERPER_BIN or docker
# (to extract the relay from gogost/derper).
# Exit code = number of failed checks; 0 with SKIP when unprivileged.

set -uo pipefail

W="${1:-/tmp/wisper-tun-smoke}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/go/bin:$PATH"

DERP_PORT="${DERP_PORT:-8443}"
TUN_ADDR="${TUN_ADDR:-127.0.0.1:8421}"
HUB_API="${HUB_API:-127.0.0.1:8901}"
SPOKE_API="${SPOKE_API:-127.0.0.1:8902}"
HUB_IP=10.10.0.1
SPOKE_IP=10.10.0.2

pass=0; fail=0
ok()  { echo "PASS $1"; pass=$((pass + 1)); }
bad() { echo "FAIL $1"; fail=$((fail + 1)); }
say() { echo "== $*"; }

# --- preconditions ----------------------------------------------------------

if [ "$(id -u)" != 0 ]; then
  echo "SKIP: root is required to create a tun device"
  exit 0
fi
if [ ! -c /dev/net/tun ]; then
  echo "SKIP: /dev/net/tun is not available"
  exit 0
fi
for c in curl openssl ping; do
  command -v "$c" >/dev/null 2>&1 || { echo "SKIP: $c not found"; exit 0; }
done

mkdir -p "$W"
HUB_CFG="$W/hub"; SPOKE_CFG="$W/spoke"; HUB_DIR="$W/hub-gost"
rm -rf "$HUB_CFG" "$SPOKE_CFG" "$HUB_DIR"
mkdir -p "$HUB_CFG" "$SPOKE_CFG" "$HUB_DIR"

pids=()
cleanup() {
  for p in "${pids[@]:-}"; do
    [ -n "$p" ] && kill "$p" 2>/dev/null
  done
  wait 2>/dev/null
}
trap cleanup EXIT

# --- binaries ---------------------------------------------------------------

WISPER_BIN="${WISPER_BIN:-}"
if [ -z "$WISPER_BIN" ]; then
  say "building wisper"
  (cd "$ROOT" && CGO_ENABLED=0 go build -o "$W/wisper" .) || { echo "build failed" >&2; exit 1; }
  WISPER_BIN="$W/wisper"
fi

GOST_BIN="${GOST_BIN:-}"
if [ -z "$GOST_BIN" ]; then
  say "building gost (the hub's device)"
  (cd "$ROOT/../gost" && CGO_ENABLED=0 go build -o "$W/gost" ./cmd/gost/...) \
    || { echo "gost build failed (set \$GOST_BIN to skip)" >&2; exit 1; }
  GOST_BIN="$W/gost"
fi

DERPER_BIN="${DERPER_BIN:-}"
if [ -z "$DERPER_BIN" ]; then
  cache="$W/derper-root/usr/local/bin/derper"
  if [ ! -x "$cache" ]; then
    say "extracting derper from ${DERPER_IMAGE:-gogost/derper}"
    command -v docker >/dev/null 2>&1 || { echo "SKIP: no \$DERPER_BIN and no docker"; exit 0; }
    mkdir -p "$W/derper-root"
    name="wisper-tun-smoke-derper-$$"
    docker create --name "$name" "${DERPER_IMAGE:-gogost/derper}" >/dev/null || { echo "docker create failed" >&2; exit 1; }
    docker export "$name" | tar -C "$W/derper-root" -xf -
    docker rm "$name" >/dev/null
  fi
  [ -x "$cache" ] || { echo "derper not found in the image" >&2; exit 1; }
  DERPER_BIN="$cache"
fi

# --- relay ------------------------------------------------------------------

DERP_DIR="$W/derper"
mkdir -p "$DERP_DIR/certs"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$DERP_DIR/certs/127.0.0.1.key" -out "$DERP_DIR/certs/127.0.0.1.crt" -days 3 \
  -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" >/dev/null 2>&1 \
  || { echo "cert generation failed" >&2; exit 1; }
DERP_URL="wss://127.0.0.1:$DERP_PORT/derp"

say "starting derper on $DERP_PORT"
"$DERPER_BIN" -c "$DERP_DIR/derper.json" -hostname 127.0.0.1 -certmode manual \
  -certdir "$DERP_DIR/certs" -a "127.0.0.1:$DERP_PORT" -http-port -1 -stun=false \
  >"$DERP_DIR/derper.log" 2>&1 &
pids+=($!)

for _ in $(seq 1 50); do
  curl -sk --max-time 1 "https://127.0.0.1:$DERP_PORT/" >/dev/null 2>&1 && break
  sleep 0.2
done
if curl -sk --max-time 2 "https://127.0.0.1:$DERP_PORT/" >/dev/null 2>&1; then
  ok "derper is up on $DERP_PORT"
else
  bad "derper did not start (see $DERP_DIR/derper.log)"
  exit $fail
fi

# --- the hub: gost holds the device ----------------------------------------

cat >"$HUB_DIR/gost.yml" <<YAML
services:
  - name: tun-server
    addr: $TUN_ADDR
    handler:
      type: tun          # no chain and no forwarder: server mode
      metadata:
        keepalive: true  # expire the route of a spoke that left (3x ttl)
        ttl: 10s
    listener:
      type: tun
      metadata:
        name: whis-hub
        net: $HUB_IP/32
        route: $SPOKE_IP/32
        mtu: 1420
log:
  level: info
YAML

say "starting gost tun server on $TUN_ADDR"
"$GOST_BIN" -C "$HUB_DIR/gost.yml" >"$HUB_DIR/gost.log" 2>&1 &
pids+=($!)

# --- instances --------------------------------------------------------------

start_wisper() { # <config-dir> <api-addr>
  XDG_CONFIG_HOME="$1" "$WISPER_BIN" -addr "$2" >"$1/wisper.log" 2>&1 &
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

say "starting the hub's wisper ($HUB_API) and the spoke ($SPOKE_API)"
start_wisper "$HUB_CFG" "$HUB_API"
start_wisper "$SPOKE_CFG" "$SPOKE_API"

wait_api "$HUB_API" || { bad "hub API did not come up"; exit $fail; }
wait_api "$SPOKE_API" || { bad "spoke API did not come up"; exit $fail; }
ok "both instances are up"

# The relay must be configured before the first p2p tunnel starts: the shared
# host is built lazily from the settings at that moment.
P2P_SETTINGS="{\"p2p\":{\"derp\":\"$DERP_URL\",\"secure\":false,\"direct\":false}}"
for api in "$HUB_API" "$SPOKE_API"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' \
    -d "$P2P_SETTINGS" "http://$api/api/config")
  [ "$code" = 200 ] || { bad "PUT /api/config on $api returned $code"; exit $fail; }
done
ok "both instances point at $DERP_URL (relay-only)"

HUB_KEY=$(pubkey "$HUB_API")
SPOKE_KEY=$(pubkey "$SPOKE_API")
if [ -n "$HUB_KEY" ] && [ -n "$SPOKE_KEY" ] && [ "$HUB_KEY" != "$SPOKE_KEY" ]; then
  ok "both identities exist"
else
  bad "identities are missing or identical (hub=$HUB_KEY spoke=$SPOKE_KEY)"
  exit $fail
fi

post() { # <api-addr> <path> <json>
  curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d "$3" "http://$1$2"
}

# --- the network ------------------------------------------------------------

# The hub's outlet is a plain p2p tunnel: every inbound datagram stream from an
# allowlisted key is bridged to the tun server's UDP port, and an unlisted key
# is refused before any dial happens.
say "hub: a p2p tunnel whose target is the tun server"
code=$(post "$HUB_API" /api/tunnels "{
  \"name\": \"hub-spokes\", \"type\": \"p2p\", \"endpoint\": \"$TUN_ADDR\",
  \"peers\": [{\"key\": \"$SPOKE_KEY\"}]
}")
[ "$code" = 201 ] || { bad "creating the hub's p2p tunnel returned $code"; exit $fail; }
ok "hub is routing allowlisted peers to $TUN_ADDR"

say "spoke: a device that joins the network"
code=$(post "$SPOKE_API" /api/entrypoints "{
  \"name\": \"spoke\", \"type\": \"tun\", \"peer\": \"$HUB_KEY\",
  \"net\": \"$SPOKE_IP/32\", \"routes\": \"$HUB_IP/32\",
  \"keepalive\": true, \"ttl\": 15
}")
[ "$code" = 201 ] || { bad "creating the spoke's tun entrypoint returned $code"; exit $fail; }
ok "spoke device is up"

# --- traffic ----------------------------------------------------------------

# The first packet triggers the dial, the presentation and the route
# registration, so allow a few seconds before judging.
ping_until() { # <dst> <checks>
  for _ in $(seq 1 "$2"); do
    ping -c 1 -W 2 "$1" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

if ping_until "$SPOKE_IP" 20; then
  ok "hub reaches the spoke ($SPOKE_IP)"
else
  bad "hub cannot reach the spoke ($SPOKE_IP)"
fi

if ping_until "$HUB_IP" 20; then
  ok "spoke reaches the hub ($HUB_IP)"
else
  bad "spoke cannot reach the hub ($HUB_IP)"
fi

# The datagrams crossed the p2p tunnel, so its counters must have moved — a ping
# that "works" while the tunnel is idle would mean the kernel answered locally
# instead of the traffic crossing the network.
if curl -s "http://$HUB_API/api/tunnels" | grep -q '"output_bytes":[1-9]'; then
  ok "the hub's p2p tunnel carried the traffic"
else
  bad "the hub's p2p tunnel counted nothing: $(curl -s "http://$HUB_API/api/tunnels")"
fi

# The spoke's path to the hub is what the UI badges, so the response has to
# carry it — a tun entrypoint is a peer link like a p2p one. "disabled" is p2p's
# wording for the direct path being switched off, which is what this run does.
transport=$(curl -s "http://$SPOKE_API/api/entrypoints" | sed -n 's/.*"peer_transport":"\([^"]*\)".*/\1/p')
if [ -n "$transport" ]; then
  ok "the spoke reports its peer's path ($transport)"
else
  bad "the spoke's entrypoint carries no peer path: $(curl -s "http://$SPOKE_API/api/entrypoints")"
fi

# --- a device that cannot be created ----------------------------------------

# An invalid device name fails creation even as root, which is what makes this
# reproducible: the disk is the interesting part — x's tun listener retries
# every second, so a discarded entrypoint used to log one line per second
# forever. Run fails and closes the listener, so exactly the first line lands.
say "a tun entrypoint whose device cannot be created"
code=$(post "$SPOKE_API" /api/entrypoints "{
  \"name\": \"tun-bad\", \"type\": \"tun\", \"peer\": \"$HUB_KEY\",
  \"net\": \"10.10.0.99/32\", \"device_name\": \"not/a/device/name\"
}")
[ "$code" = 500 ] || { bad "creating an entrypoint with an invalid device name returned $code, want 500"; }

sleep 5
attempts=$(grep -c '"service":"tun-bad"' "$SPOKE_CFG/wisper/logs/wisper.log" 2>/dev/null || true)
if [ "$attempts" = 1 ]; then
  ok "the failed device was attempted once, not retried forever"
else
  bad "the failed device was logged $attempts times in 5s, want 1"
fi

if [ "$fail" != 0 ]; then
  # wisper logs under its config dir, not on stdout (the redirect only catches
  # a start-up failure).
  say "hub wisper log"; tail -n 40 "$HUB_CFG/wisper/logs/wisper.log" 2>/dev/null || tail -n 20 "$HUB_CFG/wisper.log"
  say "spoke log"; tail -n 40 "$SPOKE_CFG/wisper/logs/wisper.log" 2>/dev/null || tail -n 20 "$SPOKE_CFG/wisper.log"
  say "gost log"; tail -n 20 "$HUB_DIR/gost.log"
  say "derper log"; tail -n 20 "$DERP_DIR/derper.log"
fi

say "$pass passed, $fail failed (workdir $W)"
exit "$fail"
