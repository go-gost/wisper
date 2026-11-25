#!/usr/bin/env bash
# Does a peer that restarts reconnect fast, or does it spend a handshake
# deadline per attempt?
#
# Why this exists as its own harness: the behaviour depends on a real derper's
# routing table going stale for a key that re-registers, which nothing in the
# unit suite reproduces (its relayServer is in-process and keeps no such state).
# The symptom is a phone whose tunnel takes 20-35s to come up on every cold
# start while a hot restart takes under a second, and the only way to see it is
# a real relay plus a peer that actually stops and starts under the same key.
#
# What it does: builds wisper from the workspace (so ../p2p changes are in), runs
# a derper and two wisper instances, then repeatedly kills the spoke container
# and starts it again with the same identity, timing how long the peer pair takes
# to carry a request after each restart. The first start is a control (there is
# no stale route yet); the restarts are the case under test.
#
# Usage: scripts/smoke-p2p-restart.sh [--keep] [--rounds N] [workdir]
# Exit code = number of failed checks.

set -uo pipefail

W="/tmp/wisper-p2p-restart-smoke"
KEEP=0
ROUNDS=4
PAUSE=3

die() { echo "$*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    --rounds) [ $# -ge 2 ] || die "--rounds needs a value"; ROUNDS=$2; shift 2 ;;
    --pause) [ $# -ge 2 ] || die "--pause needs a value"; PAUSE=$2; shift 2 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    -*) die "unknown argument: $1" ;;
    *) W=$1; shift ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/go/bin:$PATH"

pass=0; fail=0
ok()  { echo "PASS $1"; pass=$((pass + 1)); }
bad() { echo "FAIL $1"; fail=$((fail + 1)); }
say() { echo "== $*"; }

for c in docker curl jq openssl; do
  command -v "$c" >/dev/null 2>&1 || { echo "SKIP: $c not found"; exit 0; }
done
command -v go >/dev/null 2>&1 || { echo "SKIP: go not found"; exit 0; }

S="$$"
NET="wisper-restart-smoke-$S"
DERPER="wr-derper-$S"
HUB="wr-hub-$S"
SPOKE="wr-spoke-$S"

cleanup() {
  if [ "$KEEP" = 1 ]; then
    say "kept: derper/hub/spoke on $NET; workdir $W"
    return
  fi
  docker rm -f "$DERPER" "$HUB" "$SPOKE" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
}
trap cleanup EXIT

mkdir -p "$W/derper/certs" "$W/hub/.config/wisper" "$W/spoke/.config/wisper"
chmod 777 "$W/derper"

# P2P_DIR pins the build to a specific p2p checkout, which is how a fix is
# compared against the release it replaces: a workspace build uses ../p2p, and
# swapping that directory is the only way to run the same scenario on both.
say "building wisper${P2P_DIR:+ with p2p from $P2P_DIR}"
if [ -n "${P2P_DIR:-}" ]; then
  (
    cd "$ROOT" || exit 1
    go mod edit -replace "github.com/go-gost/p2p=$P2P_DIR"
    trap 'go mod edit -dropreplace github.com/go-gost/p2p' EXIT
    GOWORK=off CGO_ENABLED=0 go build -o "$W/wisper" .
  ) || die "wisper build failed"
else
  ( cd "$ROOT" && CGO_ENABLED=0 go build -o "$W/wisper" . ) || die "wisper build failed"
fi
chmod 755 "$W/wisper"

for img in gogost/derper:latest alpine:3.22 node:22-alpine; do
  docker image inspect "$img" >/dev/null 2>&1 || docker pull "$img" >/dev/null \
    || die "cannot get $img"
done

docker network create "$NET" >/dev/null || die "cannot create $NET"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$W/derper/certs/derper.key" -out "$W/derper/certs/derper.crt" -days 3 \
  -subj "/CN=derper" -addext "subjectAltName=DNS:derper" >/dev/null 2>&1 \
  || die "cert generation failed"
chmod -R a+rX "$W/derper"

say "starting derper"
docker run -d --name "$DERPER" --network "$NET" --network-alias derper \
  -v "$W/derper:/conf" gogost/derper:latest \
  -c /conf/derper.json -hostname derper -certmode manual -certdir /conf/certs \
  -a :443 -http-port -1 -stun-port 3478 >/dev/null || die "cannot start derper"
