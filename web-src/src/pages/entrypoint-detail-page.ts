import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { getEntrypoints, refresh, remove, start, stop, subscribe } from '../store/entrypoint-store';
import { copyToClipboard } from '../utils/clipboard';
import type { Entrypoint, EntrypointType } from '../api/types';
import '../components/app-scaffold';

type PageMode = 'view' | 'edit' | 'create';

@customElement('entrypoint-detail-page')
export class EntrypointDetailPage extends LitElement {
  @property() entrypointType: EntrypointType = 'tcp';
  @property() entrypointId = '';

  // ── State ────────────────────────────────────────────────────────────

  @state() private mode: PageMode = 'view';
  @state() private _entrypoint: Entrypoint | null = null;
  @state() private _saving = false;
  @state() private _snackbar = '';
  @state() private _showDeleteDialog = false;

  // Form fields
  @state() private _name = '';
  @state() private _endpoint = '';
  @state() private _tunnelId = '';

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
    const id = this.entrypointId;
    const isEdit = window.location.search.includes('edit');

    if (id === 'new' || !id) {
      // Guard: don't reset form fields on every store update (stats polling).
      if (this.mode === 'create') return;
      this.mode = 'create';
      this._entrypoint = null;
      this._resetForm();
      return;
    }

    // Guard: when already editing this entrypoint, skip re-population triggered
    // by store updates (e.g. stats polling every 1s).
    if (this.mode === 'edit' && this._entrypoint?.id === id) return;

