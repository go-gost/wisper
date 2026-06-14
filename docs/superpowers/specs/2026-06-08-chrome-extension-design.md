# Wisper Chrome Extension — Design Spec

## Context

Wisper manages GOST tunnels that expose local/internal HTTP services to the public internet via `tunnel.gost.run`. Currently it requires a Go binary running locally. This spec designs a **pure Chrome extension** that can create HTTP tunnels without any local binary, using protocol-aware forwarding (fetch for HTTP, WebSocket API for WS).

## Scope

- **HTTP tunnel type only** (no TCP, UDP, or file tunnels)
- **Protocol-aware forwarding**: `fetch()` for HTTP requests, `WebSocket` API for WebSocket connections
- **Chrome Manifest V3** extension
- Requires GOST tunnel protocol changes (SMUX → WebSocket message protocol)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Chrome Extension (Manifest V3)                          │
│                                                         │
│ ┌──────────────┐  chrome.runtime  ┌──────────────────┐ │
│ │ Side Panel   │ ◄──────────────► │ Service Worker   │ │
│ │              │    messaging      │ (coordinator)    │ │
│ │ • Tunnel CRUD│                   │                  │ │
│ │ • Status     │                   │ • Offscreen mgmt │ │
│ │ • Stats      │                   │ • State relay    │ │
│ │ • Config     │                   │ • Alarm (poll)   │ │
│ └──────────────┘                   └────────┬─────────┘ │
│                                              │           │
│                                    create/offscreen       │
│                                              ▼           │
│                                    ┌──────────────────┐  │
│                                    │ Offscreen Doc    │  │
│                                    │                  │  │
│                                    │ WSS Connection ──┼──┼──► tunnel.gost.run:443
│                                    │  └─ JSON Auth    │  │
│                                    │  └─ Msg Handler  │  │
│                                    │                  │  │
│                                    │ Forwarder:       │  │
│                                    │  ├─ HTTP ────────┼──┼──► fetch() ──► localhost:PORT
│                                    │  └─ WebSocket ───┼──┼──► WebSocket() ──► localhost:PORT
│                                    └──────────────────┘  │
│                                                          │
│ ┌──────────────┐                                         │
│ │ chrome.      │                                         │
│ │ storage.local│  tunnel configs, state                  │
│ └──────────────┘                                         │
└──────────────────────────────────────────────────────────┘
```

## Components

### 1. Tunnel Connection Protocol

Replace the current WSS+Relay+SMUX stack with a **WSS+JSON message protocol**.

**Connection flow:**

```
1. Browser opens WSS to wss://tunnel.gost.run:443/tunnel
2. Client sends bind message (tunnel_id is client-generated UUID):
   { "type": "bind", "tunnel_id": "<client-uuid>" }
3. Server responds with the assigned public endpoint:
   { "type": "bound", "endpoint": "a1b2c3d4.gost.run" }
4. Server pushes incoming requests:
   { "type": "request", "id": "<req-id>", "method": "GET", "path": "/api",
     "headers": {...}, "body": "<base64>", "source": "1.2.3.4:12345" }
5. Client sends responses:
   { "type": "response", "id": "<req-id>", "status": 200,
     "headers": {...}, "body": "<base64>" }
```

**WebSocket upgrade detection:**

When the server detects an incoming WebSocket upgrade request, it sends:
```
{ "type": "ws_upgrade", "id": "<conn-id>", "path": "/ws",
  "headers": {...} }
