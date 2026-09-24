#!/usr/bin/env bash
# wisper UI e2e: Playwright drives the real Lit UI against a real wisper.
#
# Why: the Go suite covers the API and `make typecheck` covers types, but
# neither renders the page. An unclosed <div> in a Lit template silently nests
# every block after it — invisible to both, visible only as layout (the peers
# card came out 32px narrower than the card above it). Bounding-box assertions
# catch that; the screenshot the spec writes lets a human confirm it.
#
# Constraints baked in (this dev container):
#   * No chromium binary and none of its system libraries (libnss3, libgbm,
#     ...), and sudo needs a password, so `playwright install --with-deps`
#     cannot run here. The tests therefore run inside the official Playwright
#     image, which ships chromium plus every dependency, using the docker
#     daemon that runs in this container.
#   * Containers here have no egress (the bridge is blocked), so the runner is
#     installed on the host (web-e2e/node_modules) and mounted in — nothing is
#     downloaded inside the image.
#   * dockerd shares this container's network namespace, so a --network=host
#     browser reaches the wisper this script starts on 127.0.0.1.
#   * The image tag and the @playwright/test version in web-e2e/package.json
#     must stay equal (chromium speaks a versioned protocol).
#
# A dev instance usually holds the default port already, so the script walks up
# from 8900 to the first free one instead of clobbering it (pin one with
# WISPER_TEST_PORT when it matters).
#
# Usage:
#   scripts/ui-test.sh [playwright args...]     e.g. --headed, -g "peers"
# Requires: a Go toolchain, docker, and web-e2e/node_modules (`npm install`).
# Exit code = playwright's.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.63.0-noble}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/wisper-ui-test.XXXXXX")"
CFG_HOME="$WORK/home"
LOG="$WORK/wisper.log"
SERVER_PID=""

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

cleanup() {
	if [ -n "$SERVER_PID" ]; then
		kill "$SERVER_PID" 2>/dev/null
		wait "$SERVER_PID" 2>/dev/null
	fi
	rm -rf "$WORK"
}
trap cleanup EXIT

# ── preconditions ────────────────────────────────────────────────────────────

if [ ! -x "$ROOT/web-e2e/node_modules/.bin/playwright" ]; then
	echo "web-e2e/node_modules is missing (containers here cannot fetch it):" >&2
	echo "  (cd '$ROOT/web-e2e' && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install)" >&2
	exit 2
fi

# The binary embeds web/, so a stale bundle would be tested instead of the
# sources — the same trap `make web` guards against.
if [ ! -f "$ROOT/web/.build_stamp" ] ||
	[ -n "$(find "$ROOT/web-src/src" -type f -newer "$ROOT/web/.build_stamp" 2>/dev/null)" ]; then
	echo "web/ is older than web-src/src — run 'make web' first" >&2
	exit 2
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
	echo "playwright image not present locally:" >&2
	echo "  docker pull $IMAGE" >&2
	exit 2
fi

PORT=""
if [ -n "${WISPER_TEST_PORT:-}" ]; then
	PORT="$WISPER_TEST_PORT"
else
	for p in $(seq 8900 8920); do
		if ! port_busy "$p"; then
			PORT="$p"
			break
		fi
	done
fi
if [ -z "$PORT" ]; then
	echo "no free port in 8900-8920 (set WISPER_TEST_PORT)" >&2
	exit 2
fi
if port_busy "$PORT"; then
	echo "port $PORT is already in use" >&2
	exit 2
fi

# ── the server under test ────────────────────────────────────────────────────

mkdir -p "$CFG_HOME/.config/wisper"
cat >"$CFG_HOME/.config/wisper/wisper.yaml" <<'YAML'
# Fixture for web-e2e/tests: one p2p tunnel, two allowlisted peers, the second
# switched off. The relay address is unroutable on purpose — the host retries
# in the background and the tunnel still runs, which is all the UI needs.
settings:
  lang: en
  p2p:
    derp: wss://127.0.0.1:1/derp
    direct: false
tunnels:
  - id: e2e-p2p-tunnel
    name: Private
    type: p2p
    endpoint: 127.0.0.1:9
    peers:
      - dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA
      - sLWN_c1IDB50J7lu1xvbme_ZQHDtcpSdUZYs87ys-JY
    peer_aliases:
      dlDU8quxCanhD3AUC--KX3F1jhYoc-OjICF-Lez8FhA: laptop
      sLWN_c1IDB50J7lu1xvbme_ZQHDtcpSdUZYs87ys-JY: phone
    peer_disabled:
      - sLWN_c1IDB50J7lu1xvbme_ZQHDtcpSdUZYs87ys-JY
    created_at: 2026-01-15T10:30:00Z
YAML

if ! (cd "$ROOT" && go build -o "$WORK/wisper" .); then
	echo "wisper build failed" >&2
	exit 2
fi

HOME="$CFG_HOME" XDG_CONFIG_HOME="$CFG_HOME/.config" \
	"$WORK/wisper" -addr "127.0.0.1:$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
	if curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/config"; then
		break
	fi
	if ! kill -0 "$SERVER_PID" 2>/dev/null; then
		echo "wisper exited before serving:" >&2
		cat "$LOG" >&2
		exit 2
	fi
	sleep 0.5
done
if ! curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/config"; then
	echo "wisper never came up on 127.0.0.1:$PORT:" >&2
	cat "$LOG" >&2
	exit 2
fi

# Answering is not enough: a stale instance on the same port would answer too,
# and the assertions below would then describe an older build.
if ! curl -sf "http://127.0.0.1:$PORT/api/tunnels" | grep -q 'e2e-p2p-tunnel'; then
	echo "127.0.0.1:$PORT is not serving the fixture tunnel — another wisper?" >&2
	exit 2
fi

# ── the browser ──────────────────────────────────────────────────────────────

echo "wisper up on 127.0.0.1:$PORT; running playwright in $IMAGE"
docker run --rm \
	--network=host --ipc=host \
	--user "$(id -u):$(id -g)" \
	-e HOME=/tmp \
	-e WISPER_BASE_URL="http://127.0.0.1:$PORT" \
	-v "$ROOT":/work -w /work/web-e2e \
	"$IMAGE" \
	npx playwright test "$@"
