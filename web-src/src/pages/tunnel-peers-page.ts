import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { getTunnels, subscribe, updatePeers } from '../store/tunnel-store';
import { copyToClipboard } from '../utils/clipboard';
import { formatBytes, formatRate, formatNumber, maskKey } from '../utils/format';
import { transportStyle } from '../utils/transport';
import type { Peer, Tunnel } from '../api/types';
import '../components/app-scaffold';

/** One allowlist row. */
interface PeerRow {
  key: string;
  alias: string;
  /** Switched off: kept on the list, given no route. */
  disabled: boolean;
}

/**
 * validPeerKey mirrors the API's check: a base64 (raw url) 32-byte public key,
 * i.e. 43 characters of the url-safe alphabet. An entry that is not a key is a
 * route nothing ever matches, so a row with one refuses to save.
 */
function validPeerKey(k: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(k)) return false;
  try {
    const padded = k + '='.repeat((4 - (k.length % 4)) % 4);
    return atob(padded.replace(/-/g, '+').replace(/_/g, '/')).length === 32;
  } catch {
    return false;
  }
}

function rowsOf(t2: Tunnel | null): PeerRow[] {
  return (t2?.options.peers ?? []).map((p: Peer) => ({
    key: p.key,
    alias: p.alias ?? '',
    disabled: p.disabled === true,
  }));
}

/**
 * The allowlist manager of a p2p tunnel. The list is read-only by default —
 * the key is a credential, so it stays masked until revealed — and one row at
 * a time is edited and saved. Saving applies in place: the process-wide host
 * reconciles this tunnel's routes, so live peer streams keep running and a
 * removed peer simply stops reaching the tunnel.
 */
@customElement('tunnel-peers-page')
export class TunnelPeersPage extends LitElement {
  @property() tunnelType = '';
  @property() tunnelId = '';

  @state() private _tunnel: Tunnel | null = null;
  /** The saved list, rendered read-only. */
  @state() private _rows: PeerRow[] = [];
  /** Index of the row being edited, or 'new' for the draft row. */
  @state() private _editing: number | 'new' | null = null;
  /** The row's edit buffer. */
  @state() private _draft: PeerRow = { key: '', alias: '', disabled: false };
  @state() private _saving = false;
  @state() private _rowError = '';
  @state() private _confirmDelete: number | null = null;
  @state() private _showKeys = false;
  @state() private _snackbar = '';
  private _unsub: (() => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    this._load();
    // The stats task refreshes the tunnel each second: re-render for the rows'
    // live columns. Reloading whole rather than patching _tunnel in place also
    // covers the cold deep link, where the store only arrives after _load ran
    // and the rows — what this page is for — would otherwise stay empty.
    this._unsub = subscribe(() => this._load());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
  }

  private _load() {
    const t2 = getTunnels().find(x => x.id === this.tunnelId) ?? null;
    this._tunnel = t2;
    this._rows = rowsOf(t2);
  }

  private _startEdit(i: number) {
    this._editing = i;
    this._draft = { ...this._rows[i] };
    this._rowError = '';
  }

  private _startAdd() {
    this._editing = 'new';
    this._draft = { key: '', alias: '', disabled: false };
    this._rowError = '';
  }

  private _cancelEdit() {
    this._editing = null;
    this._rowError = '';
  }

  /** _toggleRow switches a peer off or back on and saves. Off keeps the row
   *  (and its key) in place and only takes its route away, so it can be
   *  switched back on without retyping the key. */
  private _toggleRow = async (i: number) => {
    const next = this._rows.map((r, j) => (j === i ? { ...r, disabled: !r.disabled } : r));
    await this._save(next);
  };

