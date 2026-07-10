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
// Rule IDs 10000-19999 are reserved for Wisper hostname rewriting.

/** Deterministic rule ID from a tunnelId within our reserved range. */
function _dnrRuleId(tunnelId) {
  let h = 0;
  for (let i = 0; i < tunnelId.length; i++) {
    h = (Math.imul(31, h) + tunnelId.charCodeAt(i)) | 0;
  }
  return 10000 + ((h >>> 0) % 10000);
}

/**
 * Build the DNR urlFilter for a local endpoint.
 *
 * The browser normalizes fetch() URLs (WHATWG URL parser) BEFORE DNR matching,
 * which strips the default port for the scheme (:80 for http, :443 for https).
 * So a rule like "://host:80" never matches the normalized "http://host/path".
 * We must strip the default port here to mirror that normalization.
 */
function _dnrUrlFilter(localEndpoint, enableTLS) {
  let host = localEndpoint;
  let port = '';
  // Split host:port, guarding IPv6 literals like [::1]:80.
  const bracket = localEndpoint.lastIndexOf(']');
  const colon = localEndpoint.lastIndexOf(':');
  if (colon > bracket) {
    host = localEndpoint.slice(0, colon);
    port = localEndpoint.slice(colon + 1);
  }
  const defaultPort = enableTLS ? '443' : '80';
  if (!port || port === defaultPort) {
    // Default (or absent) port is dropped from the normalized URL. Anchor with
    // a trailing "/" so "://host/" cannot substring-match a longer host.
    return `://${host}/`;
  }
  return `://${host}:${port}`;
}

async function setHostnameDNR(tunnelId, localEndpoint, hostname, enableTLS) {
  if (!hostname) return;
  const ruleId = _dnrRuleId(tunnelId);
  const urlFilter = _dnrUrlFilter(localEndpoint, enableTLS);
  console.log('Wisper: installing DNR rule', { ruleId, localEndpoint, hostname, urlFilter });
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId],
      addRules: [{
        id: ruleId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'host', operation: 'set', value: hostname }],
        },
        condition: {
          urlFilter,
          resourceTypes: ['xmlhttprequest'],
        },
      }],
    });
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    console.log('Wisper: DNR rule installed, current dynamic rules:', rules.map(r => ({ id: r.id, urlFilter: r.condition.urlFilter })));
  } catch (e) {
    console.error('Wisper: DNR rule failed', e);
  }
}

async function removeHostnameDNR(tunnelId) {
  const ruleId = _dnrRuleId(tunnelId);
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId],
      addRules: [],
    });
  } catch { /* ignore */ }
}

/** Clean up stale Wisper DNR rules and re-install for active tunnels. */
async function syncHostnameDNR() {
  const stored = await chrome.storage.local.get('tunnels');
  const tunnels = stored.tunnels || [];
  const activeIds = new Set(
    tunnels.filter(t => t.hostname).map(t => _dnrRuleId(t.tunnelId)),
  );
  const allRules = await chrome.declarativeNetRequest.getDynamicRules();
  const stale = allRules
    .filter(r => r.id >= 10000 && r.id < 20000 && !activeIds.has(r.id))
    .map(r => r.id);
  if (stale.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: stale, addRules: [] });
  }
  // Re-install rules for active tunnels
  for (const t of tunnels) {
    if (t.hostname && (t.status === 'running' || t.status === 'connecting')) {
      await setHostnameDNR(t.tunnelId, t.localEndpoint, t.hostname, t.enableTLS);
    }
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
