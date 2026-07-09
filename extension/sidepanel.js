/**
 * sidepanel.js — Popup management UI for Wisper Chrome Extension.
 *
 * Faithfully replicates the web UI (Lit) using DOM manipulation.
 * Communicates with background.js service worker for tunnel lifecycle.
 */

// ── State ──────────────────────────────────────────────────────────────

/** @type {Array<{tunnelId:string,name:string,localEndpoint:string,relayUrl?:string,auth?:{username:string,password:string},status:string,error?:string,entrypoint?:string,createdAt:string,hostname?:string,enableTLS?:boolean}>} */
let tunnels = [];
let settings = { relayUrl: '', username: '', password: '' };
let currentView = 'list'; // 'list' | 'form' | 'settings'
let editingId = null;       // tunnelId being edited, or null for create
let formSaving = false;
let expandedMap = {};       // { [tunnelId]: true/false }
let deletingId = null;      // tunnelId pending delete confirmation

// ── Init ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadTunnels();
  bindEvents();

  // Listen for tunnel status updates forwarded by background.js
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'tunnel-status') {
      updateTunnelStatus(msg.tunnelId, msg.status, msg.error, msg.entrypoint);
    }
  });
});

// ── Data loading ───────────────────────────────────────────────────────

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

function persistTunnels() {
  chrome.storage.local.set({ tunnels: tunnels.map(t => ({
    tunnelId: t.tunnelId,
    name: t.name,
    localEndpoint: t.localEndpoint,
    relayUrl: t.relayUrl,
    auth: t.auth,
    status: t.status,
    error: t.error,
    entrypoint: t.entrypoint,
    createdAt: t.createdAt,
    hostname: t.hostname,
    enableTLS: t.enableTLS,
  })) });
}

// ── View switching ─────────────────────────────────────────────────────

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const map = { list: 'viewList', form: 'viewForm', settings: 'viewSettings' };
  const target = document.getElementById(map[view]);
  if (target) target.classList.add('active');
}

// ── Tunnel actions ─────────────────────────────────────────────────────

function createTunnel(data) {
  const tunnelId = crypto.randomUUID();
  const tunnel = {
    tunnelId,
    name: data.name.trim() || `tunnel-${data.endpoint.split(':').pop() || '0'}`,
    localEndpoint: data.endpoint.trim(),
    relayUrl: settings.relayUrl || undefined,
    auth: settings.username ? { username: settings.username, password: settings.password } : undefined,
    status: 'stopped',
    error: null,
    entrypoint: null,
    createdAt: new Date().toISOString(),
    hostname: data.hostname || '',
    enableTLS: !!data.enableTLS,
  };

  tunnels.push(tunnel);
  persistTunnels();
  render();
  showToast('Tunnel created');

  // Auto-start
  startTunnel(tunnelId);
}

function startTunnel(tunnelId) {
  const t = tunnels.find(x => x.tunnelId === tunnelId);
  if (!t) return;
  t.status = 'connecting';
  render();
  chrome.runtime.sendMessage({
    type: 'start-tunnel',
    config: {
      tunnelId: t.tunnelId,
      name: t.name,
      localEndpoint: t.localEndpoint,
      relayUrl: t.relayUrl || undefined,
      auth: t.auth,
      hostname: t.hostname || undefined,
      enableTLS: t.enableTLS || false,
    },
  });
}

function stopTunnel(tunnelId) {
  const t = tunnels.find(x => x.tunnelId === tunnelId);
  if (t) {
    t.status = 'stopped';
    t.entrypoint = null;
    t.error = null;
  }
  render();
  chrome.runtime.sendMessage({ type: 'stop-tunnel', tunnelId });
  persistTunnels();
}

function updateTunnelStatus(tunnelId, status, error, entrypoint) {
  const t = tunnels.find(x => x.tunnelId === tunnelId);
  if (!t) return;
  t.status = status;
  if (error !== undefined && error !== null) t.error = error;
  if (entrypoint !== undefined && entrypoint !== null) t.entrypoint = entrypoint;
  persistTunnels();
  render();
}

