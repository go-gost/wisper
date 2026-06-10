import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { getTunnels, refresh, remove, start, stop, toggleFavorite, subscribe } from '../store/tunnel-store';
import { getStats } from '../store/stats-store';
import { formatBytes, formatRate, formatNumber } from '../utils/format';
import { copyToClipboard } from '../utils/clipboard';
import type { Tunnel, TunnelType } from '../api/types';
import '../components/app-scaffold';
import '../components/stats-row';
import '../components/form-fields/file-form-fields';
import '../components/form-fields/http-form-fields';

type PageMode = 'view' | 'edit' | 'create';

@customElement('tunnel-detail-page')
export class TunnelDetailPage extends LitElement {
  @property() tunnelType: TunnelType = 'tcp';
  @property() tunnelId = '';

  @state() private mode: PageMode = 'view';
  @state() private _tunnel: Tunnel | null = null;
  @state() private _saving = false;
  @state() private _snackbar = '';
  @state() private _showDeleteDialog = false;

  // Form state
  @state() private _name = '';
  @state() private _endpoint = '';
  @state() private _hostname = '';
  @state() private _username = '';
  @state() private _password = '';
  @state() private _basicAuth = false;
  @state() private _enableTLS = false;
  @state() private _rewriteHost = false;
  @state() private _fileUpload = false;

  private _unsubs: (() => void)[] = [];

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
    if (id === 'new' || !id) {
      this.mode = 'create';
      this._tunnel = null;
      this._name = '';
      this._endpoint = '';
      this._hostname = '';
      this._username = '';
      this._password = '';
      this._basicAuth = false;
      this._enableTLS = false;
      this._rewriteHost = false;
      this._fileUpload = false;
      return;
    }

