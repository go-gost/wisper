# Chrome Extension: Native Relay+SMUX v2 Client (No Server Changes)

## Context

The original design spec proposed a new JSON+WebSocket message protocol requiring server-side changes. This plan takes the opposite approach: **zero server changes**, implement the existing binary relay+SMUX v2 protocol in JavaScript.

The Chrome extension speaks the exact same wire protocol as the Go Wisper binary, connecting to the existing `wisper.gost.run` relay infrastructure.

## Protocol Stack (Client Side)

```
┌──────────────────────────────────────────────┐
│ Chrome Extension (MV3, Offscreen Document)   │
│                                               │
│  fetch() ←→ localhost:8080                    │
│       ↕                                       │
│  relay Response (per-stream: peer addr info)  │
│       ↕                                       │
│  SMUX v2 Server (AcceptStream)                │
│       ↕                                       │
│  relay Request/Response (bind handshake)      │
│       ↕                                       │
│  WebSocket binary (wss://wisper.gost.run:443) │
└──────────────────────────────────────────────┘
```

### Connection flow

1. Offscreen document opens `wss://wisper.gost.run:443`
2. Send relay `CmdBind` (4-byte header + features: TunnelFeature, UserAuthFeature, AddrFeature×2)
3. Receive relay `StatusOK` response (features: AddrFeature, TunnelFeature)
4. Create SMUX **Server** over this connection
5. Loop: `AcceptStream()` → read per-stream relay Response (peer address) → `fetch()` to localhost → write response back through stream

### Roles

```
Chrome Extension (Wisper)          Relay Server (wisper.gost.run)
    SMUX v2 Server ←────────────── SMUX v2 Client
    AcceptStream()                  OpenStream() → pushes inbound requests
```

Confirmed by:
- `x/connector/tunnel/bind.go:33` — `mux.ServerSession(conn, cfg)` (Wisper side)
- `x/handler/tunnel/bind.go:94` — `mux.ClientSession(conn, h.md.muxCfg)` (relay side)

## Wire Protocol: Relay

Reference: `relay/relay.go`, `relay/feature.go`

### Request/Response frame (4-byte header)

```
| VER(1) | CMD_or_STATUS(1) | FEALEN(2, BigEndian) | FEATURES(VAR) |
```

- **Request CMD**: CmdConnect=0x01, CmdBind=0x02, CmdAssociate=0x03
- **Response STATUS**: OK=0x00, BadRequest=0x01, Unauthorized=0x02, etc.

### Feature TLV

```
| TYPE(1) | LEN(2, BigEndian) | DATA(VAR) |
```

Features needed for tunnel bind:

| Type | Name | Payload |
|------|------|---------|
| 0x01 | UserAuthFeature | `ULEN(1) + USERNAME + PLEN(1) + PASSWORD` |
| 0x02 | AddrFeature | `ATYP(1) + ADDR(VAR) + PORT(2, BE)` — ATYP: 1=IPv4, 3=domain, 4=IPv6 |
| 0x03 | TunnelFeature | `ID(16) + FLAG(1) + RSV(2) + WEIGHT(1)` = 20 bytes |
| 0x04 | NetworkFeature | `NETWORK(2, BE)` — TCP=0x0000, UDP=0x0001 |

## Wire Protocol: SMUX v2 (xtaci/smux)

Reference: `x/internal/util/mux/mux.go`, `github.com/xtaci/smux` (GOST uses v1.5.31)

Version confirmed: `x/handler/tunnel/metadata.go:168-170` defaults to **v2**.

**No existing production-ready JS/TS implementation.** `@hazae41/smux` (npm) is v0.1.10, lists "Multiplexing" as upcoming feature, not wire-compatible.

### Frame format (8-byte header, all ints LittleEndian)

```
| VER(1) | CMD(1) | LENGTH(2, LE) | STREAMID(4, LE) | DATA(LENGTH) |
```

### Commands

| Code | Name | v1 | v2 | Meaning |
|------|------|:--:|:--:|---------|
| 0 | cmdSYN | ✓ | ✓ | Open new stream |
| 1 | cmdFIN | ✓ | ✓ | Close stream |
| 2 | cmdPSH | ✓ | ✓ | Push data |
| 3 | cmdNOP | ✓ | ✓ | Keepalive ping/pong |
| 4 | cmdUPD | ✗ | ✓ | Flow control window update |

