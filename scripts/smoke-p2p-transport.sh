#!/usr/bin/env bash
# wisper p2p transport smoke: KCP (the default) and QUIC, over a local DERP.
#
# Why: the unit tests cover the config/API mapping, but a transport only proves
# itself when two real instances exchange a stream. QUIC is global and strict —
# both ends must opt in, there is no KCP fallback — so a wrong flag or a host
# that silently stays on KCP looks like a working tunnel until the first byte.
# This script builds wisper, starts a local derper, a hub (a p2p tunnel
# exposing an HTTP origin) and a spoke (a p2p entrypoint), then checks:
#
#   1. KCP (default): the pair carries a request, and an idle pair survives the
#      relay idle watchdog instead of being killed on its first tick.
#   2. QUIC: PUT /api/config transport=quic on both ends rebuilds the hosts, the
#      doctor reports transport quic, and the same request plus a larger
#      transfer succeed.
#   3. --strict: a mixed KCP/QUIC pair fails with no fallback, and both ends on
#      QUIC recover afterwards.
#
# Direct is off so every byte rides the relay — the path QUIC replaces. The
# relay is reached as wss://derper/derp with a self-signed certificate.
#
# Usage:
#   scripts/smoke-p2p-transport.sh [--keep] [--strict] [--idle SECONDS] [workdir]
#
#   --keep           keep the containers and workdir for inspection
#   --strict         also run the mixed-transport (no-fallback) check
#   --idle SECONDS   idle time for the KCP watchdog check (default 10)
#   workdir          default /tmp/wisper-p2p-transport-smoke
#
# Requires: docker, curl, jq, openssl, and a Go toolchain (or WISPER_BIN).
# Images: gogost/derper, node:22-alpine, alpine:3.22 (pulled when missing).
# The build uses the Go workspace found upward from wisper/ when there is one
# (so a checkout with ../p2p tests that p2p); set WISPER_GOWORK to a go.work
# path or "off" to override.
# Exit code = number of failed checks.

set -uo pipefail

W="/tmp/wisper-p2p-transport-smoke"
KEEP=0
STRICT=0
IDLE=10

die() { echo "$*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    --strict) STRICT=1; shift ;;
    --idle) [ $# -ge 2 ] || die "--idle needs a value"; IDLE=$2; shift 2 ;;
    -h|--help) sed -n '2,37p' "$0"; exit 0 ;;
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
if [ -z "${WISPER_BIN:-}" ]; then
  command -v go >/dev/null 2>&1 || { echo "SKIP: go not found (set WISPER_BIN)"; exit 0; }
fi

S="$$"
NET="wisper-p2p-smoke-$S"
DERPER="wq-derper-$S"
ORIGIN="wq-origin-$S"
HUB="wq-hub-$S"
SPOKE="wq-spoke-$S"
CONTAINERS=("$DERPER" "$ORIGIN" "$HUB" "$SPOKE")

need_image() {
  docker image inspect "$1" >/dev/null 2>&1 && return 0
  say "pulling $1"
  docker pull "$1" >/dev/null || die "cannot pull $1"
}

cleanup() {
  if [ "$KEEP" = 1 ]; then
    say "kept: ${CONTAINERS[*]} on $NET; workdir $W"
    return
  fi
  docker rm -f "${CONTAINERS[@]}" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
}
trap cleanup EXIT

mkdir -p "$W/derper/certs" "$W/hub/.config/wisper" "$W/spoke/.config/wisper"
chmod 777 "$W/derper"   # derper runs unprivileged and writes derper.json

if [ -n "${WISPER_BIN:-}" ]; then
  cp "$WISPER_BIN" "$W/wisper"
else
  say "building wisper"
  ( cd "$ROOT" && { [ -n "${WISPER_GOWORK:-}" ] && export GOWORK="$WISPER_GOWORK"; \
      CGO_ENABLED=0 go build -o "$W/wisper" .; } ) \
    || die "wisper build failed"
fi
chmod 755 "$W/wisper"

need_image gogost/derper:latest
need_image node:22-alpine
need_image alpine:3.22