  /** _saveRow persists the draft (replacing or appending) and re-reads the list. */
  private _saveRow = async () => {
    const draft = {
      key: this._draft.key.trim(),
      alias: this._draft.alias.trim(),
      // The editor does not touch the switch; an edited row keeps its state.
      disabled: this._draft.disabled === true,
    };
    if (!validPeerKey(draft.key)) {
      this._rowError = t('peersKeyInvalid');
      return;
    }
    const others = this._rows.filter((_, i) => i !== this._editing);
    if (others.some(r => r.key === draft.key)) {
      this._rowError = t('peersKeyDuplicate');
      return;
    }

    const next =
      this._editing === 'new'
        ? [...this._rows, draft]
        : this._rows.map((r, i) => (i === this._editing ? draft : r));

    if (await this._save(next)) {
      this._editing = null;
      this._rowError = '';
    }
  };

  private _deleteRow = async (i: number) => {
    this._confirmDelete = null;
    await this._save(this._rows.filter((_, j) => j !== i));
  };

  /** _save writes the whole list; the API replaces it atomically. */
  private async _save(rows: PeerRow[]): Promise<boolean> {
    if (this._saving) return false;
    this._saving = true;
    try {
      const t2 = await updatePeers(
        this.tunnelId,
        rows.map(r => ({ key: r.key, alias: r.alias || undefined, disabled: r.disabled || undefined })),
      );
      this._tunnel = t2;
      this._rows = rowsOf(t2);
      this._showSnackbar(t('saved'));
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      const text = `${t('saveFailed')}${msg ? ': ' + msg : ''}`;
      if (this._editing !== null) this._rowError = text;
      else this._showSnackbar(text);
      return false;
    } finally {
      this._saving = false;
    }
  }

  private _showSnackbar(msg: string) {
    this._snackbar = msg;
    setTimeout(() => {
      this._snackbar = '';
    }, 2500);
  }

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  private _statFor(key: string) {
    return (this._tunnel?.peer_stats ?? []).find(s => s.key === key);
  }

  private _renderStats(key: string) {
    const stat = this._statFor(key);
    if (!stat) return html`<span class="muted">${t('peersNoTraffic')}</span>`;
    return html`
      <span>${formatNumber(stat.current_conns)} ${t('p2pColConns')}</span>
      <span>↓ ${formatBytes(stat.output_bytes)} <span class="rate">${formatRate(stat.output_rate_bytes)}</span></span>
      <span>↑ ${formatBytes(stat.input_bytes)} <span class="rate">${formatRate(stat.input_rate_bytes)}</span></span>
    `;
  }

  /** _renderTransport marks where this peer's traffic goes right now — the
   *  only place the difference between peers shows. The badge stays one word
   *  per state; the reason (a STUN server that does not answer, a punch that
   *  failed, ...) is in the tooltip. Nothing when the peer has no session. */
  private _renderTransport(key: string) {
    const st = transportStyle(this._statFor(key)?.transport);
    if (!st) return nothing;
    return html`<span class="peer-badge ${st.tone}" title=${st.hint}>
      ${icon(st.icon)}<span>${st.label}</span>
    </span>`;
  }

  private _renderEditor() {
    return html`
      <div class="peer-row editing">
        <div class="row-line">
          <input class="form-input alias grow" .value=${this._draft.alias}
            placeholder=${t('peersAliasPlaceholder')}
            @input=${(e: Event) => {
              this._draft = { ...this._draft, alias: (e.target as HTMLInputElement).value };
            }}>
          <button class="icon-btn" title="${t('btnCancel')}" @click=${() => this._cancelEdit()}>
            ${icon('close')}
          </button>
          <button class="icon-btn accent" title="${t('btnSave')}" ?disabled=${this._saving}
            @click=${this._saveRow}>
            ${icon('check')}
          </button>
        </div>
        <input class="form-input key ${this._rowError ? 'invalid' : ''}" .value=${this._draft.key}
          placeholder=${t('peersKeyPlaceholder')}
          @input=${(e: Event) => {
            this._draft = { ...this._draft, key: (e.target as HTMLInputElement).value };
            this._rowError = '';
          }}>
        ${this._rowError ? html`<div class="row-error">${this._rowError}</div>` : nothing}
      </div>
    `;
  }