function deleteTunnel(tunnelId) {
  // Stop first
  chrome.runtime.sendMessage({ type: 'stop-tunnel', tunnelId });
  tunnels = tunnels.filter(x => x.tunnelId !== tunnelId);
  persistTunnels();
  render();
  showToast('Tunnel deleted');
}

function saveForm() {
  if (formSaving) return;

  const name = document.getElementById('fName').value;
  const endpoint = document.getElementById('fEndpoint').value;
  if (!endpoint.trim()) {
    showToast('Target is required');
    return;
  }

  formSaving = true;
  const saveBtn = document.getElementById('formSave');
  saveBtn.disabled = true;

  try {
    const hostname = document.getElementById('fHostname').value;
    const enableTLS = document.getElementById('fTLS').classList.contains('on');
    const hasAuth = document.getElementById('fAuth').classList.contains('on');
    const username = hasAuth ? document.getElementById('fUsername').value : '';
    const password = hasAuth ? document.getElementById('fPassword').value : '';

    const formData = {
      name: name.trim() || undefined,
      endpoint: endpoint.trim(),
      hostname: hostname.trim() || undefined,
      enableTLS,
      username: username.trim() || undefined,
      password: password || undefined,
    };

    if (editingId) {
      // Edit mode: stop old, update config, optionally restart
      const oldTunnel = tunnels.find(x => x.tunnelId === editingId);
      if (oldTunnel) {
        const wasRunning = oldTunnel.status === 'running' || oldTunnel.status === 'connecting';
        // Stop if running
        if (oldTunnel.status === 'running' || oldTunnel.status === 'connecting' || oldTunnel.status === 'error') {
          chrome.runtime.sendMessage({ type: 'stop-tunnel', tunnelId: editingId });
        }
        // Update in-place
        oldTunnel.name = formData.name || oldTunnel.name;
        oldTunnel.localEndpoint = formData.endpoint;
        oldTunnel.hostname = formData.hostname;
        oldTunnel.enableTLS = !!formData.enableTLS;
        oldTunnel.auth = formData.username
          ? { username: formData.username, password: formData.password || '' }
          : undefined;
        oldTunnel.status = 'stopped';
        oldTunnel.error = null;
        oldTunnel.entrypoint = null;
        persistTunnels();

        // Restart if it was running
        if (wasRunning) {
          startTunnel(editingId);
        }
      }
      showToast('Tunnel updated');
    } else {
      // Create mode
      createTunnel(formData);
    }

    switchView('list');
  } finally {
    formSaving = false;
    saveBtn.disabled = false;
  }
}

// ── Clipboard ──────────────────────────────────────────────────────────

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard');
    }).catch(() => {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('Copied to clipboard');
  } catch { /* ignore */ }
  document.body.removeChild(ta);
}

// ── Toast ──────────────────────────────────────────────────────────────

let toastTimer = null;

function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'toast-in 0.25s ease';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.display = 'none';
  }, 2500);
}

// ── Dialog ─────────────────────────────────────────────────────────────

function showDeleteDialog(tunnelId) {
  deletingId = tunnelId;
  const t = tunnels.find(x => x.tunnelId === tunnelId);
  const msgEl = document.getElementById('deleteMsg');
  if (msgEl) {
    msgEl.textContent = `Are you sure you want to delete "${t ? t.name : tunnelId}"?`;
  }
  document.getElementById('deleteDialog').style.display = 'flex';
}

function hideDeleteDialog() {
  deletingId = null;
  document.getElementById('deleteDialog').style.display = 'none';
}

// ── Format utilities ───────────────────────────────────────────────────

function formatRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return '0m';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return '0m';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return `${Math.floor(day / 7)}w`;
}

// ── SVG icon helpers ───────────────────────────────────────────────────

const ICONS = {
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
};

