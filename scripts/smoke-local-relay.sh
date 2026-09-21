#!/usr/bin/env bash
# wisper runtime smoke: local gost relay + wisper, all four tunnel types.
#
# Why: wisper's own test suite only covers the API. After a go-gost/x upgrade
# the real coverage comes from running wisper's gost services end to end.
# This script builds gost (from the local workspace), builds wisper, starts a
# self-contained relay, and asserts one round-trip per tunnel type:
#
#   http  -> relay entrypoint, routed by Host: <label>.<settings.entrypoint>
#   file  -> same, serving a local directory
#   tcp   -> relay "direct" tunnel selected by tunnel.id, via a gost client
#   udp   -> same over the udp tunnel
#
# Constraints baked in (wisper hardcodes them):
#   * GetServerAddr() = <settings.server>:443 and the dialer is wss, so the
#     relay MUST listen on TCP 443 with TLS. gost generates a self-signed
#     default certificate when certFile/keyFile are empty (x/config/parsing/
#     tls.go), so no cert files are needed.
#   * settings.insecure: true maps to TLS.Secure=false.
#   * settings.entrypoint is the public suffix; the relay's entrypoint
#     listener is plain TCP (host-sniffed) on :80, which also means port 80
#     must be free (or change entrypoint + the curl/nc ports below).
#   * raw tcp/udp tunnels have no HTTP host to route by, hence
#     `tunnel.direct: true` on the relay: the client's tunnel.id is used
#     directly.
#
# Usage:
#   scripts/smoke-local-relay.sh [workdir]
# Requires: a go-gost checkout with this repo, ../gost and ../x (go.work), root
# (ports 443/80), and a Go toolchain. Exit code = number of failed checks.

set -uo pipefail

W="${1:-/tmp/wisper-smoke}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # wisper/
GOST_SRC="${GOST_SRC:-$ROOT/../gost}"
export PATH="$HOME/.local/go/bin:$PATH"

pass=0; fail=0
ok() { echo "PASS $1"; pass=$((pass + 1)); }
no() { echo "FAIL $1"; fail=$((fail + 1)); }

UUID_HTTP=11111111-1111-1111-1111-111111111111
UUID_FILE=33333333-3333-3333-3333-333333333333
UUID_TCP=44444444-4444-4444-4444-444444444444
UUID_UDP=55555555-5555-5555-5555-555555555555

# Optional entrypoint check (SMOKE_ENTRYPOINT=1): a wisper entrypoint is a
# local listener that forwards *out* through the relay to <md5(id)[:8]>.<suffix>,
# so the public name must resolve to the relay entrypoint and the id must be
# bound by a peer. The check adds one /etc/hosts line and runs a second gost as
# that peer, which is why it is opt-in.
EP_ID=22222222-2222-2222-2222-222222222222
EP_UDP_ID=66666666-6666-6666-6666-666666666666
EP_HASH=$(printf '%s' "$EP_ID" | md5sum | cut -c1-16)
EP_BLOCK="entrypoints: []"
HOSTS_ADDED=0

cleanup() {
	# Match only the binaries this script started ($W/...), never a system gost.
	pkill -f "^$W/gost" 2>/dev/null
	pkill -f "^$W/wisper" 2>/dev/null
	pkill -f "^$W/smoke-backend" 2>/dev/null
	if [ "$HOSTS_ADDED" = 1 ]; then
		grep -v '\.wisper\.test 127\.0\.0\.1$' /etc/hosts >"$W/hosts.tmp" 2>/dev/null && cat "$W/hosts.tmp" >/etc/hosts
	fi
}
trap cleanup EXIT

echo "== build (workdir $W) =="
mkdir -p "$W/www" "$W/backend" "$W/xdg/wisper"
echo "WISPER-SMOKE-OK" >"$W/www/index.html"

(cd "$GOST_SRC" && go build -o "$W/gost" ./cmd/gost) || { echo "build gost failed"; exit 1; }
(cd "$ROOT" && go build -o "$W/wisper" .) || { echo "build wisper failed"; exit 1; }

cat >"$W/backend/main.go" <<'EOF'
package main

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
)

func main() {
	switch os.Args[1] {
	case "http":
		http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "WISPER-SMOKE-OK\n") })
		panic(http.ListenAndServe(os.Args[2], nil))
	case "tcp":
		ln, err := net.Listen("tcp", os.Args[2])
		if err != nil {
			panic(err)
		}
		for {
			c, err := ln.Accept()
			if err != nil {
				continue
			}
			go func() { io.Copy(c, c); c.Close() }()
		}
	case "udp":
		pc, err := net.ListenPacket("udp", os.Args[2])
		if err != nil {
			panic(err)
		}
		b := make([]byte, 2048)
		for {
			n, a, err := pc.ReadFrom(b)
			if err != nil {
				continue
			}
			pc.WriteTo(append([]byte("ECHO:"), b[:n]...), a)
		}
	}
}
EOF
printf 'module smokebackend\n\ngo 1.21\n' >"$W/backend/go.mod"
(cd "$W/backend" && go build -o "$W/smoke-backend" .) || { echo "build backend failed"; exit 1; }

cat >"$W/relay.yaml" <<EOF
services:
  - name: relay
    addr: ":443"
    handler:
      type: tunnel
      metadata:
        entrypoint: ":80"
        # hostname:tunnelID pairs used by the ingress for HTTP-style routing
        tunnel: "httptest.wisper.test:$UUID_HTTP,filetest.wisper.test:$UUID_FILE,$EP_HASH.wisper.test:$EP_ID"
        tunnel.direct: true
    listener:
      type: wss
      tls:
        commonName: wisper.test
        validity: 48h