  render() {
    const t2 = this._tunnel;

    return html`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${() => this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}`)}>
            ${icon('chevron-left')}
          </button>
          <span class="page-title">${t('peersTitle')}</span>
          <button class="pill-btn appbar-action" title="${this._showKeys ? t('hideKey') : t('revealKey')}"
            @click=${() => { this._showKeys = !this._showKeys; }}>
            ${icon(this._showKeys ? 'eye-off' : 'eye')}
          </button>
        </div>

        ${t2
          ? html`
            <div class="section">
              <div class="card">
                ${this._rows.length === 0 && this._editing !== 'new'
                  ? html`<div class="empty">${t('peersEmpty')}</div>`
                  : nothing}
                ${this._rows.map((row, i) => {
                  if (this._editing === i) return this._renderEditor();
                  return html`
                    <div class="peer-row ${row.disabled ? 'off' : ''}">
                      <div class="row-line">
                        <span class="peer-alias">${row.alias || t('peersNoAlias')}</span>
                        ${row.disabled
                          ? html`<span class="peer-badge" title=${t('peersDisabledHint')}>${t('peersDisabled')}</span>`
                          : this._renderTransport(row.key)}
                        <span class="row-actions">
                          <button class="icon-btn" title="${row.disabled ? t('peersEnable') : t('peersDisable')}"
                            ?disabled=${this._saving}
                            @click=${() => this._toggleRow(i)}>
                            ${icon(row.disabled ? 'play' : 'stop')}
                          </button>
                          <button class="icon-btn" title="${t('btnCopy')}" @click=${() => copyToClipboard(row.key)}>
                            ${icon('copy')}
                          </button>
                          <button class="icon-btn" title="${t('btnEdit')}" @click=${() => this._startEdit(i)}>
                            ${icon('edit')}
                          </button>
                          <button class="icon-btn danger" title="${t('btnDelete')}"
                            @click=${() => { this._confirmDelete = i; }}>
                            ${icon('trash')}
                          </button>
                        </span>
                      </div>
                      <div class="peer-key">${this._showKeys ? row.key : maskKey(row.key)}</div>
                      <div class="peer-stats">${this._renderStats(row.key)}</div>
                    </div>
                  `;
                })}
                ${this._editing === 'new' ? this._renderEditor() : nothing}

                ${this._editing === null
                  ? html`
                    <button class="add-row" @click=${() => this._startAdd()}>
                      ${icon('plus')} ${t('peersAdd')}
                    </button>`
                  : nothing}
              </div>

              <div class="hint">${t('peersHint')}</div>
              <div class="hint">${t('peersRestartHint')}</div>
              ${this._rows.length === 0 ? html`<div class="hint">${t('peersNoneHint')}</div>` : nothing}
            </div>
          `
          : html`<div class="section"><div class="card"><div class="empty">${t('notFound')}</div></div></div>`}

        ${this._confirmDelete !== null
          ? html`
            <div class="dialog-overlay" @click=${() => { this._confirmDelete = null; }}>
              <div class="dialog-box" @click=${(e: Event) => e.stopPropagation()}>
                <div class="dialog-title">${t('deleteConfirmTitle')}</div>
                <div class="dialog-message">${t('deleteConfirmMessage')}</div>
                <div class="dialog-actions">
                  <button class="dialog-btn cancel" @click=${() => { this._confirmDelete = null; }}>
                    ${t('btnCancel')}
                  </button>
                  <button class="dialog-btn danger" ?disabled=${this._saving}
                    @click=${() => this._deleteRow(this._confirmDelete!)}>
                    ${t('btnDelete')}
                  </button>
                </div>
              </div>
            </div>`
          : nothing}

        ${this._snackbar ? html`<div class="toast">${this._snackbar}</div>` : nothing}
      </app-scaffold>
    `;
  }

  static styles = css`
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
      background: var(--border-subtle);
      color: var(--text);
    }
    .pill-btn:hover {
      opacity: 0.85;
    }
    .pill-btn svg {
      width: 14px;
      height: 14px;
    }
    .pill-btn.appbar-action {
      margin-left: auto;
    }

    .section {
      padding: 16px;
    }
    .card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }
    .empty {
      padding: 24px 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: var(--font-sm);
    }

    .peer-row {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .row-line {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .peer-alias {
      flex: 1;
      font-size: var(--font-sm);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .peer-badge {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 8px;
      border-radius: var(--radius-pill);
      background: var(--border-subtle);
      color: var(--text-muted);
      font-size: var(--font-sm);
    }
    .peer-badge svg {
      width: 12px;
      height: 12px;
    }
    .peer-badge.direct {
      color: var(--green-text);
      background: var(--green-bg);
    }
    .peer-badge.warn {
      color: var(--amber);
    }
    /* A switched-off peer keeps its place and its key, but nothing about it is
       live: the row reads dimmed. */
    .peer-row.off .peer-alias,
    .peer-row.off .peer-key,
    .peer-row.off .peer-stats {
      opacity: 0.5;
    }
    .row-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .peer-key {
      padding-top: 2px;
      font-family: var(--font-mono, monospace);
      font-size: var(--font-xs);
      color: var(--text-muted);
      overflow-wrap: anywhere;
      line-height: 1.4;
    }
    .peer-stats {
      display: flex;
      gap: 16px;
      padding-top: 6px;
      font-size: var(--font-xs);
      color: var(--text-muted);
    }
    .peer-stats .muted {
      font-style: italic;
    }
    .peer-stats .rate {
      color: var(--text-muted);
      opacity: 0.8;
    }

    .form-input {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-subtle);
      background: var(--bg);
      color: var(--text);
      font-size: var(--font-sm);
      font-family: inherit;
    }
    .form-input:focus {
      outline: none;
      border-color: var(--accent);
    }
    .form-input.alias.grow {
      flex: 1;
    }
    .form-input.key {
      margin-top: 6px;
      font-family: var(--font-mono, monospace);
      font-size: var(--font-xs);
    }
    .form-input.invalid {
      border-color: var(--red);
    }
    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      padding: 4px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
    }
    .icon-btn:hover {
      background: var(--border-subtle);
      color: var(--text);
    }
    .icon-btn.danger:hover {
      color: var(--red);
    }
    .icon-btn.accent {
      color: var(--accent);
    }
    .icon-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .icon-btn svg {
      width: 14px;
      height: 14px;
    }
    .row-error {
      padding-top: 6px;
      font-size: var(--font-xs);
      color: var(--red);
    }

    .add-row {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 12px 14px;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--accent);
      font-size: var(--font-sm);
      font-family: inherit;
    }
    .add-row:hover {
      background: var(--border-subtle);
    }
    .add-row svg {
      width: 14px;
      height: 14px;
    }

    .hint {
      padding: 10px 4px 0;
      font-size: var(--font-xs);
      color: var(--text-muted);
      line-height: 1.5;
    }

    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .dialog-box {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 20px;
      width: min(90vw, 360px);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .dialog-title {
      font-size: var(--font-md);
      font-weight: 600;
    }
    .dialog-message {
      font-size: var(--font-sm);
      color: var(--text-muted);
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .dialog-btn {
      padding: 6px 14px;
      border-radius: var(--radius-pill);
      border: none;
      cursor: pointer;
      font-size: var(--font-sm);
      font-family: inherit;
    }
    .dialog-btn.cancel {
      background: var(--border-subtle);
      color: var(--text);
    }
    .dialog-btn.danger {
      background: var(--red);
      color: #fff;
    }
    .dialog-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .toast {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-pill);
      padding: 8px 16px;
      font-size: var(--font-sm);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      z-index: 100;
    }
  `;
}
