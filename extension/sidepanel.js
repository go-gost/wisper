/**
 * sidepanel.js — Popup management UI for Wisper Chrome Extension.
 */

// ── i18n ──────────────────────────────────────────────────────────────

const TRANSLATIONS = {
  en: {
    emptyTunnels: 'No tunnels yet',
    btnNewTunnel: 'New Tunnel',
    formTitleNew: 'New HTTP Tunnel',
    formTitleEdit: 'Edit HTTP Tunnel',
    fieldName: 'Name',
    fieldTarget: 'Target',
    fieldHostname: 'Hostname',
    fieldAuth: 'Basic Auth',
    fieldUsername: 'Username',
    fieldPassword: 'Password',
    dangerZone: 'Danger Zone',
    btnDelete: 'Delete Tunnel',
    dialogDeleteTitle: 'Delete Tunnel',
    dialogDeleteMsg: 'Are you sure you want to delete "{name}"?',
    btnCancel: 'Cancel',
    btnDeleteConfirm: 'Delete',
    titleSettings: 'Settings',
    sectionPreferences: 'Preferences',
    settingAppearance: 'Appearance',
    settingLanguage: 'Language',
    appearanceLight: 'Light',
    appearanceDark: 'Dark',
    appearanceSystem: 'System',
    langEn: 'English',
    langZh: '中文',
    typeHttp: 'HTTP',
    statusRunning: 'Connected',
    statusConnecting: 'Connecting',
    statusStopped: 'Stopped',
    statusError: 'Error',
    labelActive: 'active',
    actionStop: 'Stop tunnel',
    actionStart: 'Start tunnel',
    actionEdit: 'Edit tunnel',
    actionDelete: 'Delete tunnel',
    actionInspect: 'Open in GOST Inspector',
    detailId: 'Tunnel ID',
    detailEntrypoint: 'Entrypoint',
    detailTarget: 'Target',
    detailHostRewrite: 'Host Rewrite',
    detailError: 'Error',
    msgCopied: 'Copied to clipboard',
    msgTargetRequired: 'Target is required',
    msgCreated: 'Tunnel created',
    msgUpdated: 'Tunnel updated',
    msgDeleted: 'Tunnel deleted',
  },
  zh: {
    emptyTunnels: '暂无隧道',
    btnNewTunnel: '新建隧道',
    formTitleNew: '新建 HTTP 隧道',
    formTitleEdit: '编辑 HTTP 隧道',
    fieldName: '名称',
    fieldTarget: '目标地址',
    fieldHostname: '主机名',
    fieldAuth: '基本认证',
    fieldUsername: '用户名',
    fieldPassword: '密码',
    dangerZone: '危险区域',
    btnDelete: '删除隧道',
    dialogDeleteTitle: '删除隧道',
    dialogDeleteMsg: '确定要删除 "{name}" 吗？',
    btnCancel: '取消',
    btnDeleteConfirm: '删除',
    titleSettings: '设置',
    sectionPreferences: '偏好设置',
    settingAppearance: '外观',
    settingLanguage: '语言',
    appearanceLight: '浅色',
    appearanceDark: '深色',
    appearanceSystem: '跟随系统',
    langEn: 'English',
    langZh: '中文',
    typeHttp: 'HTTP',
    statusRunning: '已连接',
    statusConnecting: '连接中',
    statusStopped: '已停止',
    statusError: '错误',
    labelActive: '活跃',
    actionStop: '停止隧道',
    actionStart: '启动隧道',
    actionEdit: '编辑隧道',
    actionDelete: '删除隧道',
    actionInspect: '打开 GOST Inspector',
    detailId: '隧道 ID',
    detailEntrypoint: '入口地址',
    detailTarget: '目标地址',
    detailHostRewrite: '主机重写',
    detailError: '错误',
    msgCopied: '已复制到剪贴板',
    msgTargetRequired: '目标地址不能为空',
    msgCreated: '隧道已创建',
    msgUpdated: '隧道已更新',
    msgDeleted: '隧道已删除',
  },
};

let currentLocale = 'en';

function t(key, params) {
  const text = TRANSLATIONS[currentLocale]?.[key] ?? TRANSLATIONS.en[key] ?? key;
  if (params) {
    return text.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
  }
  return text;
}

function setLocale(lang) {
  currentLocale = lang;
  document.documentElement.lang = lang;
  updateI18nElements();
  render();
}

function updateI18nElements() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
}

// ── Theme ────────────────────────────────────────────────────────────

function applyTheme(theme) {
  let dark = false;
  if (theme === 'dark') dark = true;
  else if (theme === 'system') dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (settings.theme === 'system') applyTheme('system');
});

