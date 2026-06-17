import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { getTunnels, refresh, remove, start, stop, subscribe, resetStats } from '../store/tunnel-store';
import { setItemStats } from '../store/stats-store';
import { getSettings } from '../store/settings-store';
import { copyToClipboard } from '../utils/clipboard';
import { formatBytes, formatRate, formatNumber, formatTimestamp } from '../utils/format';
import type { Tunnel, TunnelType, TunnelCreateRequest } from '../api/types';
import '../components/app-scaffold';

type PageMode = 'view' | 'edit' | 'create';

@customElement('tunnel-detail-page')
export class TunnelDetailPage extends LitElement {
  @property() tunnelType: TunnelType = 'tcp';
  @property() tunnelId = '';

  // ── State ────────────────────────────────────────────────────────────

  @state() private mode: PageMode = 'view';
  @state() private _tunnel: Tunnel | null = null;
  @state() private _saving = false;
  @state() private _snackbar = '';
  @state() private _showDeleteDialog = false;
  @state() private _showResetDialog = false;
  private _resetKind = '';

  // Form fields
  @state() private _name = '';
  @state() private _endpoint = '';
  @state() private _hostname = '';
  @state() private _username = '';
  @state() private _password = '';
  @state() private _enableTLS = false;
  @state() private _rewriteHost = false;
  @state() private _fileUpload = false;
  @state() private _showAuth = false;

  // Native bridge detection
  private get _isNativeDirPicker(): boolean {
    return !!(window as any).WisperNative?.pickDir;
  }

  private _browseDir() {
    const cbName = '__wisper_dir_callback__';
    (window as any)[cbName] = (path: string) => {
      this._endpoint = path;
      this.requestUpdate();
      delete (window as any)[cbName];
    };
    (window as any).WisperNative.pickDir(cbName);
  }

  private _unsubs: (() => void)[] = [];

  // ── Lifecycle ────────────────────────────────────────────────────────

  connectedCallback() {
    super.connectedCallback();
    this._load();

    this._unsubs.push(
      subscribe(() => {
        this._load();
        this.requestUpdate();
      }),
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const fn of this._unsubs) fn();
    this._unsubs = [];
  }

  private _load() {
    const id = this.tunnelId;
    // Check for ?edit query in URL
    const isEdit = window.location.search.includes('edit');

    if (id === 'new' || !id) {
      // Guard: don't reset form fields on every store update (stats polling).
      if (this.mode === 'create') return;
      this.mode = 'create';
      this._tunnel = null;
      this._resetForm();
      return;
    }

    // Guard: when already editing this tunnel, skip re-population triggered
    // by store updates (e.g. stats polling every 1s).
    if (this.mode === 'edit' && this._tunnel?.id === id) return;

    const existing = getTunnels().find(t => t.id === id);
    if (existing) {
      this._tunnel = existing;
      if (isEdit) {
        this.mode = 'edit';
        this._populateForm(existing);
      } else {
        // Only reset to view if we weren't already in edit mode for this tunnel
        if (this.mode !== 'edit' || this._tunnel?.id !== id) {
          this.mode = 'view';
          this._populateForm(existing);
        }
      }
    }
  }

  private _resetForm() {
    this._name = '';
    this._endpoint = '';
    this._hostname = '';
    this._username = '';
    this._password = '';
    this._enableTLS = false;
    this._rewriteHost = false;
    this._fileUpload = false;
    this._showAuth = false;
  }

  private _populateForm(t: Tunnel) {
    this._name = t.name;
    this._endpoint = t.endpoint;
    this._hostname = t.options.hostname ?? '';
    this._username = t.options.username ?? '';
    this._password = t.options.password ?? '';
    this._enableTLS = t.options.enableTLS ?? false;
    this._rewriteHost = t.options.rewriteHost ?? false;
    this._fileUpload = t.options.file_upload ?? false;
    this._showAuth = !!(t.options.username || t.options.basic_auth);
  }

  // ── Navigation ───────────────────────────────────────────────────────

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  private _enterEdit() {
    if (this._tunnel) {
      this._populateForm(this._tunnel);
      this.mode = 'edit';
    }
  }

  // ── Snackbar ─────────────────────────────────────────────────────────

  private _showSnackbar(msg: string) {
    this._snackbar = msg;
    setTimeout(() => {
      this._snackbar = '';
      this.requestUpdate();
    }, 2500);
  }

