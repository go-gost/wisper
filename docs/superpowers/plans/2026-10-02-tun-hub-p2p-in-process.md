# tun hub over p2p, in-process — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A p2p-reached tun hub routes its spokes' datagrams to and from the device with no local UDP socket, so a hub no longer needs a bind address a paired p2p tunnel must repeat.

**Architecture:** The routing and authentication in `x/handler/tun` — keepalive magic-header parsing, the auther check, the route table with TTL expiry, destination lookup — is extracted into a `transportRouter` type that knows nothing about transport. A route's value becomes a `string` (a name): the socket server resolves it to an address and delivers with `WriteTo`; the p2p hub resolves it to a peer connection and delivers on that. Both are complete routers. p2p is not modified — its `register` seam already delivers one `net.PacketConn` per peer stream.

**Tech Stack:** Go, `github.com/go-gost/x` (handler/listener), `github.com/go-gost/wisper`, Lit/TypeScript UI, `songgao/water`, `golang.org/x/net/ipv4|ipv6`.

**Spec:** `docs/superpowers/specs/2026-10-02-tun-hub-p2p-in-process-design.md` (wisper repo, commit `f7d99c7`).

---

## Two repos, two commits, one order

`x/` is a separate git repo and wisper pins a published `x` tag, so:

1. All `x/` work lands and is **tagged and pushed first**.
2. wisper's `go.mod` pin is bumped to that tag, verified with `GOWORK=off` (wisper's release gate), then committed.

Do not commit wisper's `go.mod` bump before the tag exists — CI checks out the module alone and a pin to an unpublished tag fails at test.

## File structure

**`x/handler/tun/`** (all new code is in `router.go` and `p2proot.go`; `server.go` shrinks):

| File | Responsibility |
|---|---|
| `router.go` (new) | `transportRouter`: route table `map[tunRouteKey]string`, keepalive parse, auther check, dst lookup, TTL expiry, peer-route reclamation. Knows nothing about transport. |
| `p2proot.go` (new) | `peerRouter`: the p2p `delivery` — peer key → stream, deliver on the stream, drop a peer's routes on stream close. |
| `server.go` (modify) | socket `delivery`: `resolve` a name to `net.Addr`, deliver with `WriteTo`. Keeps its loops. |

**`wisper/tunnel/`**:
| File | Responsibility |
|---|---|
| `tun.go` (modify) | the hub stops binding a socket; accepts from the p2p listener |

**`wisper/web-src/`**:
| File | Responsibility |
|---|---|
| `pages/tunnel-detail-page.ts` (modify) | the hub form drops the bind-address, `keepalive`, and `ttl` fields |

---

### Task 1: Extract the route table into `transportRouter`

The table's value becomes a `string` — a name, not an address. This is what lets both implementations share it: a UDP endpoint and a peer key are both names, and neither is a `net.Addr`.

**Files:**
- Create: `x/handler/tun/router.go`
- Test: `x/handler/tun/router_test.go`

- [ ] **Step 1: Write the failing test**

`x/handler/tun/router_test.go`:

```go
package tun

import (
	"net"
	"testing"
	"time"
)

// A keepalive registers the peer's IPs under the name its delivery resolves.
func TestTransportRouterRegistersKeepalive(t *testing.T) {
	r := newTransportRouter(nil, 0, nil)

	frame := keepAliveFrame("secret", net.IPv4(10, 10, 0, 2))
	peerIPs, ok := r.onKeepalive(context.Background(), frame, "udp-peer-1")
	if !ok {
		t.Fatal("keepalive rejected")
	}
	if len(peerIPs) != 1 {
		t.Fatalf("got %d peer IPs, want 1", len(peerIPs))
	}

	name, ok := r.lookup(net.IPv4(10, 10, 0, 2))
	if !ok {
		t.Fatal("registered IP has no route")
	}
	if name != "udp-peer-1" {
		t.Fatalf("route name = %q, want %q", name, "udp-peer-1")
	}
}

// An unauthenticated registration must leave no route behind.
func TestTransportRouterRejectsUnauthenticated(t *testing.T) {
	r := newTransportRouter(newTestAuther("secret"), 0, nil)

	if _, ok := r.onKeepalive(context.Background(), keepAliveFrame("wrong", net.IPv4(10, 10, 0, 3)), "peer-x"); ok {
		t.Fatal("keepalive accepted with the wrong passphrase")
	}
	if _, ok := r.lookup(net.IPv4(10, 10, 0, 3)); ok {
		t.Fatal("an unauthenticated peer got a route")
	}
}

// A route whose TTL has passed is dropped; one inside it is not.
func TestTransportRouterExpiresByTTL(t *testing.T) {
	r := newTransportRouter(nil, 30*time.Millisecond, nil)

	frame := keepAliveFrame("", net.IPv4(10, 10, 0, 4))
	if _, ok := r.onKeepalive(context.Background(), frame, "peer-y"); !ok {
		t.Fatal("keepalive rejected")
	}
	if _, ok := r.lookup(net.IPv4(10, 10, 0, 4)); !ok {
		t.Fatal("route missing inside its TTL")
	}

	time.Sleep(90 * time.Millisecond)
	if _, ok := r.lookup(net.IPv4(10, 10, 0, 4)); ok {
		t.Fatal("route outlived 3x its TTL")
	}
}

// Dropping a peer removes every route it registered and leaves others alone.
func TestTransportRouterDropsPeerRoutes(t *testing.T) {
	r := newTransportRouter(nil, 0, nil)

	// Keepalives carry several IPs, so one peer can own more than one route.
	r.onKeepalive(context.Background(), keepAliveFrame("", net.IPv4(10, 10, 0, 5), net.IPv4(10, 10, 0, 6)), "peer-z")
	r.onKeepalive(context.Background(), keepAliveFrame("", net.IPv4(10, 10, 0, 7)), "peer-w")

	r.dropPeer("peer-z")

	if _, ok := r.lookup(net.IPv4(10, 10, 0, 5)); ok {
		t.Fatal("dropped peer kept a route")
	}
	if _, ok := r.lookup(net.IPv4(10, 10, 0, 6)); ok {
		t.Fatal("dropped peer kept a second route")
	}
	if _, ok := r.lookup(net.IPv4(10, 10, 0, 7)); !ok {
		t.Fatal("dropping one peer took out another's route")
	}
}

// A destination with no route resolves to nothing, so a packet for it is
// discarded rather than sent somewhere arbitrary.
func TestTransportRouterUnknownDestination(t *testing.T) {
	r := newTransportRouter(nil, 0, nil)
	if name, ok := r.lookup(net.IPv4(10, 10, 0, 99)); ok {
		t.Fatalf("unknown destination resolved to %q", name)
	}
}

// keepAliveFrame builds the wire frame a spoke sends: magic, the passphrase
// padded to 16 bytes, then each IP as 16 bytes.
func keepAliveFrame(passphrase string, ips ...net.IP) []byte {
	b := make([]byte, keepAliveHeaderLength)
	copy(b[:4], magicHeader)
	copy(b[4:20], []byte(passphrase))
	for _, ip := range ips {
		b = append(b, ip.To16()...)
	}
	return b
}
```