// ── State ──────────────────────────────────────────────────────────────

/** @type {Array<{tunnelId:string,name:string,localEndpoint:string,relayUrl?:string,auth?:{username:string,password:string},status:string,error?:string,entrypoint?:string,createdAt:string,hostname?:string}>} */
let tunnels = [];
let settings = { theme: 'system', lang: 'en' };
let currentView = 'list'; // 'list' | 'form' | 'settings'
let editingId = null;
let formSaving = false;
let expandedMap = {};
let deletingId = null;

// ── Init ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadTunnels();
  bindEvents();

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
    if (data.settings) {
      settings = { ...settings, ...data.settings };
      // Migrate old darkMode boolean → theme
      if (settings.darkMode !== undefined && settings.theme === undefined) {
        settings.theme = settings.darkMode ? 'dark' : 'system';
        delete settings.darkMode;
      }
    }
    setLocale(settings.lang || 'en');
    applyTheme(settings.theme || 'system');
    updateI18nElements();
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
  const tun = {
    tunnelId,
    name: data.name.trim() || `tunnel-${data.endpoint.split(':').pop() || '0'}`,
    localEndpoint: data.endpoint.trim(),
    auth: data.username ? { username: data.username, password: data.password || '' } : undefined,
    status: 'stopped',
    error: null,
    entrypoint: null,
    createdAt: new Date().toISOString(),
    hostname: data.hostname || '',
  };

  tunnels.push(tun);
  persistTunnels();
  render();
  showToast(t('msgCreated'));

  // Auto-start
  startTunnel(tunnelId);
}

function startTunnel(tunnelId) {
  const tun = tunnels.find(x => x.tunnelId === tunnelId);
  if (!tun) return;
  tun.status = 'connecting';
  render();
  chrome.runtime.sendMessage({
    type: 'start-tunnel',
    config: {
      tunnelId: tun.tunnelId,
      name: tun.name,
      localEndpoint: tun.localEndpoint,
      auth: tun.auth,
      hostname: tun.hostname || undefined,
    },
  });
}

function stopTunnel(tunnelId) {
  const tun = tunnels.find(x => x.tunnelId === tunnelId);
  if (tun) {
    tun.status = 'stopped';
    tun.entrypoint = null;
    tun.error = null;
  }
  render();
  chrome.runtime.sendMessage({ type: 'stop-tunnel', tunnelId });
  persistTunnels();
}