for _ in $(seq 1 100); do
  docker logs "$DERPER" 2>&1 | grep -q 'serving on' && break
  sleep 0.2
done

cat > "$W/origin.js" <<'JS'
const http = require('http');
http.createServer((req, res) => res.end('ok')).listen(8080, '0.0.0.0');
JS
ORIGIN="wr-origin-$S"
docker run -d --name "$ORIGIN" --network "$NET" --network-alias origin \
  -v "$W/origin.js:/srv/origin.js:ro" node:22-alpine node /srv/origin.js >/dev/null \
  || die "cannot start origin"
trap 'docker rm -f "$ORIGIN" >/dev/null 2>&1; cleanup' EXIT

for d in hub spoke; do
  cat > "$W/$d/.config/wisper/wisper.yaml" <<'YAML'
settings:
  lang: en
  p2p:
    derp: wss://derper/derp
    secure: false
    direct: false
YAML
done

start_wisper() { # <container> <dir> [--replace]
  local args=()
  [ "${3:-}" = "--replace" ] && args=(--name "$1")
  docker run -d "${args[@]}" --name "$1" --network "$NET" -p 127.0.0.1::8900 \
    -v "$2:/lab" -v "$W/wisper:/lab/wisper:ro" -e HOME=/lab \
    --entrypoint /lab/wisper alpine:3.22 -addr :8900 \
    -log.level "${WISPER_LOG_LEVEL:-info}" >/dev/null
}

host_port() { local out; out=$(docker port "$1" 8900/tcp) || return 1; echo "${out##*:}"; }

wait_api() {
  for _ in $(seq 1 200); do
    curl -sf --max-time 1 "$1/api/version" >/dev/null && return 0
    sleep 0.2
  done
  return 1
}

say "starting hub and spoke"
docker rm -f "$HUB" "$SPOKE" >/dev/null 2>&1
start_wisper "$HUB" "$W/hub" || die "cannot start hub"
start_wisper "$SPOKE" "$W/spoke" || die "cannot start spoke"
HUB_API="http://127.0.0.1:$(host_port "$HUB")"
SPOKE_API="http://127.0.0.1:$(host_port "$SPOKE")"
wait_api "$HUB_API" && wait_api "$SPOKE_API" || die "wisper API did not come up"

HUB_KEY=$(curl -sf "$HUB_API/api/p2p" | jq -r '.public_key // empty')
SPOKE_KEY=$(curl -sf "$SPOKE_API/api/p2p" | jq -r '.public_key // empty')
[ -n "$HUB_KEY" ] && [ -n "$SPOKE_KEY" ] || die "cannot read p2p identities"

# QUIC is the transport the phone runs, and the one whose handshake this is
# about; KCP would mask the problem behind its own session rebuild.
for api in "$HUB_API" "$SPOKE_API"; do
  curl -sf -X PUT "$api/api/config" -H 'Content-Type: application/json' \
    -d '{"p2p":{"derp":"wss://derper/derp","secure":false,"direct":false,"transport":"quic"}}' \
    >/dev/null || die "cannot set quic on $api"
done
for _ in $(seq 1 100); do
  t=$(curl -sf "$HUB_API/api/p2p/doctor" 2>/dev/null | grep -c 'transport:.*quic')
  [ "$t" -ge 1 ] && break
  sleep 0.3
done

curl -sf -X POST "$HUB_API/api/tunnels" -H 'Content-Type: application/json' \
  -d "{\"name\":\"origin\",\"type\":\"p2p\",\"endpoint\":\"origin:8080\",\"peers\":[{\"key\":\"$SPOKE_KEY\",\"alias\":\"spoke\"}]}" \
  >/dev/null || die "cannot create the hub tunnel"
curl -sf -X POST "$SPOKE_API/api/entrypoints" -H 'Content-Type: application/json' \
  -d "{\"name\":\"entry\",\"type\":\"p2p\",\"endpoint\":\"127.0.0.1:18080\",\"peer\":\"$HUB_KEY\",\"protocol\":\"tcp\"}" \
  >/dev/null || die "cannot create the spoke entrypoint"

