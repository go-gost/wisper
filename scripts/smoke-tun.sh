#!/usr/bin/env bash
# wisper tun smoke: a wisper tun hub and two wisper tun spokes, pinged across
# the devices.
#
# Why: the unit tests stop at the metadata the spoke describes — the device
# itself needs /dev/net/tun and CAP_NET_ADMIN, so nothing in `go test` can prove
# the data path. This script starts a real relay, the hub (a wisper `tun` tunnel:
# it creates the device and routes its allowlisted spokes' datagrams over p2p)
# and the spokes (wisper tun entrypoints), then pings across the devices in both
# directions.
#
# The hub was once NOT a wisper type: gost held the device and a paired `p2p`
# tunnel bridged the spokes to gost's UDP port, so a hub was a hand-written YAML
# file plus a bind address that tunnel had to repeat. It is a wisper type now
# (`tunnel/tun.go`): the hub creates its own device and its spokes' datagrams
# arrive on the process-wide p2p host, so there is no gost, no UDP socket, no
# endpoint and no paired tunnel — the peer allowlist is the whole configuration.
# This script therefore starts the hub the way it starts a spoke: a wisper
# process, with the device address moved from the old gost YAML onto the hub's
# tun tunnel.
#
# The devices live in ONE network namespace, which is why each side uses a
# /32 address plus an explicit host route to the peer: two devices claiming the
# same /24 would leave the kernel to pick one of them at random.
#
# Usage:
#   scripts/smoke-tun.sh [workdir]
# Requires: root + CAP_NET_ADMIN + /dev/net/tun, openssl, ping, curl, and either
# $DERPER_BIN or docker (to extract the relay from gogost/derper).
# Exit code = number of failed checks; 0 with SKIP when unprivileged.

set -uo pipefail

W="${1:-/tmp/wisper-tun-smoke}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/go/bin:$PATH"

DERP_PORT="${DERP_PORT:-8443}"
HUB_API="${HUB_API:-127.0.0.1:8901}"
SPOKE_API="${SPOKE_API:-127.0.0.1:8902}"
SPOKE2_API="${SPOKE2_API:-127.0.0.1:8903}"
HUB_IP=10.10.0.1
SPOKE_IP=10.10.0.2
SPOKE2_IP=10.10.0.3

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
HUB_CFG="$W/hub"; SPOKE_CFG="$W/spoke"; SPOKE2_CFG="$W/spoke2"
rm -rf "$HUB_CFG" "$SPOKE_CFG" "$SPOKE2_CFG"
mkdir -p "$HUB_CFG" "$SPOKE_CFG" "$SPOKE2_CFG"

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

say "starting the hub ($HUB_API) and the two spokes ($SPOKE_API, $SPOKE2_API)"
start_wisper "$HUB_CFG" "$HUB_API"
start_wisper "$SPOKE_CFG" "$SPOKE_API"
start_wisper "$SPOKE2_CFG" "$SPOKE2_API"

wait_api "$HUB_API" || { bad "hub API did not come up"; exit $fail; }
wait_api "$SPOKE_API" || { bad "spoke API did not come up"; exit $fail; }
wait_api "$SPOKE2_API" || { bad "spoke2 API did not come up"; exit $fail; }
ok "all three instances are up"

# The relay must be configured before the first p2p tunnel starts: the shared
# host is built lazily from the settings at that moment.
P2P_SETTINGS="{\"p2p\":{\"derp\":\"$DERP_URL\",\"secure\":false,\"direct\":false}}"
for api in "$HUB_API" "$SPOKE_API" "$SPOKE2_API"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' \
    -d "$P2P_SETTINGS" "http://$api/api/config")
  [ "$code" = 200 ] || { bad "PUT /api/config on $api returned $code"; exit $fail; }
done
ok "all three instances point at $DERP_URL (relay-only)"

HUB_KEY=$(pubkey "$HUB_API")
SPOKE_KEY=$(pubkey "$SPOKE_API")
SPOKE2_KEY=$(pubkey "$SPOKE2_API")
if [ -n "$HUB_KEY" ] && [ -n "$SPOKE_KEY" ] && [ -n "$SPOKE2_KEY" ] \
  && [ "$HUB_KEY" != "$SPOKE_KEY" ] && [ "$HUB_KEY" != "$SPOKE2_KEY" ] \
  && [ "$SPOKE_KEY" != "$SPOKE2_KEY" ]; then
  ok "all identities exist and differ"