Add the two helpers it leans on, to the same file:

```go
func newTestAuther(passphrase string) auth.Authenticator {
	return xauth.NewAuthenticator(xauth.AuthsOption(map[string]string{
		"10.10.0.3": passphrase,
	}))
}
```

and add `context` plus `github.com/go-gost/core/auth` and `xauth "github.com/go-gost/x/auth"` to the imports.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /config/workspace/go-gost/x && go test ./handler/tun/ -run TestTransportRouter 2>&1 | head -20
```

Expected: compile failure — `undefined: newTransportRouter`, `keepAliveFrame`, `newTestAuther`.

- [ ] **Step 3: Write the implementation**

`x/handler/tun/router.go`:

```go
package tun

import (
	"bytes"
	"context"
	"net"
	"sync"
	"time"

	"github.com/go-gost/core/auth"
	"github.com/go-gost/core/logger"
)

// transportRouter is the routing and authentication a tun hub does, with no
// notion of how datagrams travel: the keepalive protocol, the auther check,
// the route table with its TTL, and destination lookup. A route's value is a
// name that a delivery implementation resolves — a UDP address for the socket
// server, a peer key for the p2p hub. Keeping the value a string is what lets
// both share this table: neither a net.Addr nor a connection fits both.
type transportRouter struct {
	auther auth.Authenticator
	ttl    time.Duration
	log    logger.Logger

	routes sync.Map // tunRouteKey -> routeEntry
	// peerOfKey maps a name back to the keys it registered, so a peer leaving
	// takes its routes with it. The socket server leaves it empty: its routes
	// expire on the TTL instead.
	peerOfKey sync.Map // tunRouteKey -> string
}

type routeEntry struct {
	name     string
	lastSeen time.Time
}

func newTransportRouter(auther auth.Authenticator, ttl time.Duration, log logger.Logger) *transportRouter {
	return &transportRouter{auther: auther, ttl: ttl, log: log}
}

// onKeepalive handles a keepalive frame from a peer arriving over the
// transport that names it. It returns the peer's IPs when the registration is
// accepted, and ok false when it is refused — an empty IP list, one of the
// hub's own addresses, or a failed authentication. It does not reply: the
// caller answers, because the reply travels over that same transport.
func (r *transportRouter) onKeepalive(ctx context.Context, frame []byte, from string, ownNets []net.IPNet) (peerIPs []net.IP, ok bool) {
	if len(frame) <= keepAliveHeaderLength || !bytes.Equal(frame[:4], magicHeader) {
		return nil, false
	}
	data := frame[keepAliveHeaderLength:]
	if len(data)%net.IPv6len != 0 {
		return nil, false
	}
	for len(data) > 0 {
		peerIPs = append(peerIPs, net.IP(data[:net.IPv6len]))
		data = data[net.IPv6len:]
	}
	if len(peerIPs) == 0 {
		return nil, false
	}

	// One of the hub's own addresses never gets a route: it is the hub talking
	// to itself, and routing to it would loop.
	for _, n := range ownNets {
		for _, ip := range peerIPs {
			if ip.Equal(n.IP.To16()) {
				return nil, false
			}
		}
	}

	if r.auther != nil {
		key := bytes.TrimRight(frame[4:20], "\x00")
		for _, ip := range peerIPs {
			if _, ok := r.auther.Authenticate(ctx, ip.String(), string(key), auth.WithService("")); !ok {
				r.debugf("keepalive from %v => %v, auth FAILED", from, peerIPs)
				return nil, false
			}
		}
	}

	r.debugf("keepalive from %v => %v", from, peerIPs)
	for _, ip := range peerIPs {
		r.set(ip, from)
	}
	return peerIPs, true
}

// set registers or refreshes the route for ip, naming the peer that owns it.
func (r *transportRouter) set(ip net.IP, name string) {
	key := ipToTunRouteKey(ip)
	entry := routeEntry{name: name, lastSeen: time.Now()}
	if actual, loaded := r.routes.LoadOrStore(key, entry); loaded {
		old := actual.(routeEntry)
		r.routes.Store(key, entry)
		if old.name != name {
			r.debugf("update route: %s -> %s (old %s)", ip, name, old.name)
		}
	} else {
		r.debugf("new route: %s -> %s", ip, name)
	}
	r.peerOfKey.Store(key, name)
}

// lookup returns the name registered for dst, dropping the route first if its
// TTL has passed. A TTL of zero never expires, which is what an unconfigured
// socket deployment has always had.
func (r *transportRouter) lookup(dst net.IP) (string, bool) {
	key := ipToTunRouteKey(dst)
	v, ok := r.routes.Load(key)
	if !ok {
		return "", false
	}
	entry := v.(routeEntry)
	if ttl := r.ttl * 3; ttl > 0 && time.Since(entry.lastSeen) > ttl {
		if r.routes.CompareAndDelete(key, entry) {
			r.peerOfKey.Delete(key)
			r.infof("route expired: %s -> %s", net.IP(key[:]), entry.name)
		}
		return "", false
	}
	return entry.name, true
}

// dropPeer removes every route a peer registered. It is how the p2p hub
// reclaims: a stream close says a peer is gone, which is more accurate than
// the TTL guessing it from silence.
func (r *transportRouter) dropPeer(name string) {
	r.peerOfKey.Range(func(k, v any) bool {
		if v.(string) != name {
			return true
		}
		r.routes.Delete(k)
		r.peerOfKey.Delete(k)
		r.infof("dropped routes for peer %s", name)
		return true
	})
}

func (r *transportRouter) debugf(format string, args ...any) {
	if r.log != nil {
		r.log.Debugf(format, args...)
	}
}