### cmdUPD payload (v2 only, 8 bytes)

```
| CONSUMED(4, LE) | WINDOW(4, LE) |
```

- **CONSUMED**: bytes consumed by receiver
- **WINDOW**: advertised receive window size
- Initial peer window = 262144 (`initialPeerWindow` in smux)

### Flow control (v2 requirement)

As SMUX Server, the Chrome extension must:
1. When consuming data from a stream: send cmdUPD with consumed count + window size
2. The SMUX Client (relay server) uses this to pace data sends

### Stream IDs

- Client (relay): odd, starting from 1, increment by 2
- Server (Chrome extension): even, starting from 0, increment by 2

### Key facts

- **No initial handshake.** No version negotiation or MaxFrameSize exchange at connection setup. Version is checked per-frame.
- Each side uses its own configured MaxFrameSize independently.
- Default MaxStreamBuffer = 1048576 (from `x/handler/tunnel/metadata.go:171-173`)

## Implementation Plan

### Phase 1: Relay protocol encoder/decoder (`extension/lib/relay.js`)

~200 lines. Pure binary encode/decode with `DataView` + `TextEncoder`/`TextDecoder`.

```javascript
// Constants
const Version1 = 0x01;
const CmdBind = 0x02;
const StatusOK = 0x00;

const FeatureUserAuth = 0x01;
const FeatureAddr = 0x02;
const FeatureTunnel = 0x03;
const FeatureNetwork = 0x04;

const AddrIPv4 = 1, AddrDomain = 3, AddrIPv6 = 4;
const NetworkTCP = 0x0000, NetworkUDP = 0x0001;

// Relay request: BigEndian for relay-level fields
class RelayRequest {
  constructor(cmd, features) { this.version = 1; this.cmd = cmd; this.features = features; }
  encode() → Uint8Array   // 4-byte header + TLV features
}

class RelayResponse {
  static decode(buffer) → { version, status, features }
}

// Feature encoders/decoders
encodeUserAuth(username, password) → Uint8Array
decodeUserAuth(data) → { username, password }
encodeAddr(host, port) → Uint8Array   // auto-detects ATYP
decodeAddr(data) → { host, port, aType }
encodeTunnel(id20bytes) → Uint8Array
decodeTunnel(data) → Uint8Array(20)
encodeNetwork(networkId) → Uint8Array   // 2 bytes BE
decodeNetwork(data) → number
```

### Phase 2: SMUX v2 Server (`extension/lib/smux.js`)

~450 lines. The most complex piece. State machine over binary frames arriving on WebSocket.

```javascript
class SmuxServer {
  constructor(callbacks) {
    // callbacks: { onStream(stream), onError(err), onClose() }
    this.streams = new Map();  // streamId → StreamState
    this.buffer = new Uint8Array(0);  // accumulation buffer for partial frames
    this.nextStreamId = 0;  // server uses even IDs
  }

  feed(data: Uint8Array)  // process incoming binary data
  close()                  // cleanup all streams, call onClose

  // Stream API (returned by onStream callback)
  // stream: { id, read(), write(data), close(), consumed, window }
}

class StreamState {
  constructor(id, session) {
    this.id = id;
    this.readBuffer = [];    // array of Uint8Array chunks
    this.readResolve = null; // promise resolver for async read()
    this.closed = false;
    this.consumedTotal = 0;  // total bytes read (for cmdUPD)
    this.window = 262144;    // initial receive window
  }
}
```

Internal frame parsing:

```javascript
_processFrames() {
  while (this.buffer.length >= 8) {
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    const ver = view.getUint8(0);
    const cmd = view.getUint8(1);
    const len = view.getUint16(2, true);  // LE
    const sid = view.getUint32(4, true);  // LE
    const totalLen = 8 + len;
    if (this.buffer.length < totalLen) break; // partial frame, wait for more data

    const data = this.buffer.slice(8, totalLen);
    this.buffer = this.buffer.slice(totalLen);
    this._dispatch(ver, cmd, sid, data);
  }
}

_dispatch(ver, cmd, sid, data) {
  if (ver !== this.version) { this._error('bad version'); return; }

  switch (cmd) {
    case CMD_SYN:   // New stream from client (relay opens a stream to push a request)
      this._handleSyn(sid, data);
      break;
    case CMD_PSH:   // Data on existing stream
      this._handlePsh(sid, data);
      break;
    case CMD_FIN:   // Stream close
      this._handleFin(sid);
      break;
    case CMD_NOP:   // Keepalive — respond with NOP
      this._sendFrame(CMD_NOP, 0, new Uint8Array(0));
      break;
    case CMD_UPD:   // v2: peer consumed/window update
      this._handleUpd(sid, data);
      break;
  }
}
```