function iconSvg(name, w = 14, h = 14) {
  const path = ICONS[name];
  if (!path) return '';
  return `<svg width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

// ── Render ─────────────────────────────────────────────────────────────

function render() {
  renderTunnelList();
  setActiveView();
}

function setActiveView() {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const map = { list: 'viewList', form: 'viewForm', settings: 'viewSettings' };
  const target = document.getElementById(map[currentView]);
  if (target) target.classList.add('active');
}

// ── Tunnel list ────────────────────────────────────────────────────────

function renderTunnelList() {
  const container = document.getElementById('cardsContainer');
  const emptyState = document.getElementById('emptyState');
  // Clear list (keep empty state)
  while (container.firstChild) container.removeChild(container.firstChild);

  if (tunnels.length === 0) {
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  // Sort: running/connecting first, then by createdAt desc
  const sorted = [...tunnels].sort((a, b) => {
    const order = { running: 0, connecting: 1, error: 2, stopped: 3 };
    const diff = (order[a.status] || 9) - (order[b.status] || 9);
    if (diff !== 0) return diff;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  for (const t of sorted) {
    container.appendChild(buildCard(t));
  }
}

function buildCard(t) {
  const wrapper = document.createElement('div');

  // ── Card row (clickable, matches tunnel-card.ts .row) ──
  const row = document.createElement('div');
  row.className = `tunnel-card-row ${t.status === 'stopped' ? 'stopped' : ''}`;

  // Status dot
  const dot = document.createElement('span');
  dot.className = `status-dot ${t.status}`;
  row.appendChild(dot);

  // Body
  const body = document.createElement('div');
  body.className = 'card-body';

  const nameEl = document.createElement('div');
  nameEl.className = 'card-name';
  nameEl.textContent = t.name || t.tunnelId;
  body.appendChild(nameEl);

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.textContent = `HTTP · ${t.status === 'running' ? 'Connected' : t.status.charAt(0).toUpperCase() + t.status.slice(1)}`;
  body.appendChild(meta);

  row.appendChild(body);

  // Right side
  const right = document.createElement('div');
  right.className = 'card-right';

  const timeEl = document.createElement('div');
  timeEl.className = 'card-time';
  timeEl.textContent = formatRelativeTime(t.createdAt);
  right.appendChild(timeEl);

  if (t.status === 'running') {
    const traffic = document.createElement('div');
    traffic.className = 'card-traffic';
    traffic.innerHTML = '<div class="card-traffic-row"><span class="card-traffic-total">&uarr;&darr; active</span></div>';
    right.appendChild(traffic);
  }

  row.appendChild(right);

  // Chevron
  const chev = document.createElement('span');
  chev.className = `card-chevron ${expandedMap[t.tunnelId] ? 'open' : ''}`;
  chev.innerHTML = iconSvg('chevron-right', 16, 16);
  chev.addEventListener('click', (e) => {
    e.stopPropagation();
    expandedMap[t.tunnelId] = !expandedMap[t.tunnelId];
    const panel = wrapper.querySelector('.expand-panel');
    chev.classList.toggle('open', expandedMap[t.tunnelId]);
    if (panel) panel.classList.toggle('open', expandedMap[t.tunnelId]);
  });
  row.appendChild(chev);

  wrapper.appendChild(row);

  // ── Error banner ──
  if (t.error) {
    const errEl = document.createElement('div');
    errEl.className = 'card-error';
    errEl.textContent = t.error;
    wrapper.appendChild(errEl);
  }

  // ── Expand panel (matches home-page.ts) ──
  const expand = document.createElement('div');
  expand.className = `expand-panel ${expandedMap[t.tunnelId] ? 'open' : ''}`;

  // Entrypoint row
  if (t.entrypoint) {
    const epRow = expandRow('Entrypoint', t.entrypoint, true);
    expand.appendChild(epRow);
  }

  // Target row
  const targetRow = expandRow('Target', t.localEndpoint, true);
  expand.appendChild(targetRow);

  // Hostname row (if set)
  if (t.hostname) {
    const hnRow = expandRow('Hostname', t.hostname, false);
    expand.appendChild(hnRow);
  }

  // Auth row (if set)
  if (t.auth && t.auth.username) {
    const authRow = expandRow('Auth', `Basic · ${t.auth.username}`, false);
    expand.appendChild(authRow);
  }

  // Actions (matches home-page.ts action-btn)
  const actions = document.createElement('div');
  actions.className = 'expand-actions';

  if (t.status === 'running' || t.status === 'connecting') {
    const stopBtn = document.createElement('button');
    stopBtn.className = 'action-btn stop';
    stopBtn.innerHTML = '■ Stop';
    stopBtn.addEventListener('click', (e) => { e.stopPropagation(); stopTunnel(t.tunnelId); });
    actions.appendChild(stopBtn);
  } else {
    const startBtn = document.createElement('button');
    startBtn.className = 'action-btn start';
    startBtn.innerHTML = '▶ Start';
    startBtn.addEventListener('click', (e) => { e.stopPropagation(); startTunnel(t.tunnelId); });
    actions.appendChild(startBtn);
  }

  // Edit button
  const editBtn = document.createElement('button');
  editBtn.className = 'action-btn';
  editBtn.innerHTML = iconSvg('edit', 14, 14) + ' Edit';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditForm(t.tunnelId);
  });
  actions.appendChild(editBtn);

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.className = 'action-btn danger';
  delBtn.innerHTML = iconSvg('trash', 14, 14) + ' Delete';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showDeleteDialog(t.tunnelId);
  });
  actions.appendChild(delBtn);

  expand.appendChild(actions);
  wrapper.appendChild(expand);

  // ── Click row to toggle expand ──
  row.addEventListener('click', (e) => {
    // Don't toggle when clicking buttons inside the expand panel
    if (e.target.closest('.action-btn') || e.target.closest('.copy-btn')) return;
    expandedMap[t.tunnelId] = !expandedMap[t.tunnelId];
    chev.classList.toggle('open', expandedMap[t.tunnelId]);
    expand.classList.toggle('open', expandedMap[t.tunnelId]);
  });

  return wrapper;
}

function expandRow(label, value, showCopy) {
  const row = document.createElement('div');
  row.className = 'detail-row';

  const lbl = document.createElement('span');
  lbl.className = 'detail-label';
  lbl.textContent = label;
  row.appendChild(lbl);

  const val = document.createElement('span');
  val.className = 'detail-value';
  val.textContent = value;
  row.appendChild(val);

  if (showCopy) {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.innerHTML = iconSvg('copy', 14, 14);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(value);
    });
    row.appendChild(btn);
  }

  return row;
}

// ── Form ───────────────────────────────────────────────────────────────

function openNewForm() {
  editingId = null;
  document.getElementById('formTitle').textContent = 'New Tunnel';
  document.getElementById('formSave').textContent = 'Save';
  document.getElementById('dangerZone').style.display = 'none';
  document.getElementById('fName').value = '';
  document.getElementById('fEndpoint').value = '';
  document.getElementById('fHostname').value = '';
  document.getElementById('fTLS').classList.remove('on');
  document.getElementById('fAuth').classList.remove('on');
  document.getElementById('authFields').style.display = 'none';
  document.getElementById('fUsername').value = '';
  document.getElementById('fPassword').value = '';
  switchView('form');
}

function openEditForm(tunnelId) {
  const t = tunnels.find(x => x.tunnelId === tunnelId);
  if (!t) return;

  editingId = tunnelId;
  document.getElementById('formTitle').textContent = 'Edit Tunnel';
  document.getElementById('formSave').textContent = 'Save';
  document.getElementById('dangerZone').style.display = 'block';
  document.getElementById('fName').value = t.name || '';
  document.getElementById('fEndpoint').value = t.localEndpoint || '';
  document.getElementById('fHostname').value = t.hostname || '';

  if (t.enableTLS) {
    document.getElementById('fTLS').classList.add('on');
  } else {
    document.getElementById('fTLS').classList.remove('on');
  }

  const hasAuth = !!(t.auth && t.auth.username);
  if (hasAuth) {
    document.getElementById('fAuth').classList.add('on');
    document.getElementById('authFields').style.display = 'block';
  } else {
    document.getElementById('fAuth').classList.remove('on');
    document.getElementById('authFields').style.display = 'none';
  }
  document.getElementById('fUsername').value = (t.auth && t.auth.username) || '';
  document.getElementById('fPassword').value = (t.auth && t.auth.password) || '';

  switchView('form');
}

// ── Settings ───────────────────────────────────────────────────────────

function openSettings() {
  const relayEl = document.getElementById('sRelay');
  const userEl = document.getElementById('sUser');
  const passEl = document.getElementById('sPass');
  if (relayEl) relayEl.value = settings.relayUrl || '';
  if (userEl) userEl.value = settings.username || '';
  if (passEl) passEl.value = settings.password || '';
  switchView('settings');
}

function saveSettings() {
  settings.relayUrl = document.getElementById('sRelay').value.trim();
  settings.username = document.getElementById('sUser').value.trim();
  settings.password = document.getElementById('sPass').value.trim();
  chrome.storage.local.set({ settings });
  showToast('Settings saved');
  switchView('list');
}

function resetSettings() {
  settings = { relayUrl: '', username: '', password: '' };
  chrome.storage.local.set({ settings });
  const relayEl = document.getElementById('sRelay');
  const userEl = document.getElementById('sUser');
  const passEl = document.getElementById('sPass');
  if (relayEl) relayEl.value = '';
  if (userEl) userEl.value = '';
  if (passEl) passEl.value = '';
  showToast('Settings reset');
}

// ── Events ─────────────────────────────────────────────────────────────

function bindEvents() {
  // Header settings button
  const btnS = document.getElementById('btnSettings');
  if (btnS) btnS.addEventListener('click', openSettings);

  // Footer settings link
  const btnOS = document.getElementById('btnOpenSettings');
  if (btnOS) btnOS.addEventListener('click', openSettings);

  // New tunnel
  const btnNew = document.getElementById('btnNewTunnel');
  if (btnNew) btnNew.addEventListener('click', openNewForm);

  // Form back
  const formBack = document.getElementById('formBack');
  if (formBack) formBack.addEventListener('click', () => switchView('list'));

  // Form save
  const formSave = document.getElementById('formSave');
  if (formSave) formSave.addEventListener('click', saveForm);

  // Form delete
  const formDelete = document.getElementById('formDelete');
  if (formDelete) formDelete.addEventListener('click', () => {
    if (editingId) showDeleteDialog(editingId);
  });

  // TLS toggle
  const fTLS = document.getElementById('fTLS');
  if (fTLS) fTLS.addEventListener('click', () => fTLS.classList.toggle('on'));

  // Auth toggle
  const fAuth = document.getElementById('fAuth');
  if (fAuth) {
    fAuth.addEventListener('click', () => {
      fAuth.classList.toggle('on');
      const fields = document.getElementById('authFields');
      if (fAuth.classList.contains('on')) {
        fields.style.display = 'block';
      } else {
        fields.style.display = 'none';
        document.getElementById('fUsername').value = '';
        document.getElementById('fPassword').value = '';
      }
    });
  }

  // Dialog
  const deleteCancel = document.getElementById('deleteCancel');
  if (deleteCancel) deleteCancel.addEventListener('click', hideDeleteDialog);

  const deleteConfirm = document.getElementById('deleteConfirm');
  if (deleteConfirm) {
    deleteConfirm.addEventListener('click', () => {
      const id = deletingId;
      hideDeleteDialog();
      if (id) {
        if (currentView === 'form' && editingId === id) {
          // Delete from form view — return to list
          deleteTunnel(id);
          editingId = null;
          switchView('list');
        } else {
          deleteTunnel(id);
        }
      }
    });
  }

  // Dialog overlay click to close
  const dialogOverlay = document.getElementById('deleteDialog');
  if (dialogOverlay) {
    dialogOverlay.addEventListener('click', (e) => {
      if (e.target === dialogOverlay) hideDeleteDialog();
    });
  }

  // Settings
  const settingsBack = document.getElementById('settingsBack');
  if (settingsBack) settingsBack.addEventListener('click', () => switchView('list'));

  const settingsSave = document.getElementById('settingsSave');
  if (settingsSave) settingsSave.addEventListener('click', saveSettings);

  const settingsReset = document.getElementById('settingsReset');
  if (settingsReset) settingsReset.addEventListener('click', resetSettings);

  // Enter key in form inputs
  const formInputs = ['fName', 'fEndpoint', 'fHostname', 'fUsername', 'fPassword'];
  formInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveForm();
    });
  });
}

// ── Export for tests ───────────────────────────────────────────────────
if (typeof module !== 'undefined') {
  module.exports = { tunnels, settings, formatRelativeTime, copyToClipboard };
}