docker network create "$NET" >/dev/null || die "cannot create network $NET"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$W/derper/certs/derper.key" -out "$W/derper/certs/derper.crt" -days 3 \
  -subj "/CN=derper" -addext "subjectAltName=DNS:derper" >/dev/null 2>&1 \
  || die "derper certificate generation failed"
chmod -R a+rX "$W/derper"

say "starting derper"
docker run -d --name "$DERPER" --network "$NET" --network-alias derper \
  -v "$W/derper:/conf" gogost/derper:latest \
  -c /conf/derper.json -hostname derper -certmode manual -certdir /conf/certs \
  -a :443 -http-port -1 -stun-port 3478 >/dev/null \
  || die "cannot start derper"
for _ in $(seq 1 100); do
  docker logs "$DERPER" 2>&1 | grep -q 'serving on' && break
  sleep 0.2
done
docker logs "$DERPER" 2>&1 | grep -q 'serving on' || die "derper did not start"

cat > "$W/origin.js" <<'JS'
const http = require('http');
const big = Buffer.alloc(16 * 1024 * 1024, 0x61);
http.createServer((req, res) => {
  if (req.url === '/big') {
    res.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Length': big.length});
    res.end(big);
    return;
  }
  res.end('ok');
}).listen(8080, '0.0.0.0');
JS
docker run -d --name "$ORIGIN" --network "$NET" --network-alias origin \
  -v "$W/origin.js:/srv/origin.js:ro" node:22-alpine node /srv/origin.js >/dev/null \
  || die "cannot start origin"

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

start_wisper() { # <container> <dir>
  docker run -d --name "$1" --network "$NET" -p 127.0.0.1::8900 \
    -v "$2:/lab" -v "$W/wisper:/lab/wisper:ro" -e HOME=/lab \
    --entrypoint /lab/wisper alpine:3.22 -addr :8900 >/dev/null
}
say "starting hub and spoke"
start_wisper "$HUB" "$W/hub" || die "cannot start hub"
start_wisper "$SPOKE" "$W/spoke" || die "cannot start spoke"

host_port() {
  local out
  out=$(docker port "$1" 8900/tcp) || return 1
  echo "${out##*:}"
}
HUB_API="http://127.0.0.1:$(host_port "$HUB")"
SPOKE_API="http://127.0.0.1:$(host_port "$SPOKE")"

wait_api() { # <base>
  for _ in $(seq 1 150); do
    curl -sf --max-time 1 "$1/api/version" >/dev/null && return 0
    sleep 0.2
  done
  return 1
}
wait_api "$HUB_API" && wait_api "$SPOKE_API" || die "wisper API did not come up"

HUB_KEY=$(curl -sf "$HUB_API/api/p2p" | jq -r '.public_key // empty')
SPOKE_KEY=$(curl -sf "$SPOKE_API/api/p2p" | jq -r '.public_key // empty')
[ -n "$HUB_KEY" ] && [ -n "$SPOKE_KEY" ] || die "cannot read p2p identities"

curl -sf -X POST "$HUB_API/api/tunnels" -H 'Content-Type: application/json' \
  -d "{\"name\":\"origin\",\"type\":\"p2p\",\"endpoint\":\"origin:8080\",\"peers\":[{\"key\":\"$SPOKE_KEY\",\"alias\":\"spoke\"}]}" \
  >/dev/null || die "cannot create the hub tunnel"
curl -sf -X POST "$SPOKE_API/api/entrypoints" -H 'Content-Type: application/json' \
  -d "{\"name\":\"entry\",\"type\":\"p2p\",\"endpoint\":\"127.0.0.1:18080\",\"peer\":\"$HUB_KEY\",\"protocol\":\"tcp\"}" \
  >/dev/null || die "cannot create the spoke entrypoint"

# probe sends one HTTP request from inside the spoke's network namespace, the
# way a local client would. Node is used because busybox wget half-closes and
# the p2p entrypoint does not support TCP half-close.
probe() { # <path> [timeout-ms]
  docker run --rm --network "container:$SPOKE" node:22-alpine -e '
    const http = require("http");
    const req = http.get("http://127.0.0.1:18080" + process.argv[1], r => {
      let n = 0;
      r.on("data", d => { n += d.length; });
      r.on("end", () => { console.log(r.statusCode, n); process.exit(r.statusCode === 200 ? 0 : 1); });
    });
    req.setTimeout(Number(process.argv[2]), () => { process.exit(2); });
    req.on("error", () => { process.exit(3); });
  ' "$1" "${2:-8000}" 2>/dev/null
}