Edge cases:
- **Partial frames**: Accumulate in `this.buffer`, only dispatch when `length >= 8 + len`
- **cmdUPD flow control**: Server tracks `budget` per stream (bytes we're allowed to send); send UPD to advertise window when receiving data
- **Write backpressure**: If peer's window drops to 0, pause writes until cmdUPD arrives
- **Keepalive**: Send NOP every 10s; respond to incoming NOP with NOP
- **Reconnect**: SMUX session is ephemeral — on WebSocket reconnect, create a new SMUX session

### Phase 3: Tunnel connection (`extension/lib/tunnel-connection.js`)

~150 lines. WebSocket + relay bind + SMUX orchestration.

```javascript
class TunnelConnection {
  constructor({ tunnelId, localEndpoint, auth, relayUrl }) {
    this.tunnelId = tunnelId;
    this.localEndpoint = localEndpoint;
    this.auth = auth;
    this.relayUrl = relayUrl || 'wss://wisper.gost.run:443';
  }

  async connect() → Promise<void>
  onStream(callback)   // callback({ type, method, path, headers, body }) → { type, status, headers, body }
                       // type is "http" or "websocket"
  close()
}
```

Connection flow:
1. `new WebSocket(this.relayUrl)` — binary mode
2. On open: serialize relay CmdBind + features, send as binary
3. Wait for relay Response (first binary message on WebSocket)
4. Verify StatusOK, extract TunnelFeature (connectorID)
5. Create `SmuxServer`, feed all subsequent binary messages to it
6. On new SMUX stream (cmdSYN):
   a. Read relay Response from stream (peer address info)
   b. Parse HTTP request from stream body
   c. If request has `Upgrade: websocket` header → protocol switch to WebSocket forwarding
   d. Otherwise → standard HTTP forwarding via `fetch()`

### Phase 4: Offscreen document + protocol-aware forwarder (`extension/offscreen.js`)

~280 lines. Hosts tunnel lifecycle, HTTP forwarder, and WebSocket forwarder.

```
                     ┌──────────────────────────┐
                     │  offscreen.js             │
                     │                           │
  SMUX stream ──────→│  Parse HTTP request       │
                     │                           │
            ┌─ Upgrade: websocket?               │
            │ YES                                │
            ├──→ new WebSocket(ws://localhost)    │
            │    │                               │
            │    ├─ SMUX PSH ← ws.onmessage     │
            │    └─ ws.send → SMUX write()       │
            │                                    │
            └─ NO (HTTP)                         │
               └──→ fetch(http://localhost)       │
                    └─ SMUX PSH + FIN → response │
                     └──────────────────────────┘
```

**HTTP forwarding** (`fetch()`):

```javascript
async function forwardHTTP(req, localEndpoint) {
  const url = `http://${localEndpoint}${req.path}`;
  const resp = await fetch(url, {
    method: req.method,
    headers: stripHopByHopHeaders(req.headers),
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
  });
  const body = new Uint8Array(await resp.arrayBuffer());
  return { status: resp.status, headers: Object.fromEntries(resp.headers), body };
}
```

Hop-by-hop headers to strip: `connection`, `keep-alive`, `transfer-encoding`, `te`, `trailer`, `upgrade`, `proxy-authorization`, `proxy-authenticate`.

**WebSocket forwarding** (`new WebSocket()` + bidirectional relay):

```javascript
const activeWS = new Map(); // streamId → WebSocket