    const existing = getTunnels().find(t => t.id === id);
    if (existing) {
      this._tunnel = existing;
      if (this.mode !== 'edit') {
        this._populateForm(existing);
      }
    }
  }

  private _populateForm(t: Tunnel) {
    this._name = t.name;
    this._endpoint = t.endpoint;
    this._hostname = t.options.hostname ?? '';
    this._username = t.options.username ?? '';
    this._password = t.options.password ?? '';
    this._basicAuth = t.options.basic_auth ?? false;
    this._enableTLS = t.options.enableTLS ?? false;
    this._rewriteHost = t.options.rewriteHost ?? false;
    this._fileUpload = t.options.file_upload ?? false;
  }

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  private _enterEdit() {
    if (this._tunnel) this._populateForm(this._tunnel);
    this.mode = 'edit';
  }

  private _showSnackbar(msg: string) {
    this._snackbar = msg;
    setTimeout(() => { this._snackbar = ''; this.requestUpdate(); }, 3000);
  }

  private async _handleSave() {
    if (!this._name.trim()) {
      this._showSnackbar(t('requiredField'));
      return;
    }

    this._saving = true;
    try {
      const body = {
        name: this._name.trim(),
        type: this.tunnelType,
        endpoint: this._endpoint.trim(),
        hostname: this._hostname.trim() || undefined,
        username: this._username.trim() || undefined,
        password: this._password || undefined,
        enableTLS: this._enableTLS,
        rewriteHost: this._rewriteHost,
        file_upload: this._fileUpload,
      };

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

  private async _handleFavorite() {
    await toggleFavorite(this.tunnelId);
  }

  static styles = css`
    /* ── AppBar ── */
    .back-btn {
      background: none; border: none; cursor: pointer;
      font-size: 1.3rem; color: var(--color-text-primary); padding: 4px 8px;
      border-radius: 8px; display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--color-surface-variant); }

    .page-title { font-size: 1.15rem; font-weight: 600; flex: 1; }

    /* Buttons matching prototype */
    .appbar-btn {
      background: none; border: none; cursor: pointer;
      padding: 6px 10px; border-radius: 8px; color: var(--color-text-primary);
      font-size: 0.9rem; display: flex; align-items: center; gap: 4px;
      transition: background var(--transition-fast);
      font-family: inherit;
    }
    .appbar-btn:hover { background: var(--color-surface-variant); }

    .primary-btn {
      background: var(--color-primary); color: var(--color-primary-text);
      border-radius: 20px; padding: 6px 16px; font-weight: 500;
      border: none; cursor: pointer; font-size: 0.9rem; font-family: inherit;
      transition: background var(--transition-fast);
    }
    .primary-btn:hover { opacity: 0.9; }

    .stop-btn {
      background: var(--color-error); color: white;
      border-radius: 20px; padding: 6px 16px; font-weight: 500;
      border: none; cursor: pointer; font-size: 0.9rem; font-family: inherit;
      transition: background var(--transition-fast);
    }
    .stop-btn:hover { opacity: 0.9; }

    .danger-btn {
      color: var(--color-error);
      background: none; border: none; cursor: pointer;
      padding: 6px 10px; border-radius: 8px;
      font-size: 0.9rem; font-family: inherit;
    }
    .danger-btn:hover { background: var(--color-error-bg); }

    .fav-btn {
      font-size: 1.1rem; transition: color var(--transition-fast), transform 0.15s;
      background: none; border: none; cursor: pointer; padding: 6px 10px;
      border-radius: 8px; display: flex; align-items: center;
    }
    .fav-btn.active { color: var(--color-fav); }
    .fav-btn.inactive { color: var(--color-fav-off); }
    .fav-btn:active { transform: scale(1.3); }

    /* ── Detail Section ── */
    .detail-section {
      margin: 16px;
    }

    .detail-card {
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-card);
      padding: 20px;
      transition: background var(--transition-fast);
    }

    /* ── Copyable rows ── */
    .copyable-row {
      display: flex; align-items: center;
      padding: 8px 12px;
      background: var(--color-surface-variant);
      border-radius: var(--radius-md);
      margin-bottom: 10px;
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
      font-size: 0.85rem;
      word-break: break-all;
      gap: 8px;
    }
    .copyable-text { flex: 1; }
    .copy-btn {
      background: none; border: none; cursor: pointer;
      font-size: 1rem; color: var(--color-primary);
      padding: 4px; border-radius: 6px;
    }
    .copy-btn:hover { background: rgba(0,0,0,0.08); }

    /* ── Form fields ── */
    .form-group { margin-bottom: 16px; }
    .form-label {
      display: block;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--color-stopped);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%;
      padding: 12px 14px;
      border: 1.5px solid var(--color-input-border);
      border-radius: var(--radius-md);
      background: var(--color-input-bg);
      color: var(--color-text-primary);
      font-size: 0.95rem;
      font-family: inherit;
      outline: none;
      transition: border-color var(--transition-fast), background var(--transition-fast);
      box-sizing: border-box;
    }
    .form-input:focus { border-color: var(--color-primary); }
    .form-input[readonly] {
      background: transparent;
      border-color: transparent;
      cursor: default;
    }
    .form-input.error { border-color: var(--color-error); }
    .form-error {
      font-size: 0.8rem; color: var(--color-error); margin-top: 4px;
    }

    /* ── Stats ── */
    .stats-section { margin-top: 16px; }
    .stats-title { font-weight: 600; margin-bottom: 12px; font-size: 0.95rem; }

    .stats-badges {
      display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px;
    }
    .stats-badge {
      display: inline-flex; align-items: center; gap: 4px;
      background: var(--color-surface-variant);
      padding: 4px 10px; border-radius: 12px;
      font-size: 0.8rem; margin-right: 6px; margin-bottom: 4px;
    }

    /* ── Error banner ── */
    .error-banner {
      padding: 12px; background: var(--color-error-bg);
      border-radius: var(--radius-md); font-size: 0.85rem;
      color: var(--color-error); margin: 0 16px;
    }

    /* ── Toast (top, like prototype) ── */
    .toast {
      position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
      background: var(--color-toast-bg); color: var(--color-toast-fg);
      padding: 12px 24px; border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: 0.9rem; z-index: 100;
      display: flex; align-items: center; gap: 8px;
      max-width: 400px; transition: background var(--transition-fast);
      animation: toast-in 0.3s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    /* ── Delete Dialog Overlay ── */
    .dialog-overlay {
      position: fixed; inset: 0;
      background: var(--color-overlay);
      display: flex; align-items: center; justify-content: center;
      z-index: 200;
      animation: fade-in 0.2s ease;
    }
    @keyframes fade-in { from { opacity: 0; } }
    .dialog-box {
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      padding: 24px; max-width: 340px; width: 90%;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }
    .dialog-title { font-weight: 600; font-size: 1.1rem; margin-bottom: 12px; text-align: center; }
    .dialog-message { color: var(--color-stopped); font-size: 0.9rem; margin-bottom: 20px; text-align: center; line-height: 1.5; }
    .dialog-actions { display: flex; gap: 12px; justify-content: center; }
    .dialog-btn {
      padding: 10px 24px; border-radius: 20px; border: none;
      cursor: pointer; font-size: 0.9rem; font-weight: 500;
      transition: background var(--transition-fast);
      font-family: inherit;
    }
    .dialog-btn.cancel {
      background: var(--color-surface-variant); color: var(--color-text-primary);
    }
    .dialog-btn.danger {
      background: var(--color-error); color: white;
    }
    .dialog-btn:hover { opacity: 0.9; }
  `;

  render() {
    const t2 = this._tunnel;
    const stats = t2 ? (getStats(t2.id) ?? t2.stats) : null;

    const typeLabel = this.tunnelType.charAt(0).toUpperCase() + this.tunnelType.slice(1);

    return html`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${() => this._navigate('/')}>←</button>
          <span class="page-title">${this.mode === 'create' ? `${t('tunnelNewTitle')} — ${typeLabel}` : typeLabel}</span>

          ${this.mode === 'view' && t2 ? html`
            <button class="fav-btn ${t2.favorite ? 'active' : 'inactive'}" @click=${this._handleFavorite}>★</button>
            ${t2.status === 'running'
              ? html`<button class="stop-btn" @click=${this._handleStop}>■ ${t('btnStop')}</button>`
              : html`<button class="primary-btn" @click=${this._handleStart}>▶ ${t('btnStart')}</button>`
            }
            <button class="danger-btn" @click=${() => { this._showDeleteDialog = true; }}>🗑</button>
            <button class="appbar-btn" @click=${this._enterEdit}>✏ ${t('btnEdit')}</button>
          ` : html`
            <button class="primary-btn" ?disabled=${this._saving} @click=${this._handleSave}>
              ✓ ${t('btnSave')}
            </button>
          `}
        </div>

        ${this.mode === 'view' && t2 ? html`
          <!-- Error banner -->
          ${t2.error ? html`<div class="error-banner">${t2.error}</div>` : ''}

          <!-- View mode -->
          <div class="detail-section">
            <div class="detail-card">
              <!-- Copyable ID -->
              <div class="copyable-row">
                <span class="copyable-text">${t2.id}</span>
                <button class="copy-btn" @click=${async () => { await copyToClipboard(t2.id); this._showSnackbar('📋 ' + t('copiedToClipboard')); }}>📋</button>
              </div>
              <!-- Copyable Entrypoint -->
              <div class="copyable-row">
                <span class="copyable-text">${t2.entrypoint}</span>
                <button class="copy-btn" @click=${async () => { await copyToClipboard(t2.entrypoint); this._showSnackbar('📋 ' + t('copiedToClipboard')); }}>📋</button>
              </div>

              <!-- Name (read-only) -->
              <div class="form-group">
                <label class="form-label">${t('fieldName')}</label>
                <input class="form-input" readonly .value=${t2.name}>
              </div>
              <!-- Endpoint (read-only) -->
              ${this.tunnelType !== 'file' ? html`
                <div class="form-group" style="margin-bottom:0;">
                  <label class="form-label">${t('fieldEndpoint')}</label>
                  <input class="form-input" readonly .value=${t2.endpoint}>
                </div>
              ` : ''}
            </div>

            <!-- Stats -->
            ${stats ? html`
              <div class="stats-section">
                <div class="detail-card">
                  <div class="stats-title">${t('labelStatistics')}</div>
                  <div class="stats-badges">
                    <span class="stats-badge">↕ ${formatNumber(stats.current_conns)} / ${formatNumber(stats.total_conns)} connections</span>
                    <span class="stats-badge">⚡ ${formatRate(stats.request_rate)}</span>
                  </div>
                  <stats-row icon="↑" .value=${formatBytes(stats.input_bytes) + ' total'} .rate=${formatRate(stats.input_rate_bytes)}></stats-row>
                  <stats-row icon="↓" .value=${formatBytes(stats.output_bytes) + ' total'} .rate=${formatRate(stats.output_rate_bytes)}></stats-row>
                </div>
              </div>
            ` : ''}
          </div>
        ` : html`
          <!-- Edit/Create mode -->
          <div class="detail-section">
            <div class="detail-card">
              <div class="form-group">
                <label class="form-label">${t('fieldName')}</label>
                <input class="form-input" .value=${this._name} placeholder="Enter tunnel name"
                  @input=${(e: Event) => { this._name = (e.target as HTMLInputElement).value; }}>
              </div>
              ${this.tunnelType !== 'file' ? html`
                <div class="form-group">
                  <label class="form-label">${t('fieldEndpoint')}</label>
                  <input class="form-input" .value=${this._endpoint}
                    placeholder=${this.tunnelType === 'http' ? 'http://host:port' : 'host:port'}
                    @input=${(e: Event) => { this._endpoint = (e.target as HTMLInputElement).value; }}>
                </div>
              ` : ''}

              ${this.tunnelType === 'file' ? html`
                <file-form-fields
                  .directory=${this._endpoint}
                  .basicAuth=${this._basicAuth}
                  .username=${this._username}
                  .password=${this._password}
                  .fileUpload=${this._fileUpload}
                ></file-form-fields>
              ` : ''}

              ${this.tunnelType === 'http' ? html`
                <http-form-fields
                  .rewriteHost=${this._rewriteHost}
                  .hostname=${this._hostname}
                  .enableTLS=${this._enableTLS}
                ></http-form-fields>
              ` : ''}
            </div>
          </div>
        `}

        ${this._snackbar ? html`<div class="toast">${this._snackbar}</div>` : ''}

        ${this._showDeleteDialog ? html`
          <div class="dialog-overlay" @click=${() => { this._showDeleteDialog = false; }}>
            <div class="dialog-box" @click=${(e: Event) => { e.stopPropagation(); }}>
              <div class="dialog-title">${t('deleteConfirmTitle')}</div>
              <div class="dialog-message">${t('deleteConfirmMessage')}</div>
              <div class="dialog-actions">
                <button class="dialog-btn cancel" @click=${() => { this._showDeleteDialog = false; }}>${t('btnCancel')}</button>
                <button class="dialog-btn danger" @click=${this._handleDelete}>${t('btnDelete')}</button>
              </div>
            </div>
          </div>
        ` : ''}
      </app-scaffold>
    `;
  }
}
