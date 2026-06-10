import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { getEntrypoints, refresh, remove, start, stop, toggleFavorite, subscribe } from '../store/entrypoint-store';
import { getStats } from '../store/stats-store';
import { formatBytes, formatRate, formatNumber } from '../utils/format';
import { copyToClipboard } from '../utils/clipboard';
import type { Entrypoint, EntrypointType } from '../api/types';
import '../components/app-scaffold';
import '../components/stats-row';
import '../components/form-fields/entrypoint-form-fields';

type PageMode = 'view' | 'edit' | 'create';

@customElement('entrypoint-detail-page')
export class EntrypointDetailPage extends LitElement {
  @property() entrypointType: EntrypointType = 'tcp';
  @property() entrypointId = '';

  @state() private mode: PageMode = 'view';
  @state() private _entrypoint: Entrypoint | null = null;
  @state() private _saving = false;
  @state() private _snackbar = '';

  // Form state
  @state() private _name = '';
  @state() private _endpoint = '';
  @state() private _tunnelChain = '';
  @state() private _keepalive = false;
  @state() private _ttl = 0;

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
    const id = this.entrypointId;
    if (id === 'new' || !id) {
      this.mode = 'create';
      this._entrypoint = null;
      this._name = '';
      this._endpoint = '';
      this._tunnelChain = '';
      this._keepalive = false;
      this._ttl = 0;
      return;
    }

    const existing = getEntrypoints().find(e => e.id === id);
    if (existing) {
      this._entrypoint = existing;
      if (this.mode !== 'edit') {
        this._populateForm(existing);
      }
    }
  }

  private _populateForm(ep: Entrypoint) {
    this._name = ep.name;
    this._endpoint = ep.endpoint; // bind address
    this._tunnelChain = ep.entrypoint; // tunnel chain
    this._keepalive = ep.options.keepalive ?? false;
    this._ttl = ep.options.ttl ?? 0;
  }

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  private _enterEdit() {
    if (this._entrypoint) this._populateForm(this._entrypoint);
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
        type: this.entrypointType,
        endpoint: this._endpoint.trim(),
        hostname: this._tunnelChain.trim() || undefined,
        keepalive: this._keepalive,
        ttl: this._ttl > 0 ? this._ttl : undefined,
      };

      if (this.mode === 'create') {
        await import('../store/entrypoint-store').then(m => m.create(body));
        this._showSnackbar(t('saved'));
        this._navigate('/');
      } else {
        await import('../store/entrypoint-store').then(m => m.update(this.entrypointId, body));
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
      await remove(this.entrypointId);
      this._showSnackbar(t('deleted'));
      this._navigate('/');
    } catch {
      this._showSnackbar(t('deleteFailed'));
    }
  }

  private async _handleStart() {
    try {
      await start(this.entrypointId);
      this._showSnackbar(t('started'));
    } catch {
      this._showSnackbar(t('startFailed'));
    }
  }

  private async _handleStop() {
    try {
      await stop(this.entrypointId);
      this._showSnackbar(t('stopped'));
    } catch {
      this._showSnackbar(t('stopFailed'));
    }
  }

  private async _handleFavorite() {
    await toggleFavorite(this.entrypointId);
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
    const ep = this._entrypoint;
    const stats = ep ? (getStats(ep.id) ?? ep.stats) : null;

    const typeLabel = this.entrypointType.toUpperCase();

    return html`
      <app-scaffold>
        <div slot="appBar" class="title-row">
          <button class="back-btn" @click=${() => this._navigate('/')}>←</button>
          <span class="page-title">${this.mode === 'create' ? `${t('entrypointNewTitle')} — ${typeLabel}` : typeLabel}</span>
          <div class="actions">
            ${this.mode === 'view' && ep ? html`
              <button class="btn" @click=${this._handleFavorite}>${ep.favorite ? '★' : '☆'}</button>
              ${ep.status === 'running'
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

        ${this.mode === 'view' && ep ? html`
          ${ep.error ? html`<div class="error-banner">${ep.error}</div>` : ''}

          <div class="section">
            <div class="section-title">${t('fieldEndpoint')}</div>
            <div class="copy-field">
              <code>${ep.id}</code>
              <button class="icon-btn" @click=${async () => { await copyToClipboard(ep.id); this._showSnackbar(t('copiedToClipboard')); }}>📋</button>
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

          <div class="section">
            <div class="field"><label>${t('fieldName')}</label><input type="text" .value=${ep.name} readonly></div>
            <div class="field"><label>${t('fieldBindAddress')}</label><input type="text" .value=${ep.endpoint} readonly></div>
            <div class="field"><label>${t('fieldTunnelChain')}</label><input type="text" .value=${ep.entrypoint} readonly></div>
          </div>
        ` : html`
          <div class="section">
            <div class="field">
              <label>${t('fieldName')} *</label>
              <input type="text" .value=${this._name} @input=${(e: Event) => { this._name = (e.target as HTMLInputElement).value; }}>
            </div>
            <div class="field">
              <label>${t('fieldBindAddress')}</label>
              <input type="text" .value=${this._endpoint} @input=${(e: Event) => { this._endpoint = (e.target as HTMLInputElement).value; }}>
            </div>
            <div class="field">
              <label>${t('fieldTunnelChain')}</label>
              <input type="text" .value=${this._tunnelChain} @input=${(e: Event) => { this._tunnelChain = (e.target as HTMLInputElement).value; }}>
            </div>
            <entrypoint-form-fields
              .keepalive=${this._keepalive}
              .ttl=${this._ttl}
            ></entrypoint-form-fields>
          </div>
        `}

        ${this._snackbar ? html`<div class="snackbar">${this._snackbar}</div>` : ''}
      </app-scaffold>
    `;
  }
}
