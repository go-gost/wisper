/**
 * offscreen.js — persistent tunnel host for Wisper Chrome Extension.
 *
 * Runs in an offscreen document (Manifest V3). The offscreen document is
 * long-lived — it is not terminated by Chrome's 30s service worker idle
 * timeout. It hosts:
 *
 *   - TunnelConnection instances (WebSocket + relay + SMUX)
 *   - HTTP forwarder (fetch() to localhost)
 *   - WebSocket forwarder (bidirectional relay to localhost)
 *   - Reconnection with exponential backoff
 *
 * Communication: service worker ↔ offscreen via chrome.runtime.sendMessage().
 */

import { TunnelConnection } from './lib/tunnel-connection.js';

// ── State ──────────────────────────────────────────────────────────────

/** Map<tunnelId, { config, connection, reconnectTimer }> */
const tunnels = new Map();

// ── Message handler ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'start-tunnel':
      startTunnel(msg.config);
      sendResponse({ ok: true });
      break;

    case 'stop-tunnel':
      stopTunnel(msg.tunnelId);
      sendResponse({ ok: true });
      break;

    case 'get-tunnels':
      sendResponse({ tunnels: getTunnelStatuses() });
      break;

    default:
      sendResponse({ ok: false, error: `unknown message: ${msg.type}` });
  }
  // Return false — no async sendResponse needed (we respond synchronously
  // for start/stop/get-tunnels; async lifecycle updates go via notifyStatus).
  return false;
});

// ── Tunnel lifecycle ───────────────────────────────────────────────────

function startTunnel(config) {
  const { tunnelId } = config;

  if (tunnels.has(tunnelId)) {
    // Already running — restart
    stopTunnel(tunnelId);
  }

  const entry = { config, connection: null, reconnectTimer: null };
  tunnels.set(tunnelId, entry);

  connect(entry);
}

function stopTunnel(tunnelId) {
  const entry = tunnels.get(tunnelId);
  if (!entry) return;

  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }

  if (entry.connection) {
    entry.connection.close();
    entry.connection = null;
  }

  tunnels.delete(tunnelId);
  notifyStatus(tunnelId, 'stopped');
}

async function connect(entry) {
  const { config } = entry;

  notifyStatus(config.tunnelId, 'connecting');

  const conn = new TunnelConnection({
    tunnelId: config.tunnelIdBytes
      ? new Uint8Array(config.tunnelIdBytes)
      : generateTunnelId(),
    localEndpoint: config.localEndpoint,
    auth: config.auth || {},
    relayUrl: config.relayUrl,
    onStream: ({ stream, request }) => handleRequest(stream, request, config),
  });

  conn.onClose = () => {
    if (entry.connection === conn && tunnels.has(config.tunnelId)) {
      // Connection dropped — reconnect
      entry.connection = null;
      const delay = Math.min(1000 * Math.pow(2, entry.reconnectAttempts || 0), 30000);
      entry.reconnectAttempts = (entry.reconnectAttempts || 0) + 1;
      notifyStatus(config.tunnelId, 'connecting', `reconnect in ${delay}ms`);
      entry.reconnectTimer = setTimeout(() => connect(entry), delay);
    }
  };

  entry.connection = conn;
  entry.reconnectAttempts = 0;
  try {
    await conn.connect();
    notifyStatus(config.tunnelId, 'running', null, conn.entrypoint);
  } catch (e) {
    notifyStatus(config.tunnelId, 'error', e.message);
  }
}

// ── Request handler (HTTP + WebSocket dispatch) ────────────────────────

async function handleRequest(stream, req, config) {
  try {
    if (isWebSocketUpgrade(req.headers)) {
      await forwardWebSocket(stream, req, config);
    } else {
      await forwardHTTP(stream, req, config);
    }
  } catch (e) {
    console.error(`Wisper: forwarding error for ${req.path}:`, e.message);
    stream.close();
  }
}

// ── HTTP forwarder ─────────────────────────────────────────────────────

