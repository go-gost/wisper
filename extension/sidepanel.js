/**
 * sidepanel.js — Popup management UI for Wisper Chrome Extension.
 *
 * Faithfully replicates the web UI (Lit) using DOM manipulation.
 * Communicates with background.js service worker for tunnel lifecycle.
 */

// ── State ──────────────────────────────────────────────────────────────

/** @type {Array<{tunnelId:string,name:string,localEndpoint:string,relayUrl?:string,auth?:{username:string,password:string},status:string,error?:string,entrypoint?:string,createdAt:string,hostname?:string}>} */
let tunnels = [];
let settings = { relayUrl: '', entrypoint: '', insecure: false, darkMode: false };
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
  chrome.storage.local.get('tunnels', (data) => {
    tunnels = (data.tunnels || []).map(t => ({
      tunnelId: t.tunnelId,
      name: t.name || '',
      localEndpoint: t.localEndpoint || '',
      relayUrl: t.relayUrl || '',
      auth: t.auth || null,
      status: t.status || 'stopped',
      error: t.error || null,
      entrypoint: t.entrypoint || null,
      createdAt: t.createdAt || new Date().toISOString(),
      hostname: t.hostname || '',
    }));
    render();
  });
}

function loadSettings() {
  chrome.storage.local.get('settings', (data) => {
    if (data.settings) settings = { ...settings, ...data.settings };
    applyTheme(settings.darkMode);
    render();
  });
}

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
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
    auth: data.username ? { username: data.username, password: data.password || '' } : undefined,
    status: 'stopped',
    error: null,
    entrypoint: null,
    createdAt: new Date().toISOString(),
    hostname: data.hostname || '',
  };

  tunnels.push(tunnel);
  persistTunnels();
  render();
  showToast('✓ Tunnel created');

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
      entrypointDomain: settings.entrypoint || undefined,
      insecure: settings.insecure || false,
      auth: t.auth,
      hostname: t.hostname || undefined,
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
  let t = tunnels.find(x => x.tunnelId === tunnelId);
  if (!t) {
    // Tunnel not yet in local array — may have arrived before loadTunnels completed.
    // Sync from storage to be safe.
    chrome.storage.local.get('tunnels', (data) => {
      const fromStorage = (data.tunnels || []).find(x => x.tunnelId === tunnelId);
      if (fromStorage) {
        fromStorage.status = status;
        // A successful (re)connect explicitly sends error:null — honor it and clear
        // any stale error, rather than only updating when a truthy error arrives.
        if (status === 'running') {
          fromStorage.error = null;
        } else if (error !== undefined && error !== null) {
          fromStorage.error = error;
        }
        if (entrypoint !== undefined && entrypoint !== null) fromStorage.entrypoint = entrypoint;
        tunnels.push({
          tunnelId: fromStorage.tunnelId,
          name: fromStorage.name || '',
          localEndpoint: fromStorage.localEndpoint || '',
          relayUrl: fromStorage.relayUrl || '',
          auth: fromStorage.auth || null,
          status: fromStorage.status,
          error: fromStorage.error || null,
          entrypoint: fromStorage.entrypoint || null,
          createdAt: fromStorage.createdAt || new Date().toISOString(),
          hostname: fromStorage.hostname || '',
        });
        chrome.storage.local.set({ tunnels: data.tunnels });
        render();
      }
    });
    return;
  }
  t.status = status;
  // A successful (re)connect explicitly sends error:null — honor it and clear any
  // stale error. Only keep/set an error when the service is actually in 'error'.
  if (status === 'running') {
    t.error = null;
  } else if (error !== undefined && error !== null) {
    t.error = error;
  }
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
  showToast('✓ Tunnel deleted');
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
    const hasAuth = document.getElementById('fAuth').classList.contains('on');
    const username = hasAuth ? document.getElementById('fUsername').value : '';
    const password = hasAuth ? document.getElementById('fPassword').value : '';

    const formData = {
      name: name.trim() || undefined,
      endpoint: endpoint.trim(),
      hostname: hostname.trim() || undefined,
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
      showToast('✓ Tunnel updated');
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
  el.style.animation = 'toast-in 0.3s ease';
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
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
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

  // Sort: newest first by createdAt
  const sorted = [...tunnels].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

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

  // ── Expand panel (matches home-page.ts) ──
  const expand = document.createElement('div');
  expand.className = `expand-panel ${expandedMap[t.tunnelId] ? 'open' : ''}`;

  // Detail card
  const detailCard = document.createElement('div');
  detailCard.className = 'detail-card';

  // Tunnel ID row
  detailCard.appendChild(expandDetailRow('Tunnel ID', t.tunnelId, true));

  // Entrypoint row
  if (t.entrypoint) {
    detailCard.appendChild(expandDetailRow('Entrypoint', t.entrypoint, true));
  }

  // Target row
  detailCard.appendChild(expandDetailRow('Target', t.localEndpoint, true));

  // Hostname row (if set)
  if (t.hostname) {
    detailCard.appendChild(expandDetailRow('Host Rewrite', t.hostname, false));
  }

  // Error row (inside detail card)
  if (t.error) {
    const errRow = document.createElement('div');
    errRow.className = 'detail-row error';
    const errLabel = document.createElement('span');
    errLabel.className = 'dlabel';
    errLabel.textContent = 'Error';
    errRow.appendChild(errLabel);
    const errVal = document.createElement('span');
    errVal.className = 'dval error-text';
    const errMono = document.createElement('span');
    errMono.className = 'dval-mono';
    errMono.textContent = t.error;
    errVal.appendChild(errMono);
    errRow.appendChild(errVal);
    detailCard.appendChild(errRow);
  }

  expand.appendChild(detailCard);

  // Actions (matches home-page.ts action-btn)
  const actions = document.createElement('div');
  actions.className = 'expand-actions';

  if (t.status === 'running' || t.status === 'connecting') {
    const stopBtn = document.createElement('button');
    stopBtn.className = 'action-btn stop';
    stopBtn.innerHTML = iconSvg('stop', 14, 14);
    stopBtn.title = 'Stop tunnel';
    stopBtn.addEventListener('click', (e) => { e.stopPropagation(); stopTunnel(t.tunnelId); });
    actions.appendChild(stopBtn);
  } else {
    const startBtn = document.createElement('button');
    startBtn.className = 'action-btn start';
    startBtn.innerHTML = iconSvg('play', 14, 14);
    startBtn.title = 'Start tunnel';
    startBtn.addEventListener('click', (e) => { e.stopPropagation(); startTunnel(t.tunnelId); });
    actions.appendChild(startBtn);
  }

  // Edit button
  const editBtn = document.createElement('button');
  editBtn.className = 'action-btn';
  editBtn.innerHTML = iconSvg('edit', 14, 14);
  editBtn.title = 'Edit tunnel';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditForm(t.tunnelId);
  });
  actions.appendChild(editBtn);

  // Delete button (danger = outline red, matches home-page.ts)
  const delBtn = document.createElement('button');
  delBtn.className = 'action-btn danger';
  delBtn.innerHTML = iconSvg('trash', 14, 14);
  delBtn.title = 'Delete tunnel';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showDeleteDialog(t.tunnelId);
  });
  actions.appendChild(delBtn);

  // Inspector button — opens GOST inspector for this tunnel
  const inspectBtn = document.createElement('button');
  inspectBtn.className = 'action-btn inspect';
  inspectBtn.innerHTML = iconSvg('search', 14, 14);
  inspectBtn.title = 'Open in GOST Inspector';
  inspectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.open(`https://inspector.gost.run/query/http?tunnel_id=${encodeURIComponent(t.tunnelId)}`, '_blank');
  });
  actions.appendChild(inspectBtn);

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

