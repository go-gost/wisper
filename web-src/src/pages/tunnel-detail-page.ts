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
    if (!confirm(t('deleteConfirmMessage'))) return;
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
    .title-row { display: flex; align-items: center; gap: 8px; }
    .back-btn {
      background: none; border: none; cursor: pointer; font-size: 18px;
      padding: 4px; color: var(--color-text-secondary); border-radius: 50%;
      width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
    }
    .back-btn:hover { background: var(--color-surface-hover); }
    .page-title { font-size: 18px; font-weight: 600; flex: 1; }
    .actions { display: flex; gap: 6px; }

    .btn {
      padding: 6px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-pill);
      font-size: 13px; font-weight: 500; cursor: pointer; transition: all var(--transition-fast);
      background: var(--color-surface); color: var(--color-text-primary);
    }
    .btn:hover { background: var(--color-surface-hover); }
    .btn.primary { background: var(--color-primary); color: var(--color-primary-text); border-color: var(--color-primary); }
    .btn.primary:hover { background: var(--color-primary-hover); }
    .btn.danger { color: var(--color-error); border-color: var(--color-error); }
    .btn.danger:hover { background: var(--color-error-bg); }
    .btn.start { color: var(--color-running); border-color: var(--color-running); }
    .btn.stop { color: var(--color-error); border-color: var(--color-error); }

    .section { margin-top: 20px; }
    .section-title { font-size: 14px; font-weight: 600; color: var(--color-text-secondary); margin-bottom: 10px; }

    .field { margin-bottom: 16px; }
    .field label { display: block; font-size: 13px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 4px; }
    .field input {
      width: 100%; padding: 10px 12px; border: 1px solid var(--color-border);
      border-radius: var(--radius-sm); background: var(--color-surface);
      color: var(--color-text-primary); font-size: 14px; font-family: inherit;
      box-sizing: border-box; transition: border-color var(--transition-fast);
    }
    .field input:focus { border-color: var(--color-primary); outline: none; }
    .field input:read-only { background: var(--color-surface-hover); color: var(--color-text-secondary); }

    .copy-field {
      display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
    }
    .copy-field code {
      flex: 1; padding: 8px 12px; background: var(--color-surface-hover);
      border-radius: var(--radius-sm); font-size: 13px; font-family: monospace;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--color-text-primary);
    }
    .icon-btn {
      background: none; border: none; cursor: pointer; font-size: 16px;
      padding: 6px; border-radius: var(--radius-sm); color: var(--color-text-muted);
    }
    .icon-btn:hover { background: var(--color-surface-hover); color: var(--color-text-primary); }

    .stats-grid {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 12px; margin-top: 12px;
    }
    .stat-badge {
      padding: 10px 12px; background: var(--color-surface);
      border: 1px solid var(--color-border); border-radius: var(--radius-sm);
      font-size: 12px; color: var(--color-text-secondary);
    }
    .stat-badge .val { font-weight: 600; color: var(--color-text-primary); font-size: 15px; }
    .stat-badge .rate { font-size: 11px; color: var(--color-text-muted); }

    .error-banner {
      padding: 12px; background: var(--color-error-bg); border-radius: var(--radius-sm);
      font-size: 13px; color: var(--color-error); margin-top: 12px;
    }

    .snackbar {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      padding: 10px 20px; background: #333; color: white;
      border-radius: var(--radius-pill); font-size: 13px;
      z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: snackIn 0.3s ease;
    }
    @keyframes snackIn { from { opacity: 0; transform: translateX(-50%) translateY(10px); } }
  `;

  render() {
    const t2 = this._tunnel;
    const stats = t2 ? (getStats(t2.id) ?? t2.stats) : null;

    const typeLabel = this.tunnelType.charAt(0).toUpperCase() + this.tunnelType.slice(1);

    return html`
      <app-scaffold>
        <div slot="appBar" class="title-row">
          <button class="back-btn" @click=${() => this._navigate('/')}>←</button>
          <span class="page-title">${this.mode === 'create' ? `${t('tunnelNewTitle')} — ${typeLabel}` : typeLabel}</span>
          <div class="actions">
            ${this.mode === 'view' && t2 ? html`
              <button class="btn" @click=${this._handleFavorite}>${t2.favorite ? '★' : '☆'}</button>
              ${t2.status === 'running'
                ? html`<button class="btn stop" @click=${this._handleStop}>${t('btnStop')}</button>`
                : html`<button class="btn start" @click=${this._handleStart}>${t('btnStart')}</button>`
              }
              <button class="btn" @click=${this._enterEdit}>${t('btnEdit')}</button>
              <button class="btn danger" @click=${this._handleDelete}>${t('btnDelete')}</button>
            ` : html`
              <button class="btn primary" ?disabled=${this._saving} @click=${this._handleSave}>
                ${this._saving ? '...' : t('btnSave')}
              </button>
            `}
          </div>
        </div>

        ${this.mode === 'view' && t2 ? html`
          <!-- View mode -->
          ${t2.error ? html`<div class="error-banner">${t2.error}</div>` : ''}

          <div class="section">
            <div class="section-title">${t('fieldEndpoint')}</div>
            <div class="copy-field">
              <code>${t2.id}</code>
              <button class="icon-btn" @click=${async () => { await copyToClipboard(t2.id); this._showSnackbar(t('copiedToClipboard')); }}>📋</button>
            </div>
            <div class="copy-field">
              <code>${t2.entrypoint}</code>
              <button class="icon-btn" @click=${async () => { await copyToClipboard(t2.entrypoint); this._showSnackbar(t('copiedToClipboard')); }}>📋</button>
            </div>
          </div>

          <div class="section">
            <div class="section-title">${t('labelStatistics')}</div>
            ${stats ? html`
              <div class="stats-grid">
                <div class="stat-badge"><div class="val">${formatNumber(stats.current_conns)}</div><div class="rate">${formatRate(stats.request_rate)}</div></div>
                <div class="stat-badge"><div class="val">${formatNumber(stats.total_conns)}</div><div class="rate">total</div></div>
                <div class="stat-badge"><div class="val">${formatBytes(stats.input_bytes)}</div><div class="rate">${formatRate(stats.input_rate_bytes)}</div></div>
                <div class="stat-badge"><div class="val">${formatBytes(stats.output_bytes)}</div><div class="rate">${formatRate(stats.output_rate_bytes)}</div></div>
              </div>
            ` : html`<div style="color:var(--color-text-muted);font-size:13px;">Loading...</div>`}
          </div>

          <!-- Read-only fields -->
          <div class="section">
            <div class="field"><label>${t('fieldName')}</label><input type="text" .value=${t2.name} readonly></div>
            ${this.tunnelType !== 'file' ? html`<div class="field"><label>${t('fieldEndpoint')}</label><input type="text" .value=${t2.endpoint} readonly></div>` : ''}
          </div>
        ` : html`
          <!-- Edit/Create mode -->
          <div class="section">
            <div class="field">
              <label>${t('fieldName')} *</label>
              <input type="text" .value=${this._name} @input=${(e: Event) => { this._name = (e.target as HTMLInputElement).value; }}>
            </div>
            ${this.tunnelType !== 'file' ? html`
              <div class="field">
                <label>${t('fieldEndpoint')}</label>
                <input type="text" .value=${this._endpoint} @input=${(e: Event) => { this._endpoint = (e.target as HTMLInputElement).value; }}>
              </div>
            ` : ''}

            ${this.tunnelType === 'file' ? html`
              <file-form-fields
                .directory=${this._name}
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
        `}

        ${this._snackbar ? html`<div class="snackbar">${this._snackbar}</div>` : ''}
      </app-scaffold>
    `;
  }
}