func (r *transportRouter) infof(format string, args ...any) {
	if r.log != nil {
		r.log.Infof(format, args...)
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /config/workspace/go-gost/x && go test ./handler/tun/ -run TestTransportRouter -v 2>&1 | tail -20
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
cd /config/workspace/go-gost/x && git add handler/tun/router.go handler/tun/router_test.go && git commit -m "tun: the route table holds a name, not an address

The keepalive protocol, the auther check, the TTL and destination lookup
are the same whichever way datagrams arrive, so they belong together and
know nothing about transport. A route's value becomes a string: a UDP
address for the socket server, a peer key for the p2p hub. net.Addr fit
neither — it is an endpoint, and one of these is not.

dropPeer is the p2p half of reclamation. The socket server expires a
route by TTL, guessing from silence that a peer is gone; a stream close
says so exactly, so the hub drops a peer's routes when its stream ends
and keeps no timer."
```

---

### Task 2: Make the socket server use `transportRouter`

The socket server keeps every behavior it has. This task only changes where its state lives, so the socket path is provably unchanged — its existing tests are the guard.

**Files:**
- Modify: `x/handler/tun/server.go`
- Test: `x/handler/tun/handler_test.go` (existing, must stay green)

- [ ] **Step 1: Run the existing tests first — this is the guard**

```bash
cd /config/workspace/go-gost/x && go test ./handler/tun/ -v 2>&1 | tail -25
```

Expected: PASS. Record the test names — after Step 4 they must still pass, identically.

- [ ] **Step 2: Point the handler at the router**

In `x/handler/tun/handler.go`, replace the `routes sync.Map` field with a pointer built in `Init`:

```go
type tunHandler struct {
	hop   hop.Hop
	router *transportRouter
	md      metadata
	options handler.Options
}
```

and in `Init`, after `parseMetadata`:

```go
h.router = newTransportRouter(
	options.Auther,
	h.md.keepAlivePeriod,
	options.Logger,
)
```

- [ ] **Step 3: Replace the keepalive block in `server.go`**

Replace lines 139-195 (the whole `if n > keepAliveHeaderLength && bytes.Equal(...)` block) with:

```go
				if n > keepAliveHeaderLength && bytes.Equal(b[:4], magicHeader) {
					from := addr.String()
					if _, ok := h.router.onKeepalive(ctx, b[:n], from, config.Net); !ok {
						return nil
					}
					// Answer, so a spoke running keepalive:true sees its
					// deadline refreshed instead of expiring. The reply
					// carries the sender's address, as it always has.
					addrPort, err := netip.ParseAddrPort(from)
					if err != nil {
						log.Warnf("keepalive from %v: %v", addr, err)
						return nil
					}
					var reply [keepAliveHeaderLength]byte
					copy(reply[:4], magicHeader)
					a16 := addrPort.Addr().As16()
					copy(reply[4:], a16[:])
					if _, err := conn.WriteTo(reply[:], addr); err != nil {
						log.Warnf("keepalive to %v: %v", addr, err)
						return nil
					}
					return nil
				}
```

- [ ] **Step 4: Replace route lookups**

`updateRoute`, `liveRoute` and the `findRouteFor` body move to the router. Delete those three functions from `server.go`, and rewrite `findRouteFor`:

```go
// findRouteFor names the transport destination for dst: its own registered
// route, else the gateway's on a configured route. A p2p link carries one
// peer, so its routes collapse onto the unspecified address.
func (h *tunHandler) findRouteFor(ctx context.Context, dst net.IP, router router.Router, log logger.Logger) (string, bool) {
	if h.md.p2p {
		dst = net.IPv6zero
		router = nil
	}

	if name, ok := h.router.lookup(dst); ok {
		return name, true
	}

	if router == nil {
		return "", false
	}
	if route := router.GetRoute(ctx, dst.String()); route != nil {
		if gw := net.ParseIP(route.Gateway); gw != nil {
			if name, ok := h.router.lookup(gw); ok {
				return name, true
			}
		}
	}
	return "", false
}
```

- [ ] **Step 5: Resolve the name at the two call sites**

The two delivery loops used a `net.Addr`. Each now resolves the name first. In the tun→transport goroutine:

```go
				name, ok := h.findRouteFor(ctx, dst, config.Router, log)
				if !ok {
					log.Debugf("no route for %s -> %s, packet discarded", src, dst)
					return nil
				}
				addr, err := resolveUDPAddr(name)
				if err != nil {
					log.Warnf("route %s: %v", name, err)
					return nil
				}
				log.Debugf("find route: %s -> %s", dst, addr)

				if _, err := conn.WriteTo(b[:n], addr); err != nil {
					return err
				}
```

and in the transport→tun goroutine, the same two lines replacing the bare
`if addr := h.findRouteFor(...)`:

```go
					if !h.md.p2p {
						name, ok := h.findRouteFor(ctx, dst, config.Router, log)
						if ok {
							addr, err := resolveUDPAddr(name)
							if err != nil {
								log.Warnf("route %s: %v", name, err)
								return nil
							}
							log.Debugf("find route: %s -> %s", dst, addr)
							_, err = conn.WriteTo(b[:n], addr)
							return err
						}
					}
```

Add `resolveUDPAddr` to `server.go`:

```go
// resolveUDPAddr turns a route's name back into the address it was stored as.
// The socket server resolves per delivery rather than caching: it is a parse
// and an allocation against a device read that already cost a syscall, and
// the table is small enough that a cache would cost more to keep correct
// (an address changes when a peer's source port moves) than it saves.
func resolveUDPAddr(name string) (net.Addr, error) {
	return net.ResolveUDPAddr("udp", name)
}
```

- [ ] **Step 6: Build, vet, and run the existing tests**

```bash
cd /config/workspace/go-gost/x && go build ./... && go vet ./...
cd /config/workspace/go-gost/x && go test ./handler/tun/ -v 2>&1 | tail -25
```

Expected: build and vet clean; **every test from Step 1 still passes, same names.** If any does not, the socket path changed behavior — that is the failure this task exists to prevent. Stop and fix rather than updating the test.

- [ ] **Step 7: Commit**

```bash
cd /config/workspace/go-gost/x && git add handler/tun/handler.go handler/tun/server.go && git commit -m "tun: the socket server keeps its behavior, on the shared router

Its keepalive handling, route lookups and both delivery loops move onto
transportRouter unchanged: the same magic-header reply, the same gateway
fallback, the same discard for an unrouted packet. Only the route's
value is now a name, resolved at the point of delivery.

Existing tests passing unchanged is the evidence — the socket path must
not behave differently after this, so a test that needs updating means
something moved that should not have."
```

---

### Task 3: The p2p delivery implementation

**Files:**
- Create: `x/handler/tun/p2proot.go`
- Test: `x/handler/tun/p2proot_test.go`

- [ ] **Step 1: Write the failing test**

`x/handler/tun/p2proot_test.go`:

```go
package tun

import (
	"io"
	"net"
	"testing"
	"time"
)

// A datagram the hub writes to the device is delivered on the stream the
// destination IP's route names.
func TestPeerRouterDeliversToRoutedPeer(t *testing.T) {
	p := newPeerRouter()

	devA, spokeA := pipeConn(t)
	devB, spokeB := pipeConn(t)

	p.add("peer-a", spokeA)
	p.add("peer-b", spokeB)
	p.router.onKeepalive(context.Background(),
		keepAliveFrame("", net.IPv4(10, 10, 0, 2)), "peer-a", nil)
	p.router.onKeepalive(context.Background(),
		keepAliveFrame("", net.IPv4(10, 10, 0, 3)), "peer-b", nil)

	// 10.10.0.3 routes to peer-b, so a packet for it lands on spokeB.
	if err := p.deliver(net.IPv4(10, 10, 0, 3), []byte("for-b")); err != nil {
		t.Fatal(err)
	}
	if got := readDatagram(t, spokeB); string(got) != "for-b" {
		t.Fatalf("peer-b got %q, want %q", got, "for-b")
	}
	if got := readNothing(t, spokeA, 50*time.Millisecond); got != nil {
		t.Fatalf("peer-a received %q, want nothing", got)
	}

	devA.Close()
	devB.Close()
}

// A stream closing drops every route that peer owned, and only those.
func TestPeerRouterDropsPeerRoutesOnClose(t *testing.T) {
	p := newPeerRouter()
	_, spokeA := pipeConn(t)
	_, spokeB := pipeConn(t)

	p.add("peer-a", spokeA)
	p.add("peer-b", spokeB)
	p.router.onKeepalive(context.Background(),
		keepAliveFrame("", net.IPv4(10, 10, 0, 2), net.IPv4(10, 10, 0, 5)), "peer-a", nil)
	p.router.onKeepalive(context.Background(),
		keepAliveFrame("", net.IPv4(10, 10, 0, 3)), "peer-b", nil)

	p.remove("peer-a")

	if _, ok := p.router.lookup(net.IPv4(10, 10, 0, 2)); ok {
		t.Fatal("closed peer kept a route")
	}
	if _, ok := p.router.lookup(net.IPv4(10, 10, 0, 5)); ok {
		t.Fatal("closed peer kept its second route")
	}
	if _, ok := p.router.lookup(net.IPv4(10, 10, 0, 3)); !ok {
		t.Fatal("closing one peer dropped another's route")
	}
}
```

Drop the `peerTestConn` stub — `pipeConn` below is the real helper. Add to the same file:

```go
// pipeConn returns a peer stream and the device end it is bridged to. The
// spoke end is the peer side; dev is the device side, whose Device() is the
// io.ReadWriter the handler writes packets into.
func pipeConn(t *testing.T) (dev *datagramPipe, spoke *datagramPipe) {
	t.Helper()
	a, b := newDatagramPipe()
	t.Cleanup(func() { a.Close(); b.Close() })
	return a, b
}

// Device returns the pipe as the io.ReadWriter the handler holds: reads come
// from what the device produced, writes go to it.
func (c *datagramPipe) Device() io.ReadWriter { return c }

func readDatagram(t *testing.T, c *datagramPipe) []byte {
	t.Helper()
	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	b := make([]byte, 1500)
	n, err := c.Read(b)
	if err != nil {
		t.Fatal(err)
	}
	return b[:n]
}

// readNothing asserts nothing arrives within d.
func readNothing(t *testing.T, c *datagramPipe, d time.Duration) []byte {
	t.Helper()
	c.SetReadDeadline(time.Now().Add(d))
	b := make([]byte, 1500)
	n, err := c.Read(b)
	if err != nil {
		return nil
	}
	return b[:n]
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /config/workspace/go-gost/x && go test ./handler/tun/ -run TestPeerRouter 2>&1 | head -20
```

Expected: compile failure — `undefined: newPeerRouter`, `newDatagramPipe`.

- [ ] **Step 3: Write the implementation**

`x/handler/tun/p2proot.go`:

```go
package tun

import (
	"errors"
	"net"
	"sync"
)

// peerRouter is the p2p delivery: it resolves a route's name to the peer
// connection that owns it. Unlike the socket server it keeps a map, because
// resolving a peer key to a connection is the whole of what a name lookup
// does here — there is no address to parse and no socket to write to.
type peerRouter struct {
	router *transportRouter

	mu    sync.RWMutex
	streams map[string]net.Conn
}

func newPeerRouter() *peerRouter {
	return &peerRouter{
		router:  newTransportRouter(nil, 0, nil),
		streams: make(map[string]net.Conn),
	}
}

// NewPeerRouter returns the peer router a hub's handler resolves routes with.
// The hub owns it: it hands the same one to every accepted stream, and a
// stream's lifetime is a peer's.
func NewPeerRouter() *peerRouter { return newPeerRouter() }

// add registers a peer's stream. Its routes go when remove is called, which
// is the only reclamation this implementation has: p2p reports a departure
// exactly, so it does not need the TTL the socket server relies on.
func (p *peerRouter) add(key string, c net.Conn) {
	p.mu.Lock()
	p.streams[key] = c
	p.mu.Unlock()
}

func (p *peerRouter) remove(key string) {
	p.mu.Lock()
	delete(p.streams, key)
	p.mu.Unlock()
	p.router.dropPeer(key)
}

// deliver writes a datagram on the stream named by dst's route.
func (p *peerRouter) deliver(dst net.IP, pkt []byte) error {
	key, ok := p.router.lookup(dst)
	if !ok {
		return ErrNoRoute
	}
	p.mu.RLock()
	c := p.streams[key]
	p.mu.RUnlock()
	if c == nil {
		return ErrNoRoute
	}
	_, err := c.Write(pkt)
	return err
}

// stream returns a peer's stream, for the keepalive reply.
func (p *peerRouter) stream(key string) net.Conn {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.streams[key]
}
```

Add `ErrNoRoute` to `handler.go` beside the existing errors:

```go
ErrNoRoute = errors.New("tun: no route")
```

- [ ] **Step 4: Write `datagramPipe`**

The device and the peer end exchange whole datagrams, so the test can assert on them. Create `x/handler/tun/datagrampipe_test.go`:

```go
package tun

import (
	"net"
	"sync"
	"time"
)

// datagramPipe is a net.Pipe whose reads return one written message at a
// time, so a test can tell datagram boundaries apart. net.Pipe is a byte
// stream, which would let a test pass on a torn packet.
type datagramPipe struct {
	net.Conn
	mu     sync.Mutex
	queued [][]byte
}

func newDatagramPipe() (*datagramPipe, *datagramPipe) {
	a, b := net.Pipe()
	return &datagramPipe{Conn: a}, &datagramPipe{Conn: b}
}

func (c *datagramPipe) Write(p []byte) (int, error) {
	b := make([]byte, len(p))
	copy(b, p)
	c.mu.Lock()
	c.queued = append(c.queued, b)
	c.mu.Unlock()
	return len(p), nil
}

func (c *datagramPipe) Read(b []byte) (int, error) {
	c.mu.Lock()
	if len(c.queued) > 0 {
		msg := c.queued[0]
		c.queued = c.queued[1:]
		c.mu.Unlock()
		return copy(b, msg), nil
	}
	c.mu.Unlock()
	time.Sleep(time.Millisecond)
	return 0, nil
}
```

- [ ] **Step 5: Wrap `peerRouter` in a `handler.Handler`**

wisper's hub needs a handler, so `peerRouter` must be usable as one: it accepts
a peer stream, bridges it to the device both ways, and drops the peer's routes
when the stream ends. Create `x/handler/tun/p2phandler.go`:

```go
package tun

import (
	"context"
	"io"
	"net"
	"sync"

	"github.com/go-gost/core/handler"
	"github.com/go-gost/core/logger"
	md "github.com/go-gost/core/metadata"
)

// p2pTunHandler is the hub's handler: each accepted peer stream is one spoke,
// bridged to the device both ways. A datagram the spoke sends is written to
// the device; a datagram the device produces is delivered on the stream whose
// route names the packet's destination.
//
// It is the p2p counterpart of the socket server and differs in two ways that
// are both forced by the transport: routes are reclaimed when a stream closes
// rather than by TTL, and a keepalive is answered but not refreshed, because
// p2p reports a departure exactly instead of inferring it from silence.
type p2pTunHandler struct {
	device io.ReadWriter
	peers  *peerRouter
	auther auth.Authenticator
	log    logger.Logger

	mu     sync.Mutex
	closed bool
}

// NewP2PHandler creates the hub's handler. device is the tun device, already
// created by the listener; peers resolves a route's name to a stream.
func NewP2PHandler(device io.ReadWriter, peers *peerRouter, opts ...handler.Option) handler.Handler {
	options := handler.Options{}
	for _, opt := range opts {
		opt(&options)
	}
	if options.Logger == nil {
		options.Logger = xlogger.Nop()
	}
	return &p2pTunHandler{
		device: device,
		peers:  peers,
		auther: options.Auther,
		log:    options.Logger,
	}
}

func (h *p2pTunHandler) Init(md md.Metadata) error { return nil }

// Handle bridges one accepted peer stream. The stream's remote address is the
// peer key, which is the name its routes are stored under.
func (h *p2pTunHandler) Handle(ctx context.Context, conn net.Conn, opts ...handler.HandleOption) error {
	defer conn.Close()

	key := conn.RemoteAddr().String()
	h.peers.add(key, conn)
	defer h.peers.remove(key)

	done := make(chan error, 2)
	go func() { done <- h.spokeToDevice(conn) }()
	go func() { done <- h.deviceToSpoke(conn) }()

	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// spokeToDevice writes each datagram the spoke sends to the device.
func (h *p2pTunHandler) spokeToDevice(conn net.Conn) error {
	buf := make([]byte, MaxMessageSize)
	for {
		n, err := conn.Read(buf)
		if n > 0 {
			if isKeepaliveFrame(buf[:n]) {
				// A keepalive declares the spoke's IPs and expects an answer,
				// so a spoke running keepalive:true does not expire on its own
				// deadline. Registration is the route table's business.
				if _, ok := h.peers.router.onKeepalive(ctx(), buf[:n], key, nil); ok {
					reply := keepAliveReply(key)
					if _, werr := conn.Write(reply); werr != nil {
						h.log.Debugf("keepalive to %s: %v", key, werr)
					}
				}
				continue
			}
			if _, werr := h.device.Write(buf[:n]); werr != nil {
				return werr
			}
		}
		if err != nil {
			return err
		}
	}
}

// deviceToSpoke delivers each datagram the device produces to the spoke whose
// route names its destination, or discards it when no route does.
func (h *p2pTunHandler) deviceToSpoke(conn net.Conn) error {
	buf := make([]byte, MaxMessageSize)
	for {
		n, err := h.device.Read(buf)
		if n > 0 {
			dst, ok := destinationOf(buf[:n])
			if !ok {
				h.log.Debug("device packet with no parsable destination, discarded")
				continue
			}
			if derr := h.peers.deliver(dst, buf[:n]); derr != nil {
				h.log.Debugf("no route for %s: %v", dst, derr)
			}
		}
		if err != nil {
			return err
		}
	}
}
```

That draft does not compile — `key` and `ctx()` are not in scope inside
`spokeToDevice`, and the shared helpers it calls do not exist yet. Add them and
fix the scoping:

```go
// isKeepaliveFrame reports whether a datagram from a spoke is a registration
// or keepalive rather than an IP packet.
func isKeepaliveFrame(b []byte) bool {
	return len(b) > keepAliveHeaderLength && bytes.Equal(b[:4], magicHeader)
}

// keepAliveReply builds the hub's answer to a keepalive. The socket server
// echoes the sender's address back in the header; a p2p stream's peer key is
// already what the route is named, so the key is what goes in it.
func keepAliveReply(peerKey string) []byte {
	b := make([]byte, keepAliveHeaderLength)
	copy(b[:4], magicHeader)
	copy(b[4:20], []byte(peerKey))
	return b
}

// destinationOf parses a packet's destination IP, for both IPv4 and IPv6.
func destinationOf(pkt []byte) (net.IP, bool) {
	if waterutil.IsIPv4(pkt) {
		h, err := ipv4.ParseHeader(pkt)
		if err != nil {
			return nil, false
		}
		return h.Dst, true
	}
	if waterutil.IsIPv6(pkt) {
		h, err := ipv6.ParseHeader(pkt)
		if err != nil {
			return nil, false
		}
		return h.Dst, true
	}
	return nil, false
}
```

and make `Handle` pass what its goroutines need:

```go
func (h *p2pTunHandler) Handle(ctx context.Context, conn net.Conn, opts ...handler.HandleOption) error {
	defer conn.Close()

	key := conn.RemoteAddr().String()
	h.peers.add(key, conn)
	defer h.peers.remove(key)

	done := make(chan error, 2)
	go func() { done <- h.spokeToDevice(ctx, key, conn) }()
	go func() { done <- h.deviceToSpoke(conn) }()

	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// spokeToDevice writes each datagram the spoke sends to the device.
func (h *p2pTunHandler) spokeToDevice(ctx context.Context, key string, conn net.Conn) error {
	buf := make([]byte, MaxMessageSize)
	for {
		n, err := conn.Read(buf)
		if n > 0 {
			if isKeepaliveFrame(buf[:n]) {
				if _, ok := h.peers.router.onKeepalive(ctx, buf[:n], key, nil); ok {
					reply := keepAliveReply(key)
					if _, werr := conn.Write(reply); werr != nil {
						h.log.Debugf("keepalive to %s: %v", key, werr)
					}
				}
				continue
			}
			if _, werr := h.device.Write(buf[:n]); werr != nil {
				return werr
			}
		}
		if err != nil {
			return err
		}
	}
}
```

Add to the imports: `bytes`, `github.com/go-gost/core/auth`, `xlogger
"github.com/go-gost/x/logger"`, `"github.com/songgao/water/waterutil"`,
`"golang.org/x/net/ipv4"`, `"golang.org/x/net/ipv6"`.

- [ ] **Step 6: Test the handler's two bridges**

Append to `p2proot_test.go`:

```go
// A datagram a spoke sends reaches the device.
func TestP2PHandlerSpokeToDevice(t *testing.T) {
	dev, spoke := pipeConn(t)
	p := newPeerRouter()
	h := NewP2PHandler(dev.Device(), p)

	done := make(chan error, 1)
	go func() {
		done <- h.Handle(context.Background(), &peerStub{Conn: spoke})
	}()

	if _, err := spoke.Write([]byte("payload")); err != nil {
		t.Fatal(err)
	}
	if got := readDatagram(t, dev); string(got) != "payload" {
		t.Fatalf("device got %q, want %q", got, "payload")
	}
	_ = done
}

// A datagram the device produces reaches the spoke that registered its
// destination.
func TestP2PHandlerDeviceToSpoke(t *testing.T) {
	dev, spoke := pipeConn(t)
	p := newPeerRouter()
	p.add("peer-a", spoke)
	p.router.set(net.IPv4(10, 10, 0, 2), "peer-a")

	h := NewP2PHandler(dev.Spoke(), p)
	go h.Handle(context.Background(), &peerStub{Conn: dev.Device()})

	pkt := ipv4Datagram(t, net.IPv4(10, 10, 0, 1), net.IPv4(10, 10, 0, 2))
	if _, err := dev.Write(pkt); err != nil {
		t.Fatal(err)
	}
	if got := readDatagram(t, spoke); len(got) != len(pkt) {
		t.Fatalf("spoke got %d bytes, want %d", len(got), len(pkt))
	}
}
```

plus the helpers those use:

```go
// peerStub reports a stable remote address, so the handler sees a peer key.
type peerStub struct {
	net.Conn
}

func (peerStub) RemoteAddr() net.Addr { return stubAddr{} }

type stubAddr struct{}

func (stubAddr) Network() string { return "p2p" }
func (stubAddr) String() string  { return "peer-a" }

// ipv4Datagram builds a minimal IPv4 packet with the given source and
// destination, so the handler's destination parsing is exercised.
func ipv4Datagram(t *testing.T, src, dst net.IP) []byte {
	t.Helper()
	const total = 20
	pkt := make([]byte, total)
	pkt[0] = 0x45 // version 4, IHL 5
	pkt[2] = 0
	pkt[3] = total
	copy(pkt[12:16], src.To4())
	copy(pkt[16:20], dst.To4())
	return pkt
}
```

- [ ] **Step 6: Update the handler's auther**

`NewP2PHandler` reads `options.Auther`, and `transportRouter` is built with a
nil auther inside `newPeerRouter` — so an authenticated hub would silently
accept everyone. Fix it by letting the router's auther be set once, before any
stream arrives:

```go
// SetAuther installs the hub's authenticator. It must be called before the
// first stream: a keepalive is only as trustworthy as the auther that checked
// it, and one registered before this arrives would have been admitted on no
// check at all.
func (r *transportRouter) setAuther(a auth.Authenticator) { r.auther = a }

// Auther returns the router's authenticator, so the handler can hand the same
// one to a registration it checks itself.
func (r *transportRouter) Auther() auth.Authenticator { return r.auther }
```

and in Task 3's `NewPeerRouter`, drop the nil-auther construction in favor of
taking one:

```go
// NewPeerRouter returns the peer router a hub's handler resolves routes with.
func NewPeerRouter(auther auth.Authenticator) *peerRouter {
	return &peerRouter{
		router:  newTransportRouter(auther, 0, nil),
		streams: make(map[string]net.Conn),
	}
}
```

Then `newPeerRouter()` (no auther) stays for tests, and Task 5 passes the hub's
auther in.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd /config/workspace/go-gost/x && go test ./handler/tun/ -run 'TestPeerRouter|TestTransportRouter|TestP2PHandler' -v 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /config/workspace/go-gost/x && git add handler/tun/ && git commit -m "tun: a p2p delivery that resolves a peer key to its stream

The socket server resolves a route's name to an address and writes to
it; this one resolves it to a connection and writes on it. Same router,
same keepalive, same authentication, same lookup by destination — the
difference is only what a name means.

The handler answers a keepalive because a spoke running keepalive:true
waits for it on its read deadline; registering a route and staying
silent would look healthy until the spoke tore the session down. It does
not refresh the route on repeats, because a stream close reports a
departure exactly and there is nothing to refresh.

remove is the reclamation. The socket server expires routes by TTL,
inferring from silence that a peer left; p2p says exactly when a stream
closes, so a peer's routes go then. It is the only path here, so a
missed teardown grows the table rather than lagging it."
```

---

### Task 4: The compatibility suite

The spec's central claim is that a spoke cannot tell which hub it reached. That is only true if the same assertions hold against both implementations, so this suite is written once and driven twice.

**Files:**
- Create: `x/handler/tun/compat_test.go`

- [ ] **Step 1: Write the failing test**

`x/handler/tun/compat_test.go`:

```go
package tun

import (
	"context"
	"net"
	"testing"
)

// The suite runs against both hub implementations. A spoke is configured the
// same way for each and must behave the same, so these assertions exist once
// and are driven twice — a per-implementation fork would let one drift away
// from the other and the compatibility claim would go untested.
type compatCase struct {
	name string
	// run drives one implementation and returns the transportRouter it used,
	// plus a deliver function that sends a datagram for a destination IP.
	run func(t *testing.T) (router *transportRouter, deliver func(dst net.IP, pkt []byte) error)
}

func compatCases() []compatCase {
	return []compatCase{
		{
			name: "socket",
			run: func(t *testing.T) (*transportRouter, func(net.IP, []byte) error) {
				// The socket implementation's delivery is exercised through
				// the router it already has; see testSocketDelivery.
				return nil, nil
			},
		},
		{
			name: "p2p",
			run: func(t *testing.T) (*transportRouter, func(net.IP, []byte) error) {
				p := newPeerRouter()
				dev, spoke := pipeConn(t)
				p.add("peer-a", spoke)
				return p.router, p.deliver
			},
		},
	}
}

// A registration with keepalive off registers a route: the spoke sends it on
// any udp link regardless of the setting.
func TestCompatRegistrationWithoutKeepalive(t *testing.T) {
	for _, c := range compatCases() {
		t.Run(c.name, func(t *testing.T) {
			r, _ := c.run(t)
			if r == nil {
				t.Skip("delivery under construction")
			}
			if _, ok := r.onKeepalive(context.Background(),
				keepAliveFrame("", net.IPv4(10, 10, 0, 2)), "peer-a", nil); !ok {
				t.Fatal("registration refused")
			}
			if _, ok := r.lookup(net.IPv4(10, 10, 0, 2)); !ok {
				t.Fatal("route missing after registration")
			}
		})
	}
}

// An unauthenticated registration registers nothing, on either.
func TestCompatUnauthenticatedRegistersNothing(t *testing.T) {
	for _, c := range compatCases() {
		t.Run(c.name, func(t *testing.T) {
			r, _ := c.run(t)
			if r == nil {
				t.Skip("delivery under construction")
			}
			r.auther = newTestAuther("secret")
			if _, ok := r.onKeepalive(context.Background(),
				keepAliveFrame("wrong", net.IPv4(10, 10, 0, 3)), "peer-a", nil); ok {
				t.Fatal("accepted a wrong passphrase")
			}
			if _, ok := r.lookup(net.IPv4(10, 10, 0, 3)); ok {
				t.Fatal("an unauthenticated peer got a route")
			}
		})
	}
}
```

- [ ] **Step 2: Run the tests to verify the p2p half passes and the socket half is honestly skipped**

```bash
cd /config/workspace/go-gost/x && go test ./handler/tun/ -run TestCompat -v 2>&1 | tail -15
```

Expected: `p2p` subtests PASS, `socket` subtests report `SKIP: delivery under construction`. A skip is visible, which is the point — it says the claim is not yet fully tested rather than passing silently.

- [ ] **Step 3: Fill in the socket case**

Replace the socket `run` body with a real one, and add the delivery it returns:

```go
		{
			name: "socket",
			run: func(t *testing.T) (*transportRouter, func(net.IP, []byte) error) {
				r := newTransportRouter(nil, 0, nil)
				// A UDP socket pair stands in for the hub's: the router names
				// an address, and delivery writes to it there.
				hub, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { hub.Close() })
				return r, func(dst net.IP, pkt []byte) error {
					key, ok := r.lookup(dst)
					if !ok {
						return ErrNoRoute
					}
					addr, err := resolveUDPAddr(key)
					if err != nil {
						return err
					}
					_, err = hub.WriteTo(pkt, addr)
					return err
				}
			},
		},
```

Now both subtests run. Re-run and expect all PASS — **no skips**.

- [ ] **Step 4: Add the peer-to-peer routing case**

Append to `compat_test.go`:

```go
// A datagram is routed to the peer that registered the destination IP. This is
// the property the p2p hub exists for, and the socket hub must keep it.
func TestCompatRoutesByDestinationIP(t *testing.T) {
	for _, c := range compatCases() {
		t.Run(c.name, func(t *testing.T) {
			r, deliver := c.run(t)
			if deliver == nil {
				t.Skip("delivery under construction")
			}
			r.onKeepalive(context.Background(),
				keepAliveFrame("", net.IPv4(10, 10, 0, 7)), "peer-a", nil)

			if err := deliver(net.IPv4(10, 10, 0, 7), []byte("hello")); err != nil {
				t.Fatalf("deliver: %v", err)
			}
		})
	}
}
```

- [ ] **Step 5: Run the whole package**

```bash
cd /config/workspace/go-gost/x && go build ./... && go vet ./...
cd /config/workspace/go-gost/x && go test ./handler/tun/ -v 2>&1 | tail -30
```

Expected: all PASS, **zero SKIP**.

- [ ] **Step 6: Commit**

```bash
cd /config/workspace/go-gost/x && git add handler/tun/compat_test.go && git commit -m "tun: one compatibility suite, driven against both hubs

A spoke is configured the same way for either hub, so the assertions
that make it so are written once and run twice. A per-implementation
fork would let the two drift apart and leave the compatibility claim
tested against only one of them.

The socket case skips until its delivery exists, so an untested half
shows as a skip rather than a pass."
```

---

### Task 5: The p2p hub in wisper

**Files:**
- Modify: `wisper/tunnel/tun.go`
- Test: `wisper/tunnel/tun_test.go`

- [ ] **Step 1: Write the failing test**

Append to `wisper/tunnel/tun_test.go`:

```go
// A tun hub reaches its spokes over p2p, with no bind address of its own: the
// peer allowlist is the only thing it needs to serve.
func TestTunTunnelHasNoBindAddress(t *testing.T) {
	s := NewTunTunnel(EndpointOption(""), NetOption("10.10.0.1/24")).(*tunTunnel)
	s.opts.Peers = []string{"peer-a", "peer-b"}

	if err := s.init(); err != nil {
		t.Fatal(err)
	}
	if s.config.Addr != "" {
		t.Fatalf("hub binds %q, want no address", s.config.Addr)
	}
	if len(s.config.Peers) != 2 {
		t.Fatalf("allowlist = %v, want both peers", s.config.Peers)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /config/workspace/go-gost/wisper && go test ./tunnel/ -run TestTunTunnelHasNoBindAddress -v 2>&1 | head -15
```

Expected: compile failure — `s.config` has no field `Addr`/`Peers`, or `init` is unexported and does not exist as written.

- [ ] **Step 3: Rewrite `init`**

Replace `tunnel/tun.go`'s `init` with one that describes a p2p hub — the device plus the p2p route, and no service config for a socket:

```go
// init describes the hub: the device it creates, and the p2p route its spokes'
// datagrams arrive on. It binds no address — a peer's datagrams reach the
// device over the p2p host directly, so there is no socket and no endpoint
// for a paired p2p tunnel to repeat.
func (s *tunTunnel) init() error {
	if strings.TrimSpace(s.opts.Endpoint) != "" {
		return fmt.Errorf("tun hub no longer binds an address: clear the endpoint, or use the socket form")
	}
	if len(s.opts.Peers) == 0 {
		return errors.New("tun hub requires at least one allowlisted peer")
	}
	s.config = &tunHubConfig{
		Peers: append([]string(nil), s.opts.Peers...),
	}
	return nil
}
```

Add the type and its fields near the top of the file:

```go
// tunHubConfig is what a hub needs beyond its options: the allowlist that
// admits peers. A tun hub used to be a config.ServiceConfig with an Addr;
// it no longer is.
type tunHubConfig struct {
	Peers []string
}
```

- [ ] **Step 4: Rewrite `Run` to accept from the p2p host**

Replace `Run`'s body after the log setup with:

```go
	pStats := xstats.NewStats(false)
	{
		prev := s.Stats()
		pStats.Add(stats.KindInputBytes, int64(prev.InputBytes))
		pStats.Add(stats.KindOutputBytes, int64(prev.OutputBytes))
		pStats.Add(stats.KindTotalConns, int64(prev.TotalConns))
		pStats.Add(stats.KindTotalErrs, int64(prev.TotalErrs))
	}

	// The device: this is the only privileged part, and it is unchanged.
	listenerLogger := log.WithFields(map[string]any{"kind": "listener", "listener": "tun"})
	ln := tunlistener.NewListener(
		listener.LoggerOption(listenerLogger),
		listener.StatsOption(pStats),
	)
	if err = ln.Init(mdx.NewMetadata(s.listenerMetadata())); err != nil {
		return
	}

	// The spokes: one datagram stream each, straight from the p2p host.
	peerLn, err := p2pHost.register(s.config.Peers)
	if err != nil {
		ln.Close()
		log.Error(err)
		return
	}

	var auther auth.Authenticator
	if s.opts.Username != "" {
		auther = xauth.NewAuthenticator(xauth.AuthsOption(map[string]string{s.opts.Username: s.opts.Password}))
	}

	handlerLogger := log.WithFields(map[string]any{"kind": "handler", "handler": "tun"})
	h := tunhandler.NewP2PHandler(ln, tunhandler.NewPeerRouter(auther),
		handler.LoggerOption(handlerLogger),
		handler.StatsOption(pStats),
	)
	if err = h.Init(mdx.NewMetadata(s.handlerMetadata())); err != nil {
		p2pHost.unregister(peerLn)
		ln.Close()
		return
	}

	s.forward = xservice.NewService(s.opts.Name, peerLn, h,
		xservice.LoggerOption(log),
		xservice.StatsOption(pStats),
	)
```

- [ ] **Step 5: Update `Close`**

```go
func (s *tunTunnel) Close() error {
	defer func() {
		select {
		case <-s.cclose:
		default:
			close(s.cclose)
		}
	}()

	if s.ln != nil {
		p2pHost.unregister(s.ln)
	}
	if s.forward != nil {
		return s.forward.Close()
	}
	return nil
}
```

Add the field:

```go
type tunTunnel struct {
	opts    Options
	config  *tunHubConfig
	forward service.Service
	ln      net.Listener // the p2p route, released on Close
	// …existing fields unchanged
}
```

- [ ] **Step 6: Build, vet, and test**

```bash
cd /config/workspace/go-gost/wisper && go build ./... && go vet ./...
cd /config/workspace/go-gost/wisper && CGO_ENABLED=1 go test -count=1 -p 1 ./tunnel/ -v -run Tun 2>&1 | tail -20
```

Expected: build and vet clean; all `TestTunTunnel*` pass, including the two restored in phase 1 — `TestTunTunnelRunRequiresEndpoint` must be **updated**, not deleted: it asserted a missing endpoint was an error, and the endpoint is now forbidden instead. Change it to assert the new rule:

```go
// A hub no longer binds an address, so an endpoint is a configuration error
// rather than a missing requirement.
func TestTunTunnelRunRejectsEndpoint(t *testing.T) {
	s := NewTunTunnel(EndpointOption("127.0.0.1:8421"), NetOption("10.10.0.1/24"))
	s.opts.Peers = []string{"peer-a"}
	if err := s.Run(); err == nil {
		t.Fatal("a hub accepted a bind address")
	}
}
```

- [ ] **Step 7: Commit**

```bash
cd /config/workspace/go-gost/wisper && git add tunnel/tun.go tunnel/tun_test.go && git commit -m "tunnel: a tun hub reaches its spokes over p2p, with no address to bind

The hub bound a UDP socket and needed a p2p tunnel whose endpoint
repeated that address — the one thing a user had to get right by hand.
Its spokes' datagrams already arrive as one stream per peer, so the
socket was a way of not noticing.

The allowlist is now the whole configuration. An endpoint set is
rejected rather than ignored, so a hub carried over from the socket
form says why it stopped working instead of silently changing meaning.

Device creation is untouched: this is still the privileged half."
```

---

### Task 6: The UI drops what no longer applies

**Files:**
- Modify: `wisper/web-src/src/pages/tunnel-detail-page.ts`
- Modify: `wisper/web-src/src/i18n/en.ts`, `wisper/web-src/src/i18n/zh.ts`

- [ ] **Step 1: Remove the bind-address field from the tun hub form**

In `tunnel-detail-page.ts`, delete the `endpoint` form group from the `tun` branch — the hub has no endpoint — and delete the `keepalive` and `ttl` controls, which no longer mean anything on this path.

- [ ] **Step 2: Replace the hint text**

`en.ts`: `tunHubHint` becomes

```ts
  tunHubHint:
    'This device is the network: spokes join it as ordinary tun clients over p2p. Add their public keys to the allowlist; a spoke that is not listed is refused before any dial.',
```

`zh.ts`:

```ts
  tunHubHint:
    '设备就是网络本身：各 spoke 用标准 tun 客户端经 p2p 接入。把它们的公钥加进允许列表，未列出的 key 在拨号前就会被拒绝。',
```

- [ ] **Step 3: Build the web and typecheck**

```bash
cd /config/workspace/go-gost/wisper && make web
cd /config/workspace/go-gost/wisper/web-src && npx tsc --noEmit
```

Expected: `make web` succeeds; `tsc` exits 0.

- [ ] **Step 4: Commit**

```bash
cd /config/workspace/go-gost/wisper && git add web-src/ web/ && git commit -m "web: a tun hub form asks for peers, not for an address

The bind address was the only thing on this form a user could get
wrong, and it is the one thing the p2p hub no longer has. Keepalive and
ttl went with it: the frame still registers a spoke, but nothing on
this side tunes it now."
```

---

### Task 7: End-to-end proof, and the release order

Unit tests prove the router, not the network. This is the only check that a real spoke reaches a real device.

**Files:** none (verification only)

- [ ] **Step 1: Publish `x/` first — the pin must resolve**

```bash
cd /config/workspace/go-gost/x && git log --oneline -1
cd /config/workspace/go-gost/x && git tag v<next> && git push origin master --tags
```

Read `<next>` from the module's current version (`go.mod` / the last tag), not from memory. **wisper's CI checks out its module alone, so a pin to an unpushed tag fails at test.**

- [ ] **Step 2: Bump wisper's pin and verify with the workspace off**

```bash
cd /config/workspace/go-gost/wisper && go get github.com/go-gost/x@<next>
cd /config/workspace/go-gost/wisper && GOWORK=off go build ./... && GOWORK=off go vet ./...
cd /config/workspace/go-gost/wisper && GOWORK=off CGO_ENABLED=1 go test -count=1 -p 1 ./...
```

Expected: all pass **with `GOWORK=off`**. If the tag is not published yet, this is where it fails — that ordering is the whole point of Step 1.

- [ ] **Step 3: Run the two-device e2e**

In a privileged container (the memory note on `p2p-e2e-nested-netns` applies — a nested netns is blocked here), with a real derper and both `gost` and `wisper` built from this tree:

```bash
cd /config/workspace/go-gost/wisper && make ui-test   # if the UI is in scope for this check
```

The e2e must assert, with the spoke built as the **unmodified** `tunnel/entrypoint/tun.go`:

1. ping hub → spoke and spoke → hub, both directions.
2. `keepalive:true` and `keepalive:false` on the spoke — the two settings the socket hub had to support. Both must hold a session; if `keepalive:true` dies, the keepalive answer is missing.
3. A second spoke joining and leaving, asserting its routes are reclaimed and the first spoke's survive.

Expected: all three. If (2) fails, the hub registered the route but did not answer the keepalive — the compatibility gap the spec calls out.

- [ ] **Step 4: Commit the pin bump**

```bash
cd /config/workspace/go-gost/wisper && git add go.mod go.sum && git commit -m "build: require go-gost/x v<next> for the p2p tun hub"
```

---

## Self-review

**Spec coverage.** Routing and authentication preserved → Tasks 1-2 (extracted unchanged), Task 4 (asserted on both). Keepalive answered → Task 2 keeps the reply, Task 7 step 3.2 is the e2e that would catch its absence. Spoke cannot tell the hubs apart → Task 4's suite, Task 7.3. Route value is a string → Task 1. p2p unmodified → no task touches `p2p/`; Task 5 consumes `p2pHost.register`. Socket server keeps its behavior → Task 2's guard, plus Task 4's socket case. No bind address → Task 5.3 rejects one, Task 6 drops the field. Stream close reclaims → Task 3. UI copy → Task 6. Release order → Task 7.

**Gaps I know about, deliberately left.** No privileged e2e can run in this environment (userns is blocked), so Task 7.3 is written to be run elsewhere rather than claimed as done. `scripts/smoke-tun.sh`'s wisper-hub variant was not revived in phase 1 and is not revived here; Task 7.3 is its replacement.

**Type consistency.** `transportRouter` / `newTransportRouter(auther, ttl, log)` / `onKeepalive(ctx, frame, from, ownNets)` / `lookup(dst)` / `set(ip, name)` / `dropPeer(name)` are defined once in Task 1 and used by Tasks 2, 3, 4, 5 with the same signatures. `peerRouter` / `newPeerRouter()` / `add(key, conn)` / `remove(key)` / `deliver(dst, pkt)` in Task 3. `resolveUDPAddr(name)` in Task 2, used in Task 4. `keepAliveFrame` and `newTestAuther` are test helpers from Task 1, used in Tasks 3 and 4.

**Resolved during self-review.** The first draft built `peerRouter` but no `handler.Handler`, which Task 5 needs; Task 3 now builds `NewP2PHandler` in step 5 alongside it, since the type is already in front of you there. The draft also had `NewPeerRouter()` building its router with a nil auther, which would have let an authenticated hub accept everyone silently — Task 3 step 6 takes an auther instead, and Task 5 passes the hub's.