else
  bad "identities are missing or identical (hub=$HUB_KEY spoke=$SPOKE_KEY spoke2=$SPOKE2_KEY)"
  exit $fail
fi

post() { # <api-addr> <path> <json>
  curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d "$3" "http://$1$2"
}

# --- the network ------------------------------------------------------------

# The hub is a wisper `tun` tunnel: it creates the device itself and its
# allowlist is the admission, so no endpoint and no paired p2p tunnel is
# involved. `net`/`routes`/`mtu` are the device configuration the old gost YAML
# carried. An endpoint is rejected (400) rather than ignored — proving the hub
# really took the in-process form.
say "hub: a tun tunnel whose device it creates itself"
code=$(post "$HUB_API" /api/tunnels "{
  \"name\": \"hub\", \"type\": \"tun\", \"endpoint\": \"127.0.0.1:8421\",
  \"net\": \"$HUB_IP/32\", \"peers\": [{\"key\": \"$SPOKE_KEY\"}]
}")
[ "$code" = 400 ] || { bad "a tun hub with an endpoint returned $code, want 400"; }

code=$(post "$HUB_API" /api/tunnels "{
  \"name\": \"hub\", \"type\": \"tun\", \"net\": \"$HUB_IP/32\", \"mtu\": 1420,
  \"routes\": \"$SPOKE_IP/32,$SPOKE2_IP/32\", \"peers\": [
    {\"key\": \"$SPOKE_KEY\", \"alias\": \"spoke\"},
    {\"key\": \"$SPOKE2_KEY\", \"alias\": \"spoke2\"}
  ]
}")
[ "$code" = 201 ] || { bad "creating the hub's tun tunnel returned $code, want 201"; exit $fail; }
ok "hub device is up at $HUB_IP/32, both spokes allowlisted"

say "spoke: a device with keepalive:true that joins the network"
code=$(post "$SPOKE_API" /api/entrypoints "{
  \"name\": \"spoke\", \"type\": \"tun\", \"peer\": \"$HUB_KEY\",
  \"net\": \"$SPOKE_IP/32\", \"routes\": \"$HUB_IP/32\",
  \"keepalive\": true, \"ttl\": 15
}")
[ "$code" = 201 ] || { bad "creating the spoke's tun entrypoint returned $code"; exit $fail; }
ok "spoke device is up"

# A spoke with keepalive:false sends the one-shot registration and then no
# keepalive at all. The hub must hold that session on its own: the hub has no TTL
# (a p2p peer announces its departure by closing its stream), so nothing expires
# it. This is the case that catches a hub which registered the route but never
# answered the registration.
say "spoke2: the same device with keepalive:false"
code=$(post "$SPOKE2_API" /api/entrypoints "{
  \"name\": \"spoke2\", \"type\": \"tun\", \"peer\": \"$HUB_KEY\",
  \"net\": \"$SPOKE2_IP/32\", \"routes\": \"$HUB_IP/32\",
  \"keepalive\": false
}")
[ "$code" = 201 ] || { bad "creating the second spoke's tun entrypoint returned $code"; exit $fail; }
ok "spoke2 device is up"

# --- the hub's allowlist, edited on its own ----------------------------------

# A hub's spokes are managed on its peers page, the way a p2p tunnel's peers
# are: PUT /api/tunnels/{id}/peers, applied in place. It must not disturb the
# device or the spoke that is already talking over it — that is the whole
# reason a hub reconciles its routes instead of being rebuilt.
say "the hub's spoke list, saved in place"
HUB_ID=$(curl -s "http://$HUB_API/api/tunnels" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' \
  -d "{\"peers\": [{\"key\": \"$SPOKE_KEY\", \"alias\": \"spoke\"}, {\"key\": \"$SPOKE2_KEY\", \"alias\": \"spoke2\"}]}" \
  "http://$HUB_API/api/tunnels/$HUB_ID/peers")
[ "$code" = 200 ] || { bad "saving the hub's spokes returned $code, want 200"; }
ok "the hub's spokes save on their own, like a p2p tunnel's peers"

# --- traffic ----------------------------------------------------------------

# The first packet triggers the dial, the registration and the route lookup, so
# allow a few seconds before judging.
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

# The datagrams crossed the hub's p2p route, so its counters must have moved — a
# ping that "works" while the route is idle would mean the kernel answered
# locally instead of the traffic crossing the network.
if curl -s "http://$HUB_API/api/tunnels" | grep -q '"output_bytes":[1-9]'; then
  ok "the hub's tun tunnel carried the traffic"
else
  bad "the hub's tun tunnel counted nothing: $(curl -s "http://$HUB_API/api/tunnels")"
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

# --- the second spoke, and its leaving --------------------------------------

# spoke2's route must have been registered by its one-shot registration and
# answered: keepalive:false means no keepalive to refresh it, so the hub either
# answered (the route lives as long as the stream) or dropped the packet.
if ping_until "$SPOKE2_IP" 20; then
  ok "hub reaches the keepalive:false spoke ($SPOKE2_IP)"
else
  bad "hub cannot reach the keepalive:false spoke ($SPOKE2_IP)"
fi

if ping_until "$HUB_IP" 5; then
  ok "the keepalive:false spoke still reaches the hub ($HUB_IP)"
else
  bad "the keepalive:false spoke cannot reach the hub ($HUB_IP)"
fi

# Its session must be held by the hub, not by a keepalive the spoke stopped
# sending: current_conns on the hub's allowlist row is the stream itself. The
# rows are split on the object's closing brace first — one sed over the whole
# array would match the *last* current_conns in it, another peer's.
spoke2_conns=$(curl -s "http://$HUB_API/api/tunnels" | tr '}' '\n' \
  | grep -F "\"key\":\"$SPOKE2_KEY\"" \
  | sed -n 's/.*"current_conns":\([0-9]*\).*/\1/p')
if [ -n "$spoke2_conns" ] && [ "$spoke2_conns" -ge 1 ] 2>/dev/null; then
  ok "the hub holds a session with the keepalive:false spoke ($spoke2_conns)"
else
  bad "the hub holds no session with the keepalive:false spoke (current_conns=${spoke2_conns:-missing})"
fi

SPOKE2_ID=$(curl -s "http://$SPOKE2_API/api/entrypoints" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "http://$SPOKE2_API/api/entrypoints/$SPOKE2_ID")
[ "$code" = 200 ] || { bad "deleting the second spoke's entrypoint returned $code"; }

# The hub learns of the departure from the closed stream, not from a timer, so
# give the teardown a moment before asking whether its routes are gone.
sleep 5
if ping -c 1 -W 2 "$SPOKE2_IP" >/dev/null 2>&1; then
  bad "the hub still reaches $SPOKE2_IP after spoke2 left"
else
  ok "the hub's route to spoke2 is reclaimed after it left"
fi

if ping_until "$SPOKE_IP" 5 && ping_until "$HUB_IP" 5; then
  ok "spoke1's routes survived spoke2 leaving"
else
  bad "spoke1's link broke when spoke2 left"
fi

# --- a device that cannot be created ----------------------------------------

# An invalid device name fails creation even as root, which is what makes this
# reproducible: the disk is the interesting part — x's tun listener retries
# every second, so a discarded entrypoint used to log one line per second
# forever. Run fails and closes the listener, so exactly the first line lands.
#
# The create answers 201 either way: an entrypoint is listed before it starts
# (4751131), so a start that cannot complete is left visible — stopped, with the
# failure on it — rather than answered as an error. What has to be true is that
# the failure is reported on the object, not swallowed into a silent 201.
say "a tun entrypoint whose device cannot be created"
code=$(post "$SPOKE_API" /api/entrypoints "{
  \"name\": \"tun-bad\", \"type\": \"tun\", \"peer\": \"$HUB_KEY\",
  \"net\": \"10.10.0.99/32\", \"device_name\": \"not/a/device/name\"
}")
[ "$code" = 201 ] || { bad "creating an entrypoint with an invalid device name returned $code, want 201"; }

bad_state=$(curl -s "http://$SPOKE_API/api/entrypoints" | tr '}' '\n' \
  | grep -F '"name":"tun-bad"' \
  | sed -n 's/.*"status":"\([^"]*\)".*"error":"\([^"]*\)".*/\1 \2/p')
case "$bad_state" in
  "running "*) bad "tun-bad reports running after its device failed: $bad_state" ;;
  stopped*)    ok "tun-bad is listed as stopped with its failure: $bad_state" ;;
  *)           bad "tun-bad carries no stopped-with-error state: ${bad_state:-missing}" ;;
esac

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
  say "spoke2 log"; tail -n 40 "$SPOKE2_CFG/wisper/logs/wisper.log" 2>/dev/null || tail -n 20 "$SPOKE2_CFG/wisper.log"
  say "derper log"; tail -n 20 "$DERP_DIR/derper.log"
fi

say "$pass passed, $fail failed (workdir $W)"
exit "$fail"
