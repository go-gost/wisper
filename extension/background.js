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

  // Ensure offscreen document exists
  await ensureOffscreen();

  // Forward to offscreen
  chrome.runtime.sendMessage({ type: 'start-tunnel', config });
}

async function handleStopTunnel(tunnelId) {
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

// ── Startup: auto-start tunnels that were running ──────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get('tunnels');
  const tunnels = stored.tunnels || [];
  const running = tunnels.filter(t => t.status !== 'stopped');
  for (const t of running) {
    handleStartTunnel(t);
  }
});

// Service worker must call keepAlive check on start
chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get('tunnels');
  const tunnels = stored.tunnels || [];
  for (const t of tunnels) {
    if (t.status !== 'stopped') {
      handleStartTunnel(t);
    }
  }
});