wait_stream() { # <timeout-seconds>
  local end=$((SECONDS + $1))
  while [ $SECONDS -lt $end ]; do
    probe /healthz 3000 >/dev/null && return 0
    sleep 0.5
  done
  return 1
}

doctor_transport() {
  curl -sf --max-time 2 "$1/api/p2p/doctor" | sed -n 's/^transport:[[:space:]]*//p' | head -1
}
wait_transport() { # <base> <want>
  local end=$((SECONDS + 30))
  while [ $SECONDS -lt $end ]; do
    [ "$(doctor_transport "$1")" = "$2" ] && return 0
    sleep 0.5
  done
  return 1
}
put_p2p() { # <base> <transport>
  curl -s --max-time 60 -o /dev/null -w '%{http_code}' -X PUT "$1/api/config" \
    -H 'Content-Type: application/json' \
    -d "{\"p2p\":{\"derp\":\"wss://derper/derp\",\"secure\":false,\"direct\":false,\"transport\":\"$2\"}}"
}

say "KCP (default)"
# The first p2p session can trail the API by the entrypoint's retry backoff, so
# give the initial wiring plenty of room; later waits ride an established path.
if wait_stream 120; then ok "kcp: request reaches the origin"; else bad "kcp: request reaches the origin"; fi

say "KCP idle pair (${IDLE}s with no traffic)"
sleep "$IDLE"
silent=$(curl -sf "$HUB_API/api/logs" | jq -r '.lines[]' | grep -c 'relay path silent')
[ "$silent" = 0 ] \
  && ok "kcp: idle pair not killed by the relay watchdog" \
  || bad "kcp: idle pair not killed by the relay watchdog ($silent silent reports)"
peer=$(curl -sf "$HUB_API/api/tunnels" | jq -r '.[0].peer_stats[0].transport // empty')
case "$peer" in
  ""|server-unreachable) bad "kcp: peer connected after the idle window (transport=$peer)" ;;
  *) ok "kcp: peer connected after the idle window" ;;
esac
if wait_stream 10; then ok "kcp: request after the idle window"; else bad "kcp: request after the idle window"; fi

say "switching both ends to QUIC"
for api in "$HUB_API" "$SPOKE_API"; do
  code=$(put_p2p "$api" quic)
  [ "$code" = 200 ] || bad "quic: config accepted ($api, HTTP $code)"
done
wait_transport "$HUB_API" quic && ok "quic: hub reports transport quic" || bad "quic: hub reports transport quic"
wait_transport "$SPOKE_API" quic && ok "quic: spoke reports transport quic" || bad "quic: spoke reports transport quic"
if wait_stream 40; then ok "quic: request reaches the origin"; else bad "quic: request reaches the origin"; fi
out=$(probe /big 30000)
if [ $? = 0 ] && [ "${out##* }" = 16777216 ]; then
  ok "quic: 16 MiB transfer"
else
  bad "quic: 16 MiB transfer (got '$out')"
fi

if [ "$STRICT" = 1 ]; then
  say "--strict: mixed transports must not fall back"
  # The hub goes back to KCP while the spoke stays QUIC: the spoke must fail,
  # not fall back. The PUT rebuilds the host, so it can outlive curl's default.
  code=$(put_p2p "$HUB_API" kcp)
  [ "$code" = 200 ] || bad "strict: hub rebuilt on kcp (HTTP $code)"
  wait_transport "$HUB_API" kcp || bad "strict: hub reports transport kcp"
  if probe /healthz 6000 >/dev/null; then
    bad "strict: mixed pair refused the stream"
  else
    ok "strict: mixed pair refused the stream"
  fi
  say "restoring QUIC"
  put_p2p "$HUB_API" quic >/dev/null
  wait_transport "$HUB_API" quic && ok "strict: hub back on quic" || bad "strict: hub back on quic"
  if wait_stream 40; then ok "strict: stream recovered"; else bad "strict: stream recovered"; fi
fi

echo
echo "$pass passed, $fail failed"
exit "$fail"