function updateTunnelStatus(tunnelId, status, error, entrypoint) {
  let tun = tunnels.find(x => x.tunnelId === tunnelId);
  if (!tun) {
    chrome.storage.local.get('tunnels', (data) => {
      const fromStorage = (data.tunnels || []).find(x => x.tunnelId === tunnelId);
      if (fromStorage) {
        fromStorage.status = status;
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
  tun.status = status;
  if (status === 'running') {
    tun.error = null;
  } else if (error !== undefined && error !== null) {
    tun.error = error;
  }
  if (entrypoint !== undefined && entrypoint !== null) tun.entrypoint = entrypoint;
  persistTunnels();
  render();
}

function deleteTunnel(tunnelId) {
  chrome.runtime.sendMessage({ type: 'stop-tunnel', tunnelId });
  tunnels = tunnels.filter(x => x.tunnelId !== tunnelId);
  persistTunnels();
  render();
  showToast(t('msgDeleted'));
}

function saveForm() {
  if (formSaving) return;

  const name = document.getElementById('fName').value;
  const endpoint = document.getElementById('fEndpoint').value;
  if (!endpoint.trim()) {
    showToast(t('msgTargetRequired'));
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
      const oldTunnel = tunnels.find(x => x.tunnelId === editingId);
      if (oldTunnel) {
        const wasRunning = oldTunnel.status === 'running' || oldTunnel.status === 'connecting';
        if (oldTunnel.status === 'running' || oldTunnel.status === 'connecting' || oldTunnel.status === 'error') {
          chrome.runtime.sendMessage({ type: 'stop-tunnel', tunnelId: editingId });
        }
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

        if (wasRunning) {
          startTunnel(editingId);
        }
      }
      showToast(t('msgUpdated'));
    } else {
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
      showToast(t('msgCopied'));
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
    showToast(t('msgCopied'));
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
  const tun = tunnels.find(x => x.tunnelId === tunnelId);
  const msgEl = document.getElementById('deleteMsg');
  if (msgEl) {
    msgEl.textContent = t('dialogDeleteMsg', { name: tun ? tun.name : tunnelId });
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
  while (container.firstChild) container.removeChild(container.firstChild);

  if (tunnels.length === 0) {
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  const sorted = [...tunnels].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  for (const tun of sorted) {
    container.appendChild(buildCard(tun));
  }
}

// Accordion: expand one card, collapse all others.
function toggleExpand(tunnelId) {
  const willExpand = !expandedMap[tunnelId];

  document.querySelectorAll('#cardsContainer .expand-panel.open').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('#cardsContainer .card-chevron.open').forEach(c => c.classList.remove('open'));
  for (const id in expandedMap) expandedMap[id] = false;

  if (willExpand) {
    expandedMap[tunnelId] = true;
    const card = document.querySelector(`#cardsContainer [data-tunnel-id="${tunnelId}"]`);
    if (card) {
      const panel = card.querySelector('.expand-panel');
      const chev = card.querySelector('.card-chevron');
      if (panel) panel.classList.add('open');
      if (chev) chev.classList.add('open');
    }
  }
}

function buildCard(tun) {
  const wrapper = document.createElement('div');
  wrapper.dataset.tunnelId = tun.tunnelId;

  const row = document.createElement('div');
  row.className = `tunnel-card-row ${tun.status === 'stopped' ? 'stopped' : ''}`;

  const dot = document.createElement('span');
  dot.className = `status-dot ${tun.status}`;
  row.appendChild(dot);

  const body = document.createElement('div');
  body.className = 'card-body';

  const nameEl = document.createElement('div');
  nameEl.className = 'card-name';
  nameEl.textContent = tun.name || tun.tunnelId;
  body.appendChild(nameEl);

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const statusLabels = {
    running: t('statusRunning'),
    connecting: t('statusConnecting'),
    stopped: t('statusStopped'),
    error: t('statusError'),
  };
  meta.textContent = `${t('typeHttp')} · ${statusLabels[tun.status] || tun.status}`;
  body.appendChild(meta);

  row.appendChild(body);

  const right = document.createElement('div');
  right.className = 'card-right';

  const timeEl = document.createElement('div');
  timeEl.className = 'card-time';
  timeEl.textContent = formatRelativeTime(tun.createdAt);
  right.appendChild(timeEl);

  if (tun.status === 'running') {
    const traffic = document.createElement('div');
    traffic.className = 'card-traffic';
    traffic.innerHTML = `<div class="card-traffic-row"><span class="card-traffic-total">&uarr;&darr; ${t('labelActive')}</span></div>`;
    right.appendChild(traffic);
  }

  row.appendChild(right);

  const chev = document.createElement('span');
  chev.className = `card-chevron ${expandedMap[tun.tunnelId] ? 'open' : ''}`;
  chev.innerHTML = iconSvg('chevron-right', 16, 16);
  chev.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpand(tun.tunnelId);
  });
  row.appendChild(chev);

  wrapper.appendChild(row);

  const expand = document.createElement('div');
  expand.className = `expand-panel ${expandedMap[tun.tunnelId] ? 'open' : ''}`;

  const detailCard = document.createElement('div');
  detailCard.className = 'detail-card';

  detailCard.appendChild(expandDetailRow(t('detailId'), tun.tunnelId, true));

  if (tun.entrypoint) {
    detailCard.appendChild(expandDetailRow(t('detailEntrypoint'), tun.entrypoint, true, true));
  }

  detailCard.appendChild(expandDetailRow(t('detailTarget'), tun.localEndpoint, true));

  if (tun.hostname) {
    detailCard.appendChild(expandDetailRow(t('detailHostRewrite'), tun.hostname, false));
  }

  if (tun.error) {
    const errRow = document.createElement('div');
    errRow.className = 'detail-row error';
    const errLabel = document.createElement('span');
    errLabel.className = 'dlabel';
    errLabel.textContent = t('detailError');
    errRow.appendChild(errLabel);
    const errVal = document.createElement('span');
    errVal.className = 'dval error-text';
    const errMono = document.createElement('span');
    errMono.className = 'dval-mono';
    errMono.textContent = tun.error;
    errVal.appendChild(errMono);
    errRow.appendChild(errVal);
    detailCard.appendChild(errRow);
  }

  expand.appendChild(detailCard);

  const actions = document.createElement('div');
  actions.className = 'expand-actions';

  if (tun.status === 'running' || tun.status === 'connecting') {
    const stopBtn = document.createElement('button');
    stopBtn.className = 'action-btn stop';
    stopBtn.innerHTML = iconSvg('stop', 14, 14);
    stopBtn.title = t('actionStop');
    stopBtn.addEventListener('click', (e) => { e.stopPropagation(); stopTunnel(tun.tunnelId); });
    actions.appendChild(stopBtn);
  } else {
    const startBtn = document.createElement('button');
    startBtn.className = 'action-btn start';
    startBtn.innerHTML = iconSvg('play', 14, 14);
    startBtn.title = t('actionStart');
    startBtn.addEventListener('click', (e) => { e.stopPropagation(); startTunnel(tun.tunnelId); });
    actions.appendChild(startBtn);
  }

  const editBtn = document.createElement('button');
  editBtn.className = 'action-btn';
  editBtn.innerHTML = iconSvg('edit', 14, 14);
  editBtn.title = t('actionEdit');
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditForm(tun.tunnelId);
  });
  actions.appendChild(editBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'action-btn danger';
  delBtn.innerHTML = iconSvg('trash', 14, 14);
  delBtn.title = t('actionDelete');
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showDeleteDialog(tun.tunnelId);
  });
  actions.appendChild(delBtn);

  const inspectBtn = document.createElement('button');
  inspectBtn.className = 'action-btn inspect';
  inspectBtn.innerHTML = iconSvg('search', 14, 14);
  inspectBtn.title = t('actionInspect');
  inspectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.open(`https://inspector.gost.run/query/http?tunnel_id=${encodeURIComponent(tun.tunnelId)}`, '_blank');
  });
  actions.appendChild(inspectBtn);

  expand.appendChild(actions);
  wrapper.appendChild(expand);

  row.addEventListener('click', (e) => {
    if (e.target.closest('.action-btn') || e.target.closest('.copy-btn') || e.target.closest('.dval-link')) return;
    toggleExpand(tun.tunnelId);
  });

  return wrapper;
}

