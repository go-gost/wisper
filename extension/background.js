/**
 * background.js — Service worker coordinator for Wisper Chrome Extension.
 *
 * Responsibilities:
 *   - Create and manage the offscreen document (persistent tunnel host)
 *   - Relay commands from side panel → offscreen document
 *   - Relay status updates from offscreen document → side panel
 *   - Persist tunnel configs to chrome.storage.local
 *   - Keepalive alarm to detect and report offscreen termination
 */

// ── Offscreen document lifecycle ────────────────────────────────────────

const OFFSCREEN_DOC_PATH = 'offscreen.html';
let offscreenCreating = null; // Promise to avoid concurrent creation

/** Throttle timer for stats persistence to chrome.storage (max every 3s). */
let _lastStatsPersist = 0;

async function ensureOffscreen() {
  // Check if already exists
  const clients = await chrome.offscreen.hasDocument();
  if (clients) return;

  // Avoid concurrent creation
  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOC_PATH,
    reasons: ['DOM_PARSER'],  // ponytail: DOM_PARSER is a valid MV3 offscreen reason
    justification: 'Persistent WebSocket connection for GOST tunnel relay',
  });

  try {
    await offscreenCreating;
  } finally {
    offscreenCreating = null;
  }
}

async function closeOffscreen() {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // May already be closed — ignore
  }
}

// ── Message routing ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'start-tunnel':
      handleStartTunnel(msg.config);
      sendResponse({ ok: true });
      break;

    case 'stop-tunnel':
      handleStopTunnel(msg.tunnelId);
      sendResponse({ ok: true });
      break;

    case 'tunnel-status':
      // Forwarded from offscreen → side panel
      handleTunnelStatus(msg);
      sendResponse({ ok: true });
      break;

    case 'tunnel-stats':
      handleTunnelStats(msg);
      sendResponse({ ok: true });
      break;

    case 'load-tunnels':
      chrome.storage.local.get('tunnels', (data) => {
        sendResponse({ tunnels: data.tunnels || [] });
      });
      return true; // Keep sendResponse alive for async callback
  }
  return false;
});

// ── DNR hostname rewrite ─────────────────────────────────────────────
//
// Host header cannot be set via fetch() (forbidden header per Fetch spec),
// so we use chrome.declarativeNetRequest to modify it on outgoing requests
// made by the offscreen document.
//
// Rule IDs 10000-19999 are reserved for Wisper hostname rewriting (per-tunnel marker rules).
// Rule IDs 20000-29999 are reserved for Wisper hostname fallback rules (endpoint-based).

/** Deterministic rule ID from a tunnelId within our reserved range. */
function _dnrRuleId(tunnelId) {
  let h = 0;
  for (let i = 0; i < tunnelId.length; i++) {
    h = (Math.imul(31, h) + tunnelId.charCodeAt(i)) | 0;
  }
  return 10000 + ((h >>> 0) % 10000);
}

/** Fallback rule ID for the same tunnel (same hash offset, different base). */
function _dnrFallbackRuleId(tunnelId) {
  let h = 0;
  for (let i = 0; i < tunnelId.length; i++) {
    h = (Math.imul(31, h) + tunnelId.charCodeAt(i)) | 0;
  }
  return 20000 + ((h >>> 0) % 10000);
}

/**
 * Build the old-style host+port anchored urlFilter for the fallback rule.
 * This matches the normalized URL without needing the per-tunnel marker,
 * so host rewrite works even when the marker isn't present in the URL.
 */
function _fallbackUrlFilter(localEndpoint, enableTLS) {
  let host = localEndpoint;
  let port = '';
  const bracket = localEndpoint.lastIndexOf(']');
  const colon = localEndpoint.lastIndexOf(':');
  if (colon > bracket) {
    host = localEndpoint.slice(0, colon);
    port = localEndpoint.slice(colon + 1);
  }
  const defaultPort = enableTLS ? '443' : '80';
  if (!port || port === defaultPort) {
    return `://${host}/`;
  }
  return `://${host}:${port}`;
}

/**
 * Per-tunnel URL marker used to disambiguate DNR rules.
 *
 * DNR matches purely on the request URL, so when two tunnels forward to the
 * SAME local backend (the normal use case for host rewrite — one backend
 * serving several virtual hosts) their rules would collide on an identical
 * urlFilter and one Host value would win globally. The forwarder tags each
 * request with this marker in the query string; the matching DNR rule embeds
 * the same marker so the two rules no longer overlap.
 *
 * Keep this formula in sync with lib/forwarder.js (_dnrMarker).
 */
function _dnrMarker(tunnelId) {
  return tunnelId.replace(/-/g, '');
}

async function setHostnameDNR(tunnelId, localEndpoint, hostname, enableTLS) {
  // Host rewrite no longer uses declarativeNetRequest. DNR treats `Host` as a
  // protected header and silently refuses to override it (fetch() forbids
  // setting Host for the same reason), so the DNR approach never worked. Host
  // rewriting is now done in lib/forwarder.js by fetching FROM the configured
  // hostname (fetch() derives Host from the URL). We keep this call site as a
  // no-op that just removes any stale rules installed by an older version so
  // they don't linger on upgraded installs.
  if (!hostname) return;
  try {
    await removeHostnameDNR(tunnelId);
  } catch { /* DNR unavailable or no rules — ignore */ }
}

async function removeHostnameDNR(tunnelId) {
  const removeRuleIds = [_dnrRuleId(tunnelId), _dnrFallbackRuleId(tunnelId)];
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });
  } catch { /* ignore */ }
}