```

Subsequent data frames:
```
{ "type": "ws_data", "id": "<conn-id>", "data": "<base64>",
  "opcode": "text" | "binary" }
{ "type": "ws_close", "id": "<conn-id>", "code": 1000, "reason": "" }
```

**Keepalive:**
```
Client → Server: { "type": "ping" }
Server → Client: { "type": "pong" }
```

### 2. Protocol-Aware Forwarder

The offscreen document contains the forwarding logic:

**HTTP forwarding:**
```typescript
async function forwardHTTP(msg: TunnelRequest): Promise<TunnelResponse> {
  const url = `http://${config.localEndpoint}${msg.path}`;
  const resp = await fetch(url, {
    method: msg.method,
    headers: msg.headers,
    body: msg.body ? base64decode(msg.body) : undefined,
  });
  const respBody = await resp.arrayBuffer();
  return {
    type: "response",
    id: msg.id,
    status: resp.status,
    headers: Object.fromEntries(resp.headers),
    body: base64encode(respBody),
  };
}
```

**WebSocket forwarding:**
```typescript
function forwardWebSocket(msg: WSUpgrade): void {
  // Always use ws:// for local services (no TLS on localhost)
  const url = `ws://${config.localEndpoint}${msg.path}`;
  const ws = new WebSocket(url, msg.headers["sec-websocket-protocol"]);

  // Local → Tunnel direction
  ws.onmessage = (event) => {
    sendToTunnel({
      type: "ws_data",
      id: msg.id,
      data: base64encode(event.data),
      opcode: typeof event.data === "string" ? "text" : "binary",
    });
  };

  ws.onclose = (event) => {
    sendToTunnel({ type: "ws_close", id: msg.id, code: event.code, reason: event.reason });
    activeWS.delete(msg.id);
  };

  // Store for bidirectional relay (tunnel → local handled by onTunnelWSData)
  activeWS.set(msg.id, ws);
}

// Tunnel → Local direction (called when ws_data arrives from tunnel server)
function onTunnelWSData(msg: WSData): void {
  const ws = activeWS.get(msg.id);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(base64decode(msg.data));
  }
}

function onTunnelWSClose(msg: WSClose): void {
  const ws = activeWS.get(msg.id);
  if (ws) {
    ws.close(msg.code, msg.reason);
    activeWS.delete(msg.id);
  }
}
```

### 3. Offscreen Document Lifecycle

The offscreen document hosts the persistent WSS connection because service workers are ephemeral (Chrome terminates them after ~30s idle).

- **Created** when the first tunnel is started (service worker calls `chrome.offscreen.createDocument()`)
- **Destroyed** when the last tunnel is stopped (service worker calls `chrome.offscreen.closeDocument()`)
- **Reconnection**: if the WSS connection drops, the offscreen document reconnects with exponential backoff (1s → 2s → 4s → 8s → max 30s)
- **Service worker ↔ offscreen**: communicate via `chrome.runtime.sendMessage()` (offscreen sends status updates, service worker sends tunnel CRUD commands)

### 4. Local Endpoint Protocol

For forwarding to local services:
- **HTTP**: always `http://<endpoint>` — local services typically don't use TLS
- **WebSocket**: always `ws://<endpoint>` — same reason
- The `localEndpoint` field stores `host:port` only (e.g., `"localhost:8080"`, `"192.168.1.100:3000"`)
- Protocol scheme is determined by the forwarder, not stored in config

### 5. Chrome Extension Structure