function forwardWebSocket(stream, localEndpoint, requestPath, requestHeaders) {
  const url = `ws://${localEndpoint}${requestPath}`;
  const protocols = requestHeaders['sec-websocket-protocol'];
  const ws = new WebSocket(url, protocols);

  ws.binaryType = 'arraybuffer';

  // local → tunnel
  ws.onmessage = (event) => {
    const data = new Uint8Array(event.data);
    stream.sendPSH(data);
  };

  ws.onclose = (event) => {
    stream.sendFIN();
    activeWS.delete(stream.id);
  };

  ws.onerror = () => {
    stream.sendFIN();
    activeWS.delete(stream.id);
  };

  activeWS.set(stream.id, ws);

  // tunnel → local (called when SMUX stream gets PSH data)
  stream.onData = (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  };
}
```

**Upgrade detection** — SMUX stream arrives, first data is the HTTP request:

```javascript
function isWebSocketUpgrade(headers) {
  const upgrade = (headers['upgrade'] || '').toLowerCase();
  return upgrade === 'websocket';
}
```

**No change to protocol stack.** SMUX streams are opaque byte pipes. The extension just reads the first chunk, decides HTTP vs WS, and picks the right forwarder. The relay server doesn't know or care.

### Chrome-side constraints

| Constraint | Impact | Mitigation |
|---|---|---|
| Offscreen doc has no WebSocket API limits | WS forwarding works fine | — |
| `host_permissions` already allows `ws://localhost:*/*` | No extra manifest change needed | — |
| Relayed WebSocket headers limited | `sec-websocket-protocol` passed; other upgrade headers may not survive `fetch()`-based relay-to-localhost hop | Match commonly-used headers explicitly |
| No raw TCP WebSocket masking | Browser `new WebSocket()` handles masking to local server automatically | — |

### Phase 5: Extension scaffolding

~180 lines. Uses the existing Wisper Lit web app build pipeline.

```
extension/
├── manifest.json           # MV3: offscreen, storage, sidePanel, alarms, host_permissions
├── background.js            # Service worker: relay commands, alarm for keepalive
├── offscreen.html           # Minimal host page (<script src="offscreen.js">)
├── offscreen.js             # Tunnel lifecycle + HTTP forwarder
├── sidepanel/               # Built from web-src/ (Lit + TypeScript + Vite)
│   ├── index.html           # Side panel entry point
│   └── assets/              # Bundled JS/CSS (reuses Wisper components)
└── lib/
    ├── relay.js             # Binary relay protocol encode/decode
    ├── smux.js              # SMUX v2 server
    └── tunnel-connection.js # WebSocket + relay bind + SMUX orchestration
```

**Build integration:** The existing `web-src/` Vite config gets a new build target (`sidepanel`). The Lit components, i18n, and theming are shared. A `ChromeBackend` class replaces `GoBackend` — same interface, `chrome.runtime.sendMessage()` instead of `fetch()`. Stores and pages don't need to know the difference.

manifest.json key permissions:
```json
{
  "manifest_version": 3,
  "permissions": ["offscreen", "storage", "sidePanel", "alarms"],
  "host_permissions": [
    "http://localhost:*/*",
    "http://127.0.0.1:*/*",
    "http://192.168.*.*:*/*",
    "http://10.*.*.*:*/*",
    "https://wisper.gost.run/"
  ]
}
```

### Phase 6: Side panel UI (reuse Wisper Lit web app)

**~150 lines of changes** (not building from scratch). The existing Wisper Lit web app in `web-src/` provides ~70% of the UI out of the box.

**Directly reused (0 changes):**
- `tunnel-card.ts`, `stats-row.ts`, `spinner.ts`, `copyable-text.ts`, `delete-dialog.ts`
- `form-fields/` — all form field components
- `i18n/en.ts`, `i18n/zh.ts`, `i18n/i18n.ts` — full bilingual support
- `styles/theme.ts` + CSS custom properties — light/dark theming
- `api/types.ts` — Tunnel, ServiceStats, AppSettings types

**Adapted (minor changes):**
- `home-page.ts` — drop Entrypoint tab, tunnel list only
- `tunnel-detail-page.ts` — HTTP tunnel fields only (no TCP/UDP/file)
- `settings-page.ts` — fields: relay URL, auth, not server/entrypoint/inspector
- `app.ts` — no SPA router needed (side panel is single-view)

**New:**
- `ChromeBackend` class (~60 lines) — same interface as `GoBackend`, but uses `chrome.runtime.sendMessage()` instead of `fetch('/api/...')`. Store layer doesn't change.
- `stats-store.ts` adaptation — stats source from tunnel connection events instead of REST polling

**Build:** Vite output to `extension/` instead of `web/`. Same toolchain.

### Phase 7: Test harness

~200 lines. Node.js-based unit tests for relay and smux modules:

