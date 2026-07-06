/**
 * sidepanel.js — Management UI for Wisper Chrome Extension.
 *
 * Communicates with the service worker (background.js) to manage tunnels.
 * Uses DOM manipulation with textContent for safe rendering.
 */

// ── State ──────────────────────────────────────────────────────────────

let tunnels = [];
let settings = { relayUrl: '', username: '', password: '' };
let showCreate = false;
let showSettings = false;

// ── Init ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadSettings();
  loadTunnels();
  render();

  // Listen for tunnel status updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'tunnel-status') {
      updateTunnelStatus(msg.tunnelId, msg.status, msg.error, msg.entrypoint);
    }
  });
});

// ── Data ───────────────────────────────────────────────────────────────

function loadTunnels() {
  chrome.runtime.sendMessage({ type: 'load-tunnels' }, (resp) => {
    tunnels = (resp && resp.tunnels) || [];
    render();
  });
}

function loadSettings() {
  chrome.storage.local.get('settings', (data) => {
    if (data.settings) settings = { ...settings, ...data.settings };
    render();
  });
}

function saveSettings() {
  chrome.storage.local.set({ settings });
}

// ── Actions ────────────────────────────────────────────────────────────

function startTunnel(name, port) {
  const config = {
    tunnelId: crypto.randomUUID(),
    name: name || `tunnel-${port}`,
    localEndpoint: `localhost:${port}`,
    relayUrl: settings.relayUrl || undefined,
    auth: settings.username ? { username: settings.username, password: settings.password } : undefined,
  };

  tunnels.push({ ...config, status: 'connecting' });
  render();
  chrome.runtime.sendMessage({ type: 'start-tunnel', config });
}

function stopTunnel(tunnelId) {
  chrome.runtime.sendMessage({ type: 'stop-tunnel', tunnelId });
}

function updateTunnelStatus(tunnelId, status, error, entrypoint) {
  const t = tunnels.find(t => t.tunnelId === tunnelId);
  if (t) {
    t.status = status;
    if (error) t.error = error;
    if (entrypoint) t.entrypoint = entrypoint;
  }
  render();
}

// ── Render (DOM-based, no innerHTML) ───────────────────────────────────

function render() {
  renderTunnelList();
  renderCreateSection();
  renderSettings();
}

function renderTunnelList() {
  const el = document.getElementById('tunnel-list');
  // Clear existing children
  while (el.firstChild) el.removeChild(el.firstChild);

  if (tunnels.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No tunnels yet. Create one below.';
    el.appendChild(empty);
    return;
  }

  for (const t of tunnels) {
    el.appendChild(buildTunnelCard(t));
  }
}

function buildTunnelCard(t) {
  const card = document.createElement('div');
  card.className = 'card';

  // Header: name + status badge
  const header = document.createElement('div');
  header.className = 'card-header';

  const title = document.createElement('span');
  title.className = 'card-title';
  title.textContent = t.name || t.tunnelId;
  header.appendChild(title);

  const badge = document.createElement('span');
  badge.className = `badge badge-${t.status}`;
  badge.textContent = t.status;
  header.appendChild(badge);
  card.appendChild(header);

  // Local endpoint
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.textContent = t.localEndpoint;
  card.appendChild(meta);

  // Entrypoint URL
  if (t.entrypoint) {
    const ep = document.createElement('div');
    ep.className = 'entrypoint';
    ep.textContent = t.entrypoint;
    card.appendChild(ep);
  }

  // Error
  if (t.error) {
    const err = document.createElement('div');
    err.className = 'card-meta';
    err.style.color = 'var(--red)';
    err.textContent = t.error;
    card.appendChild(err);
  }

  // Actions row
  const actions = document.createElement('div');
  actions.className = 'flex-row';
  actions.style.marginTop = '8px';

  if (t.status === 'running') {
    const stopBtn = document.createElement('button');
    stopBtn.className = 'btn btn-danger btn-small';
    stopBtn.textContent = 'Stop';
    stopBtn.addEventListener('click', () => stopTunnel(t.tunnelId));
    actions.appendChild(stopBtn);
  } else {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn btn-ghost btn-small';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'start-tunnel', config: t });
    });
    actions.appendChild(retryBtn);
  }

  // Spacer
  const spacer = document.createElement('div');
  spacer.className = 'flex-grow';
  actions.appendChild(spacer);

  // Delete
  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-ghost btn-small';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', () => {
    stopTunnel(t.tunnelId);
    tunnels = tunnels.filter(x => x.tunnelId !== t.tunnelId);
    render();
  });
  actions.appendChild(delBtn);

  card.appendChild(actions);
  return card;
}

function renderCreateSection() {
  const section = document.getElementById('create-section');
  section.classList.toggle('hidden', !showCreate);
  document.getElementById('btn-show-create').classList.toggle('hidden', showCreate);
}

function renderSettings() {
  const section = document.getElementById('settings-section');
  section.classList.toggle('hidden', !showSettings);
  document.getElementById('settings-relay').value = settings.relayUrl || '';
  document.getElementById('settings-username').value = settings.username || '';
  document.getElementById('settings-password').value = settings.password || '';
}

// ── Events ─────────────────────────────────────────────────────────────

function bindEvents() {
  document.getElementById('btn-show-create').addEventListener('click', () => {
    showCreate = true;
    render();
  });

  document.getElementById('btn-cancel-create').addEventListener('click', () => {
    showCreate = false;
    render();
  });

  document.getElementById('btn-create').addEventListener('click', () => {
    const name = document.getElementById('new-name').value.trim();
    const port = parseInt(document.getElementById('new-port').value, 10);
    if (!port || port < 1 || port > 65535) {
      alert('Please enter a valid port (1–65535)');
      return;
    }
    startTunnel(name, port);
    document.getElementById('new-name').value = '';
    document.getElementById('new-port').value = '';
    showCreate = false;
    render();
  });

  document.getElementById('btn-toggle-settings').addEventListener('click', () => {
    showSettings = !showSettings;
    render();
  });

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    settings.relayUrl = document.getElementById('settings-relay').value.trim();
    settings.username = document.getElementById('settings-username').value.trim();
    settings.password = document.getElementById('settings-password').value.trim();
    saveSettings();
    showSettings = false;
    render();
  });
}