  // ── Actions ──────────────────────────────────────────────────────────

  private async _handleSave() {
    if (!this._name.trim()) {
      this._showSnackbar(t('requiredField'));
      return;
    }

    this._saving = true;
    try {
      const body: TunnelCreateRequest = {
        name: this._name.trim(),
        type: this.tunnelType,
        endpoint: this._endpoint.trim(),
        hostname: this._hostname.trim() || undefined,
        enableTLS: this._enableTLS,
        rewriteHost: this._rewriteHost,
        file_upload: this._fileUpload,
      };
      if (this._showAuth) {
        body.username = this._username.trim() || undefined;
        body.password = this._password || undefined;
      }

      if (this.mode === 'create') {
        await import('../store/tunnel-store').then(m => m.create(body));
        this._showSnackbar(t('saved'));
        this._navigate('/');
      } else {
        await import('../store/tunnel-store').then(m => m.update(this.tunnelId, body));
        this._showSnackbar(t('saved'));
        this.mode = 'view';
        await refresh();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      this._showSnackbar(`${t('saveFailed')}${msg ? ': ' + msg : ''}`);
    }
    this._saving = false;
  }

  private async _handleDelete() {
    this._showDeleteDialog = false;
    try {
      await remove(this.tunnelId);
      this._showSnackbar(t('deleted'));
      this._navigate('/');
    } catch {
      this._showSnackbar(t('deleteFailed'));
    }
  }

  private async _handleStart() {
    try {
      await start(this.tunnelId);
      this._showSnackbar(t('started'));
    } catch {
      this._showSnackbar(t('startFailed'));
    }
  }

  private async _handleStop() {
    try {
      await stop(this.tunnelId);
      this._showSnackbar(t('stopped'));
    } catch {
      this._showSnackbar(t('stopFailed'));
    }
  }

  private async _handleCopy(text: string) {
    await copyToClipboard(text);
    this._showSnackbar(t('copiedToClipboard'));
  }

  private _handleResetStats(kind: string) {
    this._resetKind = kind;
    this._showResetDialog = true;
  }

  private async _doResetStats() {
    this._showResetDialog = false;
    try {
      await resetStats(this.tunnelId, this._resetKind);
      // Immediately sync the stats cache from the refreshed tunnel data so
      // the detail page shows the correct baseline-subtracted values.
      if (this._tunnel) {
        setItemStats(this.tunnelId, this._tunnel.stats);
      }
      this._showSnackbar(t('saved'));
    } catch {
      this._showSnackbar(t('saveFailed'));
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private _typeLabel(): string {
    return t(`type${this.tunnelType.charAt(0).toUpperCase() + this.tunnelType.slice(1)}`);
  }

  // ── Styles ───────────────────────────────────────────────────────────

  static styles = css`
    /* ── AppBar ── */
    .back-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text);
      padding: 4px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
    }
    .back-btn:hover {
      background: var(--border-subtle);
    }

    .page-title {
      font-size: var(--font-md);
      font-weight: 600;
      flex: 1;
    }

    .appbar-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font-size: var(--font-sm);
      display: flex;
      align-items: center;
      gap: 3px;
      font-family: inherit;
      transition: background var(--transition-fast);
    }
    .appbar-btn:hover {
      background: var(--border-subtle);
    }

    .pill-btn {
      padding: 5px 14px;
      border-radius: var(--radius-pill);
      border: none;
      cursor: pointer;
      font-size: var(--font-sm);
      font-weight: 500;
      font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pill-btn.primary {
      background: var(--accent);
      color: var(--accent-fg);
    }
    .pill-btn.danger {
      background: var(--red);
      color: #fff;
    }
    .pill-btn svg {
      width: 14px;
      height: 14px;
    }
    .pill-btn:hover {
      opacity: 0.85;
    }
    .pill-btn.appbar-action {
      margin-left: auto;
    }

    /* ── Layout ── */
    .section {
      padding: 16px;
    }

    /* ── Status banner ── */
    .status-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      margin: 0 16px;
      border-radius: var(--radius-md);
      font-size: var(--font-sm);
      font-weight: 500;
    }
    .status-banner.running {
      background: var(--green-bg);
      color: var(--green-text);
      border: 1px solid var(--green-border);
    }
    .status-banner.stopped {
      background: var(--border-subtle);
      color: var(--text-muted);
    }
    .status-banner.error {
      background: var(--red-bg);
      color: var(--red-text);
      border: 1px solid var(--red-border);
    }

    .status-dot-mini {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .status-spacer {
      flex: 1;
    }

    /* ── Info card ── */
    .card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }

    .info-row {
      display: flex;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      gap: 16px;
    }
    .info-row:last-child {
      border-bottom: none;
    }

    .info-label {
      font-size: var(--font-sm);
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      width: 80px;
      flex-shrink: 0;
    }

    .info-value {
      font-size: var(--font-md);
      color: var(--text);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      flex: 1;
      word-break: break-all;
    }

    .info-value.text {
      font-family: inherit;
      font-size: var(--font-md);
    }

    .info-value.uuid {
      font-size: var(--font-sm);
    }

    .copy-btn-mini {
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px;
      color: var(--text-muted);
      display: flex;
      border-radius: 3px;
    }
    .copy-btn-mini:hover {
      background: var(--border-subtle);
      color: var(--text);
    }

    /* ── Stats grid ── */
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 12px;
    }

    .stat-box {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 12px;
    }

    .stat-icon {
      font-size: var(--font-md);
      margin-bottom: 4px;
    }

    .stat-reset-mini {
      display: inline-flex;
      align-items: center;
      margin-left: auto;
      opacity: 0;
      transition: opacity 0.15s;
      cursor: pointer;
      color: var(--text-muted);
    }
    .stat-box:hover .stat-reset-mini { opacity: 1; }
    .stat-reset-mini:hover { color: var(--accent); }

    .stat-value {
      font-size: var(--font-lg);
      font-weight: 700;
      color: var(--text);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    }

    .stat-rate {
      font-size: var(--font-sm);
      color: var(--green-text);
      margin-top: 2px;
    }

    .stat-label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: var(--font-sm);
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    /* ── Form ── */
    .form-group {
      margin-bottom: 14px;
    }
    .form-label {
      display: block;
      font-size: var(--font-sm);
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      color: var(--text);
      font-size: var(--font-sm);
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
      transition: border-color var(--transition-fast);
    }
    .form-input:focus {
      border-color: var(--accent);
    }
    .form-input[readonly] {
      background: var(--border-subtle);
      color: var(--text-muted);
    }

    /* ── Directory picker ── */
    .dir-input-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .dir-input {
      flex: 1;
    }
    .browse-btn {
      white-space: nowrap;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      color: var(--text);
      font-size: var(--font-sm);
      font-family: inherit;
      cursor: pointer;
      transition: background var(--transition-fast), border-color var(--transition-fast);
    }
    .browse-btn:hover {
      background: var(--border-subtle);
      border-color: var(--accent);
    }

    /* ── Switch ── */
    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .switch-label {
      font-size: var(--font-sm);
      color: var(--text);
    }
    .switch {
      width: 40px;
      height: 22px;
      border-radius: 11px;
      background: var(--border);
      position: relative;
      cursor: pointer;
      transition: background var(--transition-fast);
      flex-shrink: 0;
    }
    .switch.on {
      background: var(--accent);
    }
    .switch-knob {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #fff;
      position: absolute;
      top: 2px;
      left: 2px;
      transition: left var(--transition-fast);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    }
    .switch.on .switch-knob {
      left: 20px;
    }

    /* ── Danger zone ── */
    .danger-zone {
      margin-top: 20px;
      padding: 14px;
      border: 1px solid var(--red-border);
      border-radius: var(--radius-md);
    }
    .danger-zone-label {
      font-size: var(--font-sm);
      font-weight: 600;
      color: var(--red-text);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    /* ── Toast ── */
    .toast {
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--surface);
      color: var(--text);
      padding: 10px 20px;
      border-radius: var(--radius-lg);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-size: var(--font-sm);
      z-index: 100;
      animation: toast-in 0.3s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    /* ── Delete dialog ── */
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 200;
      animation: fade-in 0.15s ease;
    }
    @keyframes fade-in { from { opacity: 0; } }
    .dialog-box {
      background: var(--surface);
      border-radius: var(--radius-lg);
      padding: 24px;
      max-width: 320px;
      width: 90%;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    }
    .dialog-title {
      font-weight: 600;
      font-size: var(--font-md);
      margin-bottom: 8px;
      text-align: center;
    }
    .dialog-message {
      color: var(--text-secondary);
      font-size: var(--font-sm);
      margin-bottom: 20px;
      text-align: center;
      line-height: 1.5;
    }
    .dialog-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    .dialog-btn {
      padding: 8px 20px;
      border-radius: var(--radius-pill);
      border: none;
      cursor: pointer;
      font-size: var(--font-sm);
      font-weight: 500;
      font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .dialog-btn.cancel {
      background: var(--border-subtle);
      color: var(--text);
    }
    .dialog-btn.danger {
      background: var(--red);
      color: #fff;
    }
    .dialog-btn:hover { opacity: 0.85; }

    /* ── Edit button at bottom ── */
    .btn-edit-bottom {
      width: 100%;
      padding: 8px;
      border-radius: var(--radius-md);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: var(--font-sm);
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      line-height: 1;
    }
    .btn-edit-bottom svg {
      width: 14px;
      height: 14px;
    }
    .btn-edit-bottom:hover { opacity: 0.8; }
  `;

  // ── Render ───────────────────────────────────────────────────────────

  render() {
    const t2 = this._tunnel;
    const stats = t2 ? t2.stats : null;
    const typeLabel = this._typeLabel();

    return html`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${() => this._navigate('/')}>
            ${icon('chevron-left')}
          </button>
          <span class="page-title">
            ${this.mode === 'create'
              ? `${t('tunnelNewTitle')} — ${typeLabel}`
              : typeLabel + ' Tunnel'}
          </span>

          ${this.mode === 'view' && t2
            ? html`
              ${t2.status === 'running'
                ? html`<button class="pill-btn danger appbar-action" @click=${() => this._handleStop()}>
                  ■ ${t('btnStop')}
                </button>`
                : html`<button class="pill-btn primary appbar-action" @click=${() => this._handleStart()}>
                  ▶ ${t('btnStart')}
                </button>`}
            `
            : html`
              <button class="pill-btn primary appbar-action" ?disabled=${this._saving} @click=${() => this._handleSave()}>
                ${icon('check')} ${t('btnSave')}
              </button>
            `}
        </div>

        <!-- ── VIEW MODE ───────────────────────────────────────────── -->
        ${this.mode === 'view' && t2
          ? html`
            <!-- Status banner -->
            <div class="status-banner ${t2.status}">
              <span class="status-dot-mini"></span>
              ${t2.status === 'running'
                ? t('statusRunning') + ' · ' + formatNumber(t2.stats.current_conns) + ' ' + t('activeConnections')
                : t2.status === 'error'
                  ? t('statusError')
                  : t('statusStopped')}
              ${t2.error ? html` — ${t2.error}` : ''}
              <span class="status-spacer"></span>
            </div>

            <!-- Info card -->
            <div class="section">
              <div class="card">
                <div class="info-row">
                  <span class="info-label">Type</span>
                  <span class="info-value text">${typeLabel} Tunnel</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Created</span>
                  <span class="info-value text">${formatTimestamp(t2.created_at)}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Target</span>
                  <span class="info-value">${t2.endpoint}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Entrypoint</span>
                  <span class="info-value">${t2.entrypoint}</span>
                  <button class="copy-btn-mini" @click=${() => this._handleCopy(t2.entrypoint)}>
                    ${icon('copy')}
                  </button>
                </div>
                ${t2.options.hostname
                  ? html`
                    <div class="info-row">
                      <span class="info-label">Hostname</span>
                      <span class="info-value text">${t2.options.hostname}</span>
                    </div>
                  `
                  : ''}
                ${this.tunnelType === 'http'
                  ? html`
                    <div class="info-row">
                      <span class="info-label">TLS</span>
                      <span class="info-value text">${t2.options.enableTLS ? 'Enabled' : 'Disabled'}</span>
                    </div>
                  `
                  : ''}
                ${t2.options.username
                  ? html`
                    <div class="info-row">
                      <span class="info-label">Auth</span>
                      <span class="info-value text">Basic · ${t2.options.username}</span>
                    </div>
                  `
                  : ''}
                ${this.tunnelType === 'file'
                  ? html`
                    <div class="info-row">
                      <span class="info-label">Upload</span>
                      <span class="info-value text">${t2.options.file_upload ? 'Enabled' : 'Disabled'}</span>
                    </div>
                  `
                  : ''}
                <div class="info-row">
                  <span class="info-label">ID</span>
                  <span class="info-value uuid">${t2.id}</span>
                  <button class="copy-btn-mini" @click=${() => this._handleCopy(t2.id)}>
                    ${icon('copy')}
                  </button>
                </div>
              </div>

              <!-- Stats grid -->
              ${stats
                ? html`
                  <div class="stats-grid">
                    <div class="stat-box">
                      <div class="stat-label">Total Conns <span class="stat-reset-mini" @click=${() => this._handleResetStats('conns')} title="${t('btnResetStats')}">${icon('rotate-cw')}</span></div>
                      <div class="stat-value">${formatNumber(stats.total_conns)}</div>
                      <div class="stat-rate">${formatNumber(stats.current_conns)} active · ${stats.request_rate.toFixed(1)} conns/s</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Total Errors <span class="stat-reset-mini" @click=${() => this._handleResetStats('errors')} title="${t('btnResetStats')}">${icon('rotate-cw')}</span></div>
                      <div class="stat-value">${formatNumber(stats.total_errs)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Download <span class="stat-reset-mini" @click=${() => this._handleResetStats('output')} title="${t('btnResetOutput')}">${icon('rotate-cw')}</span></div>
                      <div class="stat-value">${formatBytes(stats.output_bytes)}</div>
                      <div class="stat-rate">${formatRate(stats.output_rate_bytes)}</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-label">Upload <span class="stat-reset-mini" @click=${() => this._handleResetStats('input')} title="${t('btnResetInput')}">${icon('rotate-cw')}</span></div>
                      <div class="stat-value">${formatBytes(stats.input_bytes)}</div>
                      <div class="stat-rate">${formatRate(stats.input_rate_bytes)}</div>
                    </div>
                  </div>
                `
                : ''}
            </div>

            <!-- Inspector entry — only HTTP/File tunnels carry HTTP traffic worth
                 inspecting, and only when an inspector URL is configured. -->
            ${this.mode === 'view' && t2 && (this.tunnelType === 'http' || this.tunnelType === 'file') && getSettings().inspector_url
              ? html`
                <div class="section">
                  <div class="card" style="padding:0;">
                    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;
                      background:linear-gradient(135deg,var(--accent-bg-subtle, rgba(88,166,255,0.06)),rgba(163,113,247,0.04));
                      border-radius:var(--radius-lg);cursor:pointer;"
                      @click=${() => this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}/inspector`)}>
                      <span style="color:var(--accent);">${icon('search')}</span>
                      <div style="flex:1;">
                        <div style="font-size:var(--font-sm);font-weight:600;">${t('inspectorEntryTitle')}</div>
                        <div style="font-size:var(--font-sm);color:var(--text-muted);">${t('inspectorEntryDesc')}</div>
                      </div>
                      <span style="color:var(--text-muted);">&rarr;</span>
                    </div>
                  </div>
                </div>
              `
              : ''}

            <!-- Edit button (view mode only) -->
            ${this.mode === 'view' && t2
              ? html`
                <div class="section">
                  <button class="btn-edit-bottom" @click=${() => this._enterEdit()}>
                    ${icon('edit')} ${t('btnEdit')}
                  </button>
                </div>
              `
              : ''}
          `
          : ''}

        <!-- ── EDIT / CREATE MODE ──────────────────────────────────── -->
        ${this.mode !== 'view'
          ? html`
            <div class="section">
              <div class="card" style="padding:16px;">
                <!-- Type (readonly) -->
                <div class="form-group">
                  <label class="form-label">Type</label>
                  <input class="form-input" readonly .value=${typeLabel + ' Tunnel'}>
                </div>

                <!-- Name -->
                <div class="form-group">
                  <label class="form-label">${t('fieldName')}</label>
                  <input class="form-input" .value=${this._name} placeholder="My Tunnel"
                    @input=${(e: Event) => { this._name = (e.target as HTMLInputElement).value; }}>
                </div>

                <!-- Target / Directory -->
                <div class="form-group">
                  <label class="form-label">
                    ${this.tunnelType === 'file' ? t('fieldDirectory') : t('fieldEndpoint')}
                  </label>
                  <div class="dir-input-row">
                    <input class="form-input dir-input" .value=${this._endpoint}
                      placeholder=${this.tunnelType === 'http' ? 'host:port' : this.tunnelType === 'file' ? '/path/to/dir' : 'host:port'}
                      @input=${(e: Event) => { this._endpoint = (e.target as HTMLInputElement).value; }}>
                    ${this.tunnelType === 'file' && this._isNativeDirPicker
                      ? html`<button type="button" class="browse-btn"
                          @click=${this._browseDir}>📁 ${t('browseDirectory')}</button>`
                      : ''}
                  </div>
                </div>

                <!-- Hostname (HTTP only) -->
                ${this.tunnelType === 'http'
                  ? html`
                    <div class="form-group">
                      <label class="form-label">${t('fieldHostname')}</label>
                      <input class="form-input" .value=${this._hostname} placeholder="example.com"
                        @input=${(e: Event) => { this._hostname = (e.target as HTMLInputElement).value; }}>
                    </div>
                  `
                  : ''}

                <!-- TLS toggle (HTTP only) -->
                ${this.tunnelType === 'http'
                  ? html`
                    <div class="switch-row">
                      <span class="switch-label">${t('switchEnableTLS')}</span>
                      <div class="switch ${this._enableTLS ? 'on' : ''}"
                        @click=${() => { this._enableTLS = !this._enableTLS; }}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>
                  `
                  : ''}

                <!-- Auth section (HTTP/File) -->
                ${this.tunnelType === 'http' || this.tunnelType === 'file'
                  ? html`
                    <div class="switch-row" style="border-bottom:none;">
                      <span class="switch-label">${t('switchBasicAuth')}</span>
                      <div class="switch ${this._showAuth ? 'on' : ''}"
                        @click=${() => { this._showAuth = !this._showAuth; if (!this._showAuth) { this._username = ''; this._password = ''; } }}>
                        <div class="switch-knob"></div>
                      </div>
                    </div>

                    ${this._showAuth
                      ? html`
                        <div class="form-group" style="margin-top:12px;">
                          <label class="form-label">${t('fieldUsername')}</label>
                          <input class="form-input" .value=${this._username} placeholder="admin"
                            @input=${(e: Event) => { this._username = (e.target as HTMLInputElement).value; }}>
                        </div>
                        <div class="form-group">
                          <label class="form-label">${t('fieldPassword')}</label>
                          <input class="form-input" type="password" .value=${this._password} placeholder="••••"
                            @input=${(e: Event) => { this._password = (e.target as HTMLInputElement).value; }}>
                        </div>
                      `
                      : ''}

                    ${this.tunnelType === 'file'
                      ? html`
                        <div class="switch-row">
                          <span class="switch-label">${t('switchFileUpload')}</span>
                          <div class="switch ${this._fileUpload ? 'on' : ''}"
                            @click=${() => { this._fileUpload = !this._fileUpload; }}>
                            <div class="switch-knob"></div>
                          </div>
                        </div>
                      `
                      : ''}
                  `
                  : ''}

                <!-- Danger Zone (edit only) -->
                ${this.mode === 'edit'
                  ? html`
                    <div class="danger-zone">
                      <div class="danger-zone-label">Danger Zone</div>
                      <button class="pill-btn danger" @click=${() => { this._showDeleteDialog = true; }}>
                        ${icon('trash')} ${t('btnDelete')}
                      </button>
                    </div>
                  `
                  : ''}
              </div>
            </div>
          `
          : ''}

        ${this._snackbar ? html`<div class="toast">${this._snackbar}</div>` : ''}

        ${this._showResetDialog
          ? html`
            <div class="dialog-overlay" @click=${() => { this._showResetDialog = false; }}>
              <div class="dialog-box" @click=${(e: Event) => e.stopPropagation()}>
                <div class="dialog-title">${t('resetStatsConfirmTitle')}</div>
                <div class="dialog-message">${t('resetStatsConfirm')}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${() => { this._showResetDialog = false; }}>
                    ${t('btnCancel')}
                  </button>
                  <button class="dialog-btn danger" @click=${() => this._doResetStats()}>
                    ${t('btnResetStats')}
                  </button>
                </div>
              </div>
            </div>
          `
          : ''}

        ${this._showDeleteDialog
          ? html`
            <div class="dialog-overlay" @click=${() => { this._showDeleteDialog = false; }}>
              <div class="dialog-box" @click=${(e: Event) => e.stopPropagation()}>
                <div class="dialog-title">${t('deleteConfirmTitle')}</div>
                <div class="dialog-message">${t('deleteConfirmMessage')}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${() => { this._showDeleteDialog = false; }}>
                    ${t('btnCancel')}
                  </button>
                  <button class="dialog-btn danger" @click=${() => this._handleDelete()}>
                    ${t('btnDelete')}
                  </button>
                </div>
              </div>
            </div>
          `
          : ''}
      </app-scaffold>
    `;
  }
}