async function forwardHTTP(stream, req, config) {
  const url = `http://${config.localEndpoint}${req.path}`;
  const method = req.method || 'GET';

  // Build fetch options
  const fetchOpts = {
    method,
    headers: stripHopByHopHeaders(req.headers),
  };

  // Don't set body for methods that don't support it
  if (!['GET', 'HEAD'].includes(method) && req.body && req.body.length > 0) {
    fetchOpts.body = req.body;
  }

  const resp = await fetch(url, fetchOpts);

  // Serialize response
  const respBody = new Uint8Array(await resp.arrayBuffer());
  const respHeaders = {};
  for (const [name, value] of resp.headers) {
    respHeaders[name] = value;
  }

  // Write HTTP response + body back through the SMUX stream
  const statusLine = `HTTP/1.1 ${resp.status} ${resp.statusText}\r\n`;
  const headerLines = Object.entries(respHeaders)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n');
  const responseHead = new TextEncoder().encode(`${statusLine}${headerLines}\r\n\r\n`);

  await stream.write(responseHead);
  if (respBody.length > 0) {
    await stream.write(respBody);
  }
  stream.close();
}

// ── WebSocket forwarder ────────────────────────────────────────────────

/**
 * activeWebSockets — maps stream id → local WebSocket connection.
 *
 * ponytail: global map, per-stream granularity is enough;
 * add per-tunnel ShardedMap if hundreds of concurrent WS.
 */
const activeWebSockets = new Map();

async function forwardWebSocket(stream, req, config) {
  const protocols = req.headers['sec-websocket-protocol'] || undefined;
  const wsUrl = `ws://${config.localEndpoint}${req.path}`;

  const ws = new WebSocket(wsUrl, protocols);
  ws.binaryType = 'arraybuffer';

  const streamId = stream.id;

  ws.onopen = () => {
    activeWebSockets.set(streamId, ws);

    // Write HTTP 101 Switching Protocols back through SMUX stream
    const switching = new TextEncoder().encode(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n\r\n'
    );
    stream.write(switching);
  };

  // local → tunnel
  ws.onmessage = (event) => {
    const data = event.data instanceof ArrayBuffer
      ? new Uint8Array(event.data)
      : new TextEncoder().encode(event.data);
    stream.write(data).catch(() => {});
  };

  ws.onclose = (event) => {
    activeWebSockets.delete(streamId);
    stream.close();
  };

  ws.onerror = () => {
    activeWebSockets.delete(streamId);
    stream.close();
  };

  // tunnel → local: start reading from the stream
  relayWebSocketData(stream, streamId);
}

async function relayWebSocketData(stream, streamId) {
  try {
    while (true) {
      const chunk = await stream.read();
      if (!chunk) break; // EOF
      const ws = activeWebSockets.get(streamId);
      if (!ws || ws.readyState !== WebSocket.OPEN) break;
      ws.send(chunk);
    }
  } catch (e) {
    // Stream closed
  }
  const ws = activeWebSockets.get(streamId);
  if (ws) {
    ws.close();
    activeWebSockets.delete(streamId);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function isWebSocketUpgrade(headers) {
  const upgrade = (headers['upgrade'] || '').toLowerCase();
  return upgrade === 'websocket';
}

/**
 * stripHopByHopHeaders — remove HTTP/1.1 hop-by-hop headers.
 * Must be stripped: connection, keep-alive, proxy-*, transfer-encoding, te,
 * trailer, upgrade (for non-WS requests).
 */
function stripHopByHopHeaders(headers) {
  const hopByHop = new Set([
    'connection', 'keep-alive', 'proxy-authorization', 'proxy-authenticate',
    'transfer-encoding', 'te', 'trailer', 'upgrade',
  ]);
  const result = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!hopByHop.has(k.toLowerCase())) {
      result[k] = v;
    }
  }
  return result;
}

function notifyStatus(tunnelId, status, error, entrypoint) {
  chrome.runtime.sendMessage({
    type: 'tunnel-status',
    tunnelId,
    status,
    error: error || null,
    entrypoint: entrypoint || null,
  }).catch(() => {
    // Service worker may not be listening — ignore
  });
}

function getTunnelStatuses() {
  const result = [];
  for (const [id, entry] of tunnels) {
    result.push({
      tunnelId: id,
      localEndpoint: entry.config.localEndpoint,
      status: entry.connection ? 'running' : 'connecting',
      entrypoint: entry.connection ? entry.connection.entrypoint : null,
    });
  }
  return result;
}

function generateTunnelId() {
  // 16-byte UUID → 20-byte TunnelID (16 bytes ID + 1 flag + 2 rsv + 1 weight)
  const id = new Uint8Array(20);
  crypto.getRandomValues(id.subarray(0, 16));
  // flag byte (offset 16) defaults to 0 (public tunnel)
  // rsv bytes (offset 17-18) default to 0
  // weight byte (offset 19) defaults to 0
  return id;
}