- `test/relay.test.js` — round-trip all feature types, verify against known Go output
- `test/smux.test.js` — frame encode/decode, partial reads, multi-stream, cmdUPD, NOP
- Test strategy: generate known-good binary from Go SMUX, verify JS parser matches

## Files Summary

| File | Lines | Purpose |
|------|-------|---------|
| `extension/lib/relay.js` | ~200 | Binary relay protocol |
| `extension/lib/smux.js` | ~450 | SMUX v2 server (incl. cmdUPD flow control) |
| `extension/lib/tunnel-connection.js` | ~150 | WSS + relay bind + SMUX orchestration |
| `extension/offscreen.js` | ~280 | Tunnel lifecycle + HTTP fetch() + WebSocket bidirectional forwarder |
| `extension/offscreen.html` | ~15 | Host page skeleton |
| `extension/background.js` | ~80 | Service worker coordinator |
| `extension/manifest.json` | ~25 | MV3 manifest |
| `web-src/src/api/chrome-backend.ts` | ~60 | ChromeBackend (replace GoBackend) |
| `web-src/src/pages/home-page.ts` | ~30 (diff) | Drop Entrypoint tab |
| `web-src/src/pages/tunnel-detail-page.ts` | ~30 (diff) | HTTP tunnel fields only |
| `web-src/src/pages/settings-page.ts` | ~20 (diff) | Relay URL + auth fields |
| `web-src/vite.config.ts` | ~10 (diff) | Side panel build target |
| `test/relay.test.js` | ~100 | Relay unit tests |
| `test/smux.test.js` | ~100 | SMUX unit tests |
| **Total new JS** | **~1280** | (excl. reused Lit components) |
| **Total Lit diff** | **~150** | (existing web-src/ modified) |
| **Reuse from web-src/** | **~1200** | Lit components, i18n, theming, types — unchanged |

## Files NOT Modified

- **No server-side changes. None.** Zero. Zilch.
- No GOST relay protocol changes
- No Wisper Go code changes
- No `x/handler/tunnel/` changes
- No `x/internal/util/mux/` changes

## Competitive Landscape (Chrome Web Store)

| Extension | Users | Relay | Free | Open Source Protocol |
|-----------|-------|-------|------|---------------------|
| Serveo | 146 | serveo.net only | 3 tunnels + ads | No |
| Test-Lab.ai | tiny | test-lab.ai only | N/A (platform-specific) | No |
| Hit-It Bridge | tiny | self-hosted only | N/A | No |
| **Wisper** | TBD | **gost.run + self-hosted** | **Unlimited, no ads** | **Yes (GOST relay)** |

No Chrome extension in the store uses the GOST relay protocol. All existing options either lock you into their SaaS relay or require self-hosting. Wisper is the only one offering both + interoperability with the Go binary.

## Risks

| Risk | Mitigation |
|------|------------|
| SMUX v2 cmdUPD flow control bugs | Unit test against Go SMUX binary output; backpressure: if window drops to 0, pause writes |
| SMUX frame boundaries ≠ WebSocket message boundaries | Accumulate buffer, parse frames in loop, handle partial reads |
| `go-gost/x` uses `smux v1.5.31` module path but with protocol version 2 | Confirmed: metadata.go defaults to v2, smux v1.5.x supports v2 protocol internally |
| Offscreen document termination | NOP every 10s + WebSocket-level ping/pong; exponential reconnect if dropped |
| Large response bodies overflow memory | SMUX's per-stream window naturally throttles; MaxStreamBuffer=1MB default is our cap |
| Chrome Web Store rejection | Localhost-only forwarding is standard developer tool pattern; multiple existing extensions (Serveo, Hit-It Bridge) prove this category passes review |

## Verification

1. **relay.test.js**: Encode all feature types, verify against Go-generated hex dumps
2. **smux.test.js**: Feed Go-generated SMUX byte stream, verify JS AcceptStream produces correct streams and data
3. **Integration**: Extension → `wisper.gost.run` → `python3 -m http.server 8080` → `curl` the public endpoint, verify round-trip
4. **Concurrency**: Fire 10 parallel curl requests, verify all complete through single WebSocket
5. **Reconnect**: Kill WebSocket, verify auto-reconnect + new tunnel works
6. **Chrome Store**: Submit for automated review (category: Developer Tools)