/** Clean up stale Wisper DNR rules and re-install for active tunnels. */
async function syncHostnameDNR() {
  const stored = await chrome.storage.local.get('tunnels');
  const tunnels = stored.tunnels || [];
  const activeHostnameTunnels = tunnels.filter(
    t => t.hostname && (t.status === 'running' || t.status === 'connecting')
  );
  const activeMarkerIds = new Set(activeHostnameTunnels.map(t => _dnrRuleId(t.tunnelId)));
  const activeFallbackIds = new Set(activeHostnameTunnels.map(t => _dnrFallbackRuleId(t.tunnelId)));
  const allRules = await chrome.declarativeNetRequest.getDynamicRules();
  const stale = allRules
    .filter(r => {
      if (r.id >= 10000 && r.id < 20000) return !activeMarkerIds.has(r.id);
      if (r.id >= 20000 && r.id < 30000) return !activeFallbackIds.has(r.id);
      return false;
    })
    .map(r => r.id);
  if (stale.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: stale, addRules: [] });
  }
  // Re-install rules for active tunnels
  for (const t of activeHostnameTunnels) {
    await setHostnameDNR(t.tunnelId, t.localEndpoint, t.hostname, t.enableTLS);
  }
}

// ── Tunnel lifecycle ───────────────────────────────────────────────────

async function handleStartTunnel(config) {
  const tunnelId = config.tunnelId || crypto.randomUUID();
  config.tunnelId = tunnelId;

  // Persist to storage
  const stored = await chrome.storage.local.get('tunnels');
  const saved = stored.tunnels || [];
  const idx = saved.findIndex(t => t.tunnelId === tunnelId);
  if (idx >= 0) {
    saved[idx] = { ...saved[idx], ...config };
  } else {
    saved.push(config);
  }
  await chrome.storage.local.set({ tunnels: saved });

  // Install DNR rule for hostname rewrite BEFORE offscreen starts fetching
  if (config.hostname) {
    await setHostnameDNR(tunnelId, config.localEndpoint, config.hostname, config.enableTLS);
  }

  // Ensure offscreen document exists
  await ensureOffscreen();

  // Forward to offscreen
  chrome.runtime.sendMessage({ type: 'start-tunnel', config });
}

async function handleStopTunnel(tunnelId) {
  // Remove DNR rule for hostname rewrite
  await removeHostnameDNR(tunnelId);

  // Preserve config but mark as stopped
  const stored = await chrome.storage.local.get('tunnels');
  const saved = (stored.tunnels || []).map(t =>
    t.tunnelId === tunnelId ? { ...t, status: 'stopped', entrypoint: null, error: null } : t
  );
  await chrome.storage.local.set({ tunnels: saved });

  // Forward to offscreen
  chrome.runtime.sendMessage({ type: 'stop-tunnel', tunnelId });

  // If no running/connecting/error tunnels remain, close offscreen
  const alive = saved.filter(t => t.status !== 'stopped');
  if (alive.length === 0) {
    closeOffscreen();
  }
}

function handleTunnelStatus(msg) {
  // Persist status to storage so it survives popup closure
  chrome.storage.local.get('tunnels', (data) => {
    const saved = (data.tunnels || []).map(t =>
      t.tunnelId === msg.tunnelId
        ? { ...t, status: msg.status, error: msg.error || null, entrypoint: msg.entrypoint || null }
        : t
    );
    chrome.storage.local.set({ tunnels: saved });
  });

  // Forward to side panel if open
  chrome.runtime.sendMessage(msg).catch(() => {
    // Side panel not open — ignore
  });
}

function handleTunnelStats(msg) {
  // Always re-broadcast to side panel (if open).
  chrome.runtime.sendMessage(msg).catch(() => {});

  // Throttle storage writes to every 3s to avoid quota churn.
  const now = Date.now();
  if (now - _lastStatsPersist < 3000) return;
  _lastStatsPersist = now;

  chrome.storage.local.get('tunnels', (data) => {
    const saved = (data.tunnels || []).map(t =>
      t.tunnelId === msg.tunnelId
        ? { ...t, stats: msg.stats }
        : t
    );
    chrome.storage.local.set({ tunnels: saved });
  });
}

// ── Keepalive ──────────────────────────────────────────────────────────

chrome.alarms.create('keepalive', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    // Check offscreen health — if it's gone, reconnect running tunnels
    chrome.offscreen.hasDocument().then(has => {
      if (!has) {
        chrome.storage.local.get('tunnels', (data) => {
          const tunnels = data.tunnels || [];
          const running = tunnels.filter(t => t.status !== 'stopped');
          if (running.length > 0) {
            console.warn('Wisper: offscreen document lost, restarting tunnels');
            for (const t of running) {
              handleStartTunnel(t);
            }
          }
        });
      }
    });
  }
});

// ── Startup: sync DNR rules and auto-start tunnels ─────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await syncHostnameDNR();
  const stored = await chrome.storage.local.get('tunnels');
  const tunnels = stored.tunnels || [];
  const running = tunnels.filter(t => t.status !== 'stopped');
  for (const t of running) {
    handleStartTunnel(t);
  }
});

// Service worker must call keepAlive check on start
chrome.runtime.onStartup.addListener(async () => {
  await syncHostnameDNR();
  const stored = await chrome.storage.local.get('tunnels');
  const tunnels = stored.tunnels || [];
  for (const t of tunnels) {
    if (t.status !== 'stopped') {
      handleStartTunnel(t);
    }
  }
});