# probe carries one request from inside the spoke's netns, as a local client
# would. It is the only end-to-end proof: a healthy handshake shows up here.
probe() { # <container holding the client> <base-url-of-spoke>
  docker run --rm --network "container:$3" -v "$W/origin.js:/srv/probe.js:ro" \
    node:22-alpine node -e '
      const http = require("http");
      const req = http.get("http://127.0.0.1:18080/", {timeout: 20000}, r => {
        let n = 0; r.on("data", c => n += c.length);
        r.on("end", () => process.exit(r.statusCode === 200 ? 0 : 1));
      });
      req.on("timeout", () => process.exit(2));
      req.on("error", () => process.exit(3));
    ' 2>/dev/null
}

# time_to_pair waits until a request succeeds, and prints the seconds it took.
time_to_pair() { # <spoke-container> <deadline-seconds>
  local start now
  start=$(date +%s)
  while :; do
    if probe x x "$1"; then
      now=$(date +%s)
      echo $((now - start))
      return 0
    fi
    now=$(date +%s)
    [ $((now - start)) -ge "$2" ] && { echo "$2"; return 1; }
    sleep 1
  done
}

# Not a check: the first pair has no stale route to be slow on, and its own
# first-attempt cost (one failed handshake plus the blackhole cure) is a
# different defect. It is printed as context so a reader does not mistake it for
# this script's subject.
say "first pair (control: no stale route can exist yet)"
FIRST=$(time_to_pair "$SPOKE" 60) || die "the control start never paired; the harness is not measuring what it claims"
echo "     control start: ${FIRST}s (not asserted: a first handshake and its cure)"

# The case under test. Each round kills the spoke outright — the phone's app
# being killed, not a tunnel being toggled — and starts it again with the same
# identity, which is what leaves the derper holding a route to a dead
# connection.
for r in $(seq 1 "$ROUNDS"); do
  say "restart round $r"
  docker rm -f "$SPOKE" >/dev/null 2>&1
  sleep "$PAUSE"
  start_wisper "$SPOKE" "$W/spoke" || { bad "round $r: cannot start spoke"; continue; }
  SPOKE_API="http://127.0.0.1:$(host_port "$SPOKE")"
  wait_api "$SPOKE_API" || { bad "round $r: API did not come up"; continue; }
  # The entrypoint config survives the restart; make sure it is running.
  EP=$(curl -sf "$SPOKE_API/api/entrypoints" | jq -r '.[0].id // empty')
  if [ -n "$EP" ]; then
    st=$(curl -sf "$SPOKE_API/api/entrypoints" | jq -r '.[0].status')
    [ "$st" = running ] || curl -sf -X POST "$SPOKE_API/api/entrypoints/$EP/start" >/dev/null
  fi

  SECS=$(time_to_pair "$SPOKE" 60)
  if probe x x "$SPOKE"; then
    ok "round $r: repaired in ${SECS}s"
  else
    bad "round $r: never repaired within 60s"
  fi
  # A slow round is the interesting one and it is not reproducible on demand,
  # so the evidence is captured when it happens rather than by re-running with
  # --keep and hoping. Both sides' logs land in the workdir.
  if [ "$SECS" -ge 8 ]; then
    say "round $r took ${SECS}s: saving both sides' logs to $W"
    curl -sf "$SPOKE_API/api/logs?tail=2000" > "$W/slow-round$r-spoke.json" 2>/dev/null
    curl -sf "$HUB_API/api/logs?tail=2000" > "$W/slow-round$r-hub.json" 2>/dev/null
    curl -sf "$SPOKE_API/api/p2p/doctor" > "$W/slow-round$r-spoke.txt" 2>/dev/null
    curl -sf "$HUB_API/api/p2p/doctor" > "$W/slow-round$r-hub.txt" 2>/dev/null
  fi
  # 3s is the handshake budget a healthy pair needs (measured ~50ms); anything
  # near 10s means an attempt spent its whole deadline on a stale route.
  if [ "$SECS" -ge 8 ]; then
    bad "round $r: ${SECS}s is at least one full handshake deadline"
  fi
done

echo
echo "$pass passed, $fail failed"
exit "$fail"