function expandDetailRow(label, value, showCopy, link) {
  const row = document.createElement('div');
  row.className = 'detail-row';

  const lbl = document.createElement('span');
  lbl.className = 'dlabel';
  lbl.textContent = label;
  row.appendChild(lbl);

  const val = document.createElement('span');
  val.className = 'dval';
  const vmono = document.createElement(link ? 'a' : 'span');
  vmono.className = 'dval-mono' + (link ? ' dval-link' : '');
  vmono.textContent = value;
  if (link) {
    vmono.href = value;
    vmono.target = '_blank';
    vmono.rel = 'noopener noreferrer';
  }
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
  document.getElementById('formTitle').textContent = t('formTitleNew');
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
  const tun = tunnels.find(x => x.tunnelId === tunnelId);
  if (!tun) return;

  editingId = tunnelId;
  document.getElementById('formTitle').textContent = t('formTitleEdit');
  document.getElementById('dangerZone').style.display = 'block';
  document.getElementById('fName').value = tun.name || '';
  document.getElementById('fEndpoint').value = tun.localEndpoint || '';
  document.getElementById('fHostname').value = tun.hostname || '';

  const hasAuth = !!(tun.auth && tun.auth.username);
  if (hasAuth) {
    document.getElementById('fAuth').classList.add('on');
    document.getElementById('authFields').style.display = 'block';
  } else {
    document.getElementById('fAuth').classList.remove('on');
    document.getElementById('authFields').style.display = 'none';
  }
  document.getElementById('fUsername').value = (tun.auth && tun.auth.username) || '';
  document.getElementById('fPassword').value = (tun.auth && tun.auth.password) || '';

  switchView('form');
}

// ── Settings ───────────────────────────────────────────────────────────

function openSettings() {
  refreshSettingsValues();
  const versionEl = document.getElementById('settingsVersion');
  if (versionEl) {
    try {
      const m = chrome.runtime.getManifest();
      versionEl.textContent = `v${m.version}`;
    } catch { versionEl.textContent = ''; }
  }
  switchView('settings');
}

function refreshSettingsValues() {
  const el = document.getElementById('sAppearanceValue');
  if (el) el.textContent = t('appearance' + settings.theme.charAt(0).toUpperCase() + settings.theme.slice(1));

  const lv = document.getElementById('sLangValue');
  if (lv) lv.textContent = settings.lang === 'zh' ? t('langZh') : t('langEn');
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

  // Appearance cycle (Light → Dark → System)
  const sAppearance = document.getElementById('sAppearance');
  if (sAppearance) {
    sAppearance.addEventListener('click', () => {
      const cycle = { light: 'dark', dark: 'system', system: 'light' };
      settings.theme = cycle[settings.theme] || 'system';
      applyTheme(settings.theme);
      chrome.storage.local.set({ settings });
      refreshSettingsValues();
    });
  }

  // Language cycle (English ↔ 中文)
  const sLang = document.getElementById('sLang');
  if (sLang) {
    sLang.addEventListener('click', () => {
      settings.lang = settings.lang === 'en' ? 'zh' : 'en';
      setLocale(settings.lang);
      chrome.storage.local.set({ settings });
      refreshSettingsValues();
    });
  }

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