function expandDetailRow(label, value, showCopy) {
  const row = document.createElement('div');
  row.className = 'detail-row';

  const lbl = document.createElement('span');
  lbl.className = 'dlabel';
  lbl.textContent = label;
  row.appendChild(lbl);

  const val = document.createElement('span');
  val.className = 'dval';
  const vmono = document.createElement('span');
  vmono.className = 'dval-mono';
  vmono.textContent = value;
  val.appendChild(vmono);

  if (showCopy) {
    const btn = document.createElement('button');
    btn.className = 'copy-btn-mini';
    btn.innerHTML = iconSvg('copy', 14, 14);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(value);
    });
    val.appendChild(btn);
  }

  row.appendChild(val);
  return row;
}

// ── Form ───────────────────────────────────────────────────────────────

function openNewForm() {
  editingId = null;
  document.getElementById('formTitle').textContent = 'New HTTP Tunnel';
  document.getElementById('dangerZone').style.display = 'none';
  document.getElementById('fName').value = '';
  document.getElementById('fEndpoint').value = '';
  document.getElementById('fHostname').value = '';
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
  document.getElementById('formTitle').textContent = 'Edit HTTP Tunnel';
  document.getElementById('dangerZone').style.display = 'block';
  document.getElementById('fName').value = t.name || '';
  document.getElementById('fEndpoint').value = t.localEndpoint || '';
  document.getElementById('fHostname').value = t.hostname || '';

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
  document.getElementById('sRelay').value = settings.relayUrl || '';
  document.getElementById('sEntrypoint').value = settings.entrypoint || '';
  document.getElementById('sInsecure').classList.toggle('on', !!settings.insecure);
  document.getElementById('sDarkMode').classList.toggle('on', !!settings.darkMode);
  const versionEl = document.getElementById('settingsVersion');
  if (versionEl) {
    try {
      const m = chrome.runtime.getManifest();
      versionEl.textContent = `v${m.version}`;
    } catch { versionEl.textContent = ''; }
  }
  switchView('settings');
}

function saveSettings() {
  settings.relayUrl = document.getElementById('sRelay').value.trim();
  settings.entrypoint = document.getElementById('sEntrypoint').value.trim();
  settings.insecure = document.getElementById('sInsecure').classList.contains('on');
  settings.darkMode = document.getElementById('sDarkMode').classList.contains('on');
  chrome.storage.local.set({ settings });
  applyTheme(settings.darkMode);
  showToast('✓ Saved');
  switchView('list');
}

// ── Events ─────────────────────────────────────────────────────────────

function bindEvents() {
  // Header settings button
  const btnS = document.getElementById('btnSettings');
  if (btnS) btnS.addEventListener('click', openSettings);

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

  // Insecure toggle
  const sInsecure = document.getElementById('sInsecure');
  if (sInsecure) sInsecure.addEventListener('click', () => sInsecure.classList.toggle('on'));

  // Dark mode toggle
  const sDarkMode = document.getElementById('sDarkMode');
  if (sDarkMode) sDarkMode.addEventListener('click', () => sDarkMode.classList.toggle('on'));

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
