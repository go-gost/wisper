/**
 * offscreen.js — persistent tunnel host for Wisper Chrome Extension.
 *
 * Runs in an offscreen document (Manifest V3). The offscreen document is
 * long-lived — it is not terminated by Chrome's 30s service worker idle
 * timeout. It hosts:
 *
 *   - TunnelConnection instances (WebSocket + relay + SMUX)
 *   - HTTP/WebSocket forwarding to a local backend (see lib/forwarder.js)
 *   - Reconnection with exponential backoff
 *
 * Communication: service worker ↔ offscreen via chrome.runtime.sendMessage().
 *
 * The request-forwarding logic lives in lib/forwarder.js (pure, no chrome
 * dependency) so it can be unit/integration tested in Node.
 */

import { TunnelConnection } from './lib/tunnel-connection.js';
import { handleRequest } from './lib/forwarder.js';
import { uuidToTunnelIdBytes, entrypointFromUuid } from './lib/tunnel-id.js';
import { TunnelStats } from './lib/tunnel-stats.js';

// ── State ──────────────────────────────────────────────────────────────

// Version banner — if you DON'T see this line in the offscreen console after a
// reload, you are running stale code. Host rewrite ships via lib/forwarder.js
// (fetch FROM the hostname), so the fetch URL for a Host-Rewrite tunnel must
// read http://<hostname>/<path>, NOT http://192.168.100.200:80/<path>.
console.log('Wisper offscreen loaded — build=host-via-url (2026-07-11)');

/** Map<tunnelId, { config, connection, reconnectTimer }> */
const tunnels = new Map();

/** Set of tunnelIds with an in-flight startTunnel() — prevents duplicate
 * processing when both the sidepanel and the background worker forward the
 * same start-tunnel message (MV3 chrome.runtime.sendMessage broadcasts). */
const _pendingStarts = new Set();

/** Shared 1s sampling timer for all tunnels. null when no tunnel is active. */
let _statsTimer = null;

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

    case 'reset-stats': {
      const entry = tunnels.get(msg.tunnelId);
      if (entry) {
        entry.stats?.reset();
        notifyStats(msg.tunnelId, entry.stats.sample(1));
      }
      sendResponse({ ok: true });
      break;
    }

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

  // Ignore duplicate start-tunnel messages. In MV3, chrome.runtime.sendMessage
  // broadcasts to all listeners — the sidepanel's message reaches both the
  // background worker AND this offscreen document directly. The background
  // then also forwards it here, causing a double delivery. Without this guard,
  // the second invocation calls stopTunnel() which closes the in-flight
  // WebSocket from the first, and conn.connect() rejects with the "Websocket
  // connect failed" error the user sees.
  if (_pendingStarts.has(tunnelId)) return;
  _pendingStarts.add(tunnelId);

  if (tunnels.has(tunnelId)) {
    // Already running — restart
    stopTunnel(tunnelId);
  }

  const entry = { config, connection: null, reconnectTimer: null, stats: new TunnelStats() };
  tunnels.set(tunnelId, entry);
  startStatsSampler();

  connect(entry).finally(() => _pendingStarts.delete(tunnelId));
}

function stopTunnel(tunnelId) {
  const entry = tunnels.get(tunnelId);
  if (!entry) return;

  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }

  entry.stats?.reset();

  // Delete from map BEFORE closing the connection. TunnelConnection.close()
  // triggers onClose synchronously (via _onSmuxClose → onClose callback).
  // onClose checks tunnels.has() to decide whether to reconnect — removing
  // the entry first prevents a spurious reconnect after an intentional stop.
  tunnels.delete(tunnelId);
  if (tunnels.size === 0) stopStatsSampler();

  if (entry.connection) {
    entry.connection.close();
    entry.connection = null;
  }

  notifyStatus(tunnelId, 'stopped');
}

async function connect(entry) {
  const { config } = entry;

  notifyStatus(config.tunnelId, 'connecting');

  // Entrypoint: https://{md5(uuid)}.{domain} — matches Go's entrypoint derivation.
  const entrypointDomain = config.entrypointDomain || 'gost.run';
  const entrypointUrl = entrypointFromUuid(config.tunnelId, entrypointDomain);

  const conn = new TunnelConnection({
    tunnelId: config.tunnelIdBytes
      ? new Uint8Array(config.tunnelIdBytes)
      : uuidToTunnelIdBytes(config.tunnelId),
    localEndpoint: config.localEndpoint,
    auth: config.auth || {},
    relayUrl: config.relayUrl,
    entrypointUrl,
    wrapStream: (stream) => entry.stats.wrapStream(stream),
    onStream: ({ stream, request }) => {
      entry.stats.markRequest();
      handleRequest(stream, request, config);
    },
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

function notifyStats(tunnelId, stats) {
  chrome.runtime.sendMessage({
    type: 'tunnel-stats',
    tunnelId,
    stats,
  }).catch(() => {
    // Service worker or side panel not open — ignore
  });
}

function sampleAllStats() {
  for (const [id, entry] of tunnels) {
    if (!entry.connection?.connected) {
      // Keep baseline fresh even while disconnected, to avoid rate spikes
      // on reconnect when no bytes have flowed.
      entry.stats.sample(1);
      continue;
    }
    const snapshot = entry.stats.sample(1);
    notifyStats(id, snapshot);
  }
}

function startStatsSampler() {
  if (_statsTimer !== null) return;
  _statsTimer = setInterval(sampleAllStats, 1000);
}

function stopStatsSampler() {
  if (_statsTimer === null) return;
  clearInterval(_statsTimer);
  _statsTimer = null;
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