EOF

if [ "${SMOKE_ENTRYPOINT:-0}" = "1" ]; then
	EP_BLOCK="entrypoints:
  - {id: \"$EP_ID\", name: ep-0, type: tcp, endpoint: \"127.0.0.1:19000\"}
  - {id: \"$EP_UDP_ID\", name: ep-udp-0, type: udp, endpoint: \"127.0.0.1:19001\"}"
	grep -q "$EP_HASH.wisper.test" /etc/hosts || { printf '%s.wisper.test 127.0.0.1\n' "$EP_HASH" >>/etc/hosts; HOSTS_ADDED=1; }
fi

cat >"$W/xdg/wisper/wisper.yaml" <<EOF
settings:
  server: 127.0.0.1
  entrypoint: wisper.test
  insecure: true
  stats_interval: 1
tunnels:
  - {id: "$UUID_HTTP", name: http-0, type: http, endpoint: "127.0.0.1:18080", prefix: httptest, record_mode: off}
  - {id: "$UUID_FILE", name: file-0, type: file, endpoint: "$W/www", prefix: filetest, record_mode: off}
  - {id: "$UUID_TCP", name: tcp-0, type: tcp, endpoint: "127.0.0.1:18081", prefix: tcptest, record_mode: off}
  - {id: "$UUID_UDP", name: udp-0, type: udp, endpoint: "127.0.0.1:18082", prefix: udptest, record_mode: off}
$EP_BLOCK
EOF

echo "== start =="
cleanup
sleep 1
"$W/smoke-backend" http 127.0.0.1:18080 &
"$W/smoke-backend" tcp 127.0.0.1:18081 &
"$W/smoke-backend" udp 127.0.0.1:18082 &
"$W/gost" -C "$W/relay.yaml" >"$W/relay.log" 2>&1 &
sleep 2
XDG_CONFIG_HOME="$W/xdg" "$W/wisper" -addr 127.0.0.1:8900 >"$W/wisper.out" 2>&1 &

n=0
for _ in $(seq 1 30); do
	n=$(curl -fsS http://127.0.0.1:8900/api/tunnels 2>/dev/null | grep -o '"status":"running"' | wc -l)
	[ "$n" = 4 ] && break
	sleep 0.5
done
echo "tunnels running: $n/4"

echo "== checks =="
curl -fsS --max-time 5 -H "Host: httptest.wisper.test" http://127.0.0.1:80/ 2>/dev/null | grep -q WISPER-SMOKE-OK && ok http || no http
curl -fsS --max-time 5 -H "Host: filetest.wisper.test" http://127.0.0.1:80/ 2>/dev/null | grep -q WISPER-SMOKE-OK && ok file || no file

"$W/gost" -L "tcp://127.0.0.1:19090/127.0.0.1:18081" \
	-F "tunnel+wss://127.0.0.1:443?tunnel.id=$UUID_TCP&secure=false" >"$W/gost-tcp.log" 2>&1 &
"$W/gost" -L "udp://127.0.0.1:19091/127.0.0.1:18082" \
	-F "tunnel+wss://127.0.0.1:443?tunnel.id=$UUID_UDP&secure=false" >"$W/gost-udp.log" 2>&1 &
sleep 3

tout=$(bash -c 'exec 3<>/dev/tcp/127.0.0.1/19090; printf ping-tcp >&3; timeout 3 head -c 8 <&3' 2>/dev/null)
[ "$tout" = "ping-tcp" ] && ok tcp || no "tcp (got '$tout')"

uout=$(bash -c 'exec 3<>/dev/udp/127.0.0.1/19091; printf ping-udp >&3; timeout 3 head -c 13 <&3' 2>/dev/null)
[ "$uout" = "ECHO:ping-udp" ] && ok udp || no "udp (got '$uout')"

if [ "${SMOKE_ENTRYPOINT:-0}" = "1" ]; then
	# A peer binds the entrypoint id so <hash>.<suffix> has somewhere to land.
	"$W/gost" -L "rtcp://:0/127.0.0.1:18081" \
		-F "tunnel+wss://127.0.0.1:443?tunnel.id=$EP_ID&secure=false" >"$W/gost-ep.log" 2>&1 &
	sleep 3
	eout=$(bash -c 'exec 3<>/dev/tcp/127.0.0.1/19000; printf ping-ep >&3; timeout 3 head -c 7 <&3' 2>/dev/null)
	[ "$eout" = "ping-ep" ] && ok entrypoint-tcp || no "entrypoint-tcp (got '$eout')"

	"$W/gost" -L "rudp://:0/127.0.0.1:18082" \
		-F "tunnel+wss://127.0.0.1:443?tunnel.id=$EP_UDP_ID&secure=false" >"$W/gost-ep-udp.log" 2>&1 &
	sleep 3
	ueout=$(bash -c 'exec 3<>/dev/udp/127.0.0.1/19001; printf ping-uep >&3; timeout 3 head -c 13 <&3' 2>/dev/null)
	[ "$ueout" = "ECHO:ping-uep" ] && ok entrypoint-udp || no "entrypoint-udp (got '$ueout')"
fi

echo "== summary: pass=$pass fail=$fail =="
exit "$fail"