    const existing = getEntrypoints().find(e => e.id === id);
    if (existing) {
      this._entrypoint = existing;
      if (isEdit) {
        this.mode = 'edit';
        this._populateForm(existing);
      } else {
        if (this.mode !== 'edit' || this._entrypoint?.id !== id) {
          this.mode = 'view';
          this._populateForm(existing);
        }
      }
    }
  }

  private _resetForm() {
    this._name = '';
    this._endpoint = '';
    this._tunnelId = '';
  }

  private _populateForm(ep: Entrypoint) {
    this._name = ep.name;
    // ep.entrypoint is the local bind address (e.g. :8080)
    this._endpoint = ep.entrypoint;
    this._tunnelId = ep.options.hostname ?? '';
  }

  // ── Navigation ───────────────────────────────────────────────────────

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  private _enterEdit() {
    if (this._entrypoint) {
      this._populateForm(this._entrypoint);
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
      const body = {
        name: this._name.trim(),
        type: this.entrypointType,
        endpoint: this._endpoint.trim(),
        hostname: this._tunnelId.trim() || undefined,
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
    this._showDeleteDialog = false;
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

  private async _handleCopy(text: string) {
    await copyToClipboard(text);
    this._showSnackbar(t('copiedToClipboard'));
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private _typeLabel(): string {
    return this.entrypointType.toUpperCase();
  }

  // ── Styles ───────────────────────────────────────────────────────────

  static styles = css`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }

    .page-title { font-size: var(--font-md); font-weight: 600; flex: 1; }

    .appbar-btn {
      background: none; border: none; cursor: pointer;
      padding: 4px 8px; border-radius: var(--radius-sm);
      color: var(--text-secondary); font-size: var(--font-sm);
      display: flex; align-items: center; gap: 3px;
      font-family: inherit;
      transition: background var(--transition-fast);
    }
    .appbar-btn:hover { background: var(--border-subtle); }

    .pill-btn {
      padding: 5px 14px; border-radius: var(--radius-pill);
      border: none; cursor: pointer;
      font-size: var(--font-sm); font-weight: 500; font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pill-btn.primary { background: var(--accent); color: var(--accent-fg); }
    .pill-btn.danger { background: var(--red); color: #fff; }
    .pill-btn:hover { opacity: 0.85; }
    .pill-btn.appbar-action { margin-left: auto; }

    /* ── Layout ── */
    .section { padding: 16px; }

    /* ── Status banner ── */
    .status-banner {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px; margin: 0 16px;
      border-radius: var(--radius-md); font-size: var(--font-sm); font-weight: 500;
    }
    .status-banner.running {
      background: var(--green-bg); color: var(--green-text);
      border: 1px solid var(--green-border);
    }
    .status-banner.stopped {
      background: var(--border-subtle); color: var(--text-muted);
    }
    .status-banner.error {
      background: var(--red-bg); color: var(--red-text);
      border: 1px solid var(--red-border);
    }

    .status-dot-mini {
      width: 6px; height: 6px; border-radius: 50%; background: currentColor;
    }
    .status-spacer { flex: 1; }

    /* ── Info card ── */
    .card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }

    .info-row {
      display: flex; align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      gap: 8px;
    }
    .info-row:last-child { border-bottom: none; }

    .info-label {
      font-size: var(--font-sm); font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.5px;
      width: 80px; flex-shrink: 0;
    }
    .info-value {
      font-size: var(--font-lg); color: var(--text);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      flex: 1; word-break: break-all;
    }
    .info-value.text {
      font-family: inherit; font-size: var(--font-lg);
    }
    .info-value.uuid {
      font-size: var(--font-sm);
    }

    .copy-btn-mini {
      background: none; border: none; cursor: pointer;
      padding: 2px; color: var(--text-muted); display: flex;
      border-radius: 3px;
    }
    .copy-btn-mini:hover { background: var(--border-subtle); color: var(--text); }

    /* ── Form ── */
    .form-group { margin-bottom: 14px; }
    .form-label {
      display: block;
      font-size: var(--font-xs); font-weight: 500; color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%; padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface); color: var(--text);
      font-size: var(--font-sm); font-family: inherit; outline: none;
      box-sizing: border-box;
      transition: border-color var(--transition-fast);
    }
    .form-input:focus { border-color: var(--accent); }
    .form-input[readonly] {
      background: var(--border-subtle); color: var(--text-muted);
    }

    /* ── Danger zone ── */
    .danger-zone {
      margin-top: 20px; padding: 14px;
      border: 1px solid var(--red-border);
      border-radius: var(--radius-md);
    }
    .danger-zone-label {
      font-size: var(--font-xs); font-weight: 600; color: var(--red-text);
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
    }

    /* ── Toast ── */
    .toast {
      position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
      background: var(--surface); color: var(--text);
      padding: 10px 20px; border-radius: var(--radius-lg);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: var(--font-sm); z-index: 100;
      animation: toast-in 0.3s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    /* ── Delete dialog ── */
    .dialog-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      z-index: 200;
      animation: fade-in 0.15s ease;
    }
    @keyframes fade-in { from { opacity: 0; } }
    .dialog-box {
      background: var(--surface);
      border-radius: var(--radius-lg);
      padding: 24px; max-width: 320px; width: 90%;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }
    .dialog-title { font-weight: 600; font-size: var(--font-md); margin-bottom: 8px; text-align: center; }
    .dialog-message { color: var(--text-secondary); font-size: var(--font-sm); margin-bottom: 20px; text-align: center; line-height: 1.5; }
    .dialog-actions { display: flex; gap: 10px; justify-content: center; }
    .dialog-btn {
      padding: 8px 20px; border-radius: var(--radius-pill);
      border: none; cursor: pointer;
      font-size: var(--font-sm); font-weight: 500; font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .dialog-btn.cancel { background: var(--border-subtle); color: var(--text); }
    .dialog-btn.danger { background: var(--red); color: #fff; }
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
    }
    .btn-edit-bottom:hover { opacity: 0.8; }
  `;

  // ── Render ───────────────────────────────────────────────────────────

  render() {
    const ep = this._entrypoint;
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
              ? `${t('entrypointNewTitle')} — ${typeLabel}`
              : typeLabel + ' Entrypoint'}
          </span>

          ${this.mode === 'view' && ep
            ? html`
              ${ep.status === 'running'
                ? html`<button class="pill-btn danger appbar-action" @click=${this._handleStop}>
                  ■ ${t('btnStop')}
                </button>`
                : html`<button class="pill-btn primary appbar-action" @click=${this._handleStart}>
                  ▶ ${t('btnStart')}
                </button>`}
            `
            : html`
              <button class="pill-btn primary appbar-action" ?disabled=${this._saving} @click=${this._handleSave}>
                ${icon('check')} ${t('btnSave')}
              </button>
            `}
        </div>

        <!-- ── VIEW MODE ───────────────────────────────────────────── -->
        ${this.mode === 'view' && ep
          ? html`
            <!-- Status banner -->
            <div class="status-banner ${ep.status}">
              <span class="status-dot-mini"></span>
              ${ep.status === 'running'
                ? t('statusRunning')
                : ep.status === 'error'
                  ? t('statusError')
                  : t('statusStopped')}
              ${ep.error ? html` — ${ep.error}` : ''}
              <span class="status-spacer"></span>
            </div>

            <!-- Info card -->
            <div class="section">
              <div class="card">
                <div class="info-row">
                  <span class="info-label">Type</span>
                  <span class="info-value text">${typeLabel} Entrypoint</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Tunnel ID</span>
                  <span class="info-value uuid">${ep.options.hostname ?? '—'}</span>
                  ${ep.options.hostname
                    ? html`<button class="copy-btn-mini" @click=${() => this._handleCopy(ep.options.hostname)}>
                      ${icon('copy')}
                    </button>`
                    : ''}
                </div>
                <div class="info-row">
                  <span class="info-label">Name</span>
                  <span class="info-value text">${ep.name}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Bind Address</span>
                  <span class="info-value">${ep.entrypoint}</span>
                </div>
              </div>
            </div>
          `
          : ''}

            <!-- Edit button (view mode only) -->
            ${this.mode === 'view' && ep
              ? html`
                <div class="section">
                  <button class="btn-edit-bottom" @click=${this._enterEdit}>
                    ${icon('edit')} ${t('btnEdit')}
                  </button>
                </div>
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
                  <input class="form-input" readonly .value=${typeLabel + ' Entrypoint'}>
                </div>

                <!-- Tunnel ID -->
                <div class="form-group">
                  <label class="form-label">Tunnel ID</label>
                  <input class="form-input"
                    ?readonly=${this.mode === 'edit'}
                    .value=${this._tunnelId}
                    placeholder="Paste tunnel UUID"
                    @input=${(e: Event) => { this._tunnelId = (e.target as HTMLInputElement).value; }}>
                </div>

                <!-- Name -->
                <div class="form-group">
                  <label class="form-label">${t('fieldName')}</label>
                  <input class="form-input" .value=${this._name} placeholder="My Entrypoint"
                    @input=${(e: Event) => { this._name = (e.target as HTMLInputElement).value; }}>
                </div>

                <!-- Bind Address -->
                <div class="form-group">
                  <label class="form-label">${t('fieldBindAddress')}</label>
                  <input class="form-input" .value=${this._endpoint} placeholder="0.0.0.0:9090"
                    @input=${(e: Event) => { this._endpoint = (e.target as HTMLInputElement).value; }}>
                </div>

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
                  <button class="dialog-btn danger" @click=${this._handleDelete}>
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