```
extension/
├── manifest.json           # Manifest V3
├── background.js           # Service worker
├── offscreen.html          # Persistent connection host
├── offscreen.js            # WSS + tunnel logic + forwarder
├── sidepanel.html          # Management UI
├── sidepanel.js            # UI logic
├── lib/
│   ├── tunnel-client.js    # WSS tunnel connection + message protocol
│   ├── http-forwarder.js   # HTTP request forwarding via fetch()
│   ├── ws-forwarder.js     # WebSocket forwarding via WebSocket API
│   └── storage.js          # chrome.storage.local wrapper
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### 6. manifest.json

```json
{
  "manifest_version": 3,
  "name": "Wisper Tunnel",
  "version": "1.0.0",
  "description": "Expose local HTTP services to the internet via GOST tunnels",
  "permissions": [
    "offscreen",
    "storage",
    "sidePanel",
    "alarms"
  ],
  "host_permissions": [
    "http://localhost:*/",
    "http://127.0.0.1:*/",
    "http://192.168.*.*:*/*",
    "http://10.*.*.*:*/*",
    "https://tunnel.gost.run/"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "action": {
    "default_icon": "icons/icon48.png",
    "default_title": "Wisper Tunnel"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 7. Data Model

```typescript
interface TunnelConfig {
  id: string;              // UUID
  name: string;
  localEndpoint: string;   // e.g., "localhost:8080" or "192.168.1.100:3000"
  tunnelEndpoint: string;  // assigned by server, e.g., "a1b2c3d4.gost.run"
  status: "stopped" | "connecting" | "running" | "error";
  createdAt: string;       // ISO timestamp
  error?: string;
  stats?: {
    totalRequests: number;
    activeConnections: number;
    bytesIn: number;
    bytesOut: number;
  };
}

interface AppConfig {
  tunnels: TunnelConfig[];
  lang: "en" | "zh";
  theme: "light" | "dark";
}
```

### 8. GOST Server-Side Changes

The GOST tunnel server needs a new endpoint that accepts WebSocket message-based tunnel connections instead of the current Relay+SMUX protocol.

**Changes needed in GOST:**

1. **Abstract multiplexer interface** (`x/internal/util/mux/mux.go`):
   ```go
   type Multiplexer interface {
       OpenStream() (net.Conn, error)
       AcceptStream() (net.Conn, error)
       Close() error
       IsClosed() bool
   }
   ```
   Replace `*mux.Session` usage in 5 files with this interface.

2. **New WebSocket message handler** (`x/handler/tunnel/wsmux/`):
   - Accepts WSS connection on `/tunnel` path
   - Parses JSON messages for bind/connect/data/close
   - Routes requests through existing tunnel infrastructure (ConnectorPool, ingress rules)
   - Serializes responses as JSON messages

3. **Entrypoint changes** (`x/handler/tunnel/entrypoint/`):
   - Detect protocol type for incoming public connections
   - For WebSocket clients, use message-based framing instead of SMUX streams

4. **Wisper config change** (`wisper/tunnel/tunnel.go`):
   - Change dialer from `"wss"` to the new message-based transport

## Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| HTTP only (no TCP/UDP/file tunnels) | Can't expose non-HTTP services | Document clearly; Go binary for other types |
| WebSocket header forwarding limited | Some WS subprotocols may not negotiate correctly | Support common cases; document limitations |
| No request streaming | Large request/response bodies buffered entirely | Use base64 chunks for large payloads |
| GOST server must support new protocol | Requires deploying updated GOST server | Backwards-compatible; old Relay+SMUX still works |
| No auth on tunnel connection | Anyone with tunnel ID can connect | Add token-based auth in bind message |

## Estimated Effort

| Component | Lines (est.) | Notes |
|---|---|---|
| Chrome extension (JS) | ~800-1200 | UI + offscreen + forwarders + storage |
| GOST multiplexer abstraction | ~200 | Interface + SMUX adapter |
| GOST WebSocket message handler | ~600-800 | Server-side message protocol |
| Testing | ~400 | Unit + integration tests |
| **Total** | **~2000-2600** | |

## Verification Plan

1. **Unit test SMUX abstraction** — verify existing SMUX behavior unchanged
2. **Unit test message protocol** — verify JSON message encoding/decoding
3. **Integration test**: Extension → tunnel.gost.run → local HTTP server
4. **Test HTTP forwarding**: GET, POST, PUT, DELETE with various content types
5. **Test WebSocket forwarding**: text messages, binary messages, close
6. **Test connection resilience**: WSS reconnect, service worker lifecycle
7. **Test concurrent requests**: multiple simultaneous tunnel connections
8. **Test local network access**: localhost, 127.0.0.1, 192.168.x.x
