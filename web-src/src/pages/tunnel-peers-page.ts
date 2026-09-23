import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { getTunnels, subscribe, updatePeers } from '../store/tunnel-store';
import { copyToClipboard } from '../utils/clipboard';
import { formatBytes, formatRate, formatNumber } from '../utils/format';
import type { Tunnel } from '../api/types';
import '../components/app-scaffold';

/** One editable allowlist row. */
interface PeerRow {
  key: string;
  alias: string;
}

/**
 * validPeerKey mirrors the API's check: a base64 (raw url) 32-byte public key,
 * i.e. 43 characters of the url-safe alphabet. An entry that is not a key is a
 * route nothing ever matches, so it is refused before the save.
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

/**
 * The allowlist manager of a p2p tunnel: one row per peer (key + display
 * alias), with the peer's live traffic beside it. Saving replaces the list and
 * rebuilds the tunnel — the process-wide host routes each peer key to exactly
 * one tunnel, so an edit restarts this one.
 */
@customElement('tunnel-peers-page')
export class TunnelPeersPage extends LitElement {
  @property() tunnelType = '';
  @property() tunnelId = '';

  @state() private _tunnel: Tunnel | null = null;
  @state() private _rows: PeerRow[] = [];
  /** The saved list, to tell whether the form is dirty. */
  private _saved: PeerRow[] = [];
  @state() private _saving = false;
  @state() private _snackbar = '';
  private _unsub: (() => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    this._load();
    // The stats task refreshes the tunnel each second; re-render for the rows'
    // live columns.
    this._unsub = subscribe(() => {
      const t2 = getTunnels().find(x => x.id === this.tunnelId);
      if (t2) this._tunnel = t2;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
  }

  private _load() {
    const t2 = getTunnels().find(x => x.id === this.tunnelId) ?? null;
    this._tunnel = t2;
    const rows = (t2?.options.peers ?? []).map(p => ({ key: p.key, alias: p.alias ?? '' }));
    this._rows = rows;
    this._saved = rows.map(r => ({ ...r }));
  }

  private get _dirty(): boolean {
    if (this._rows.length !== this._saved.length) return true;
    return this._rows.some((r, i) => r.key !== this._saved[i].key || r.alias !== this._saved[i].alias);
  }

  /** _errors lists what stops the save: a bad key or a doubled one, per row. */
  private _errors(): Map<number, string> {
    const errs = new Map<number, string>();
    const seen = new Map<string, number>();
    this._rows.forEach((r, i) => {
      const key = r.key.trim();
      if (!key) {
        errs.set(i, t('peersKeyRequired'));
        return;
      }
      if (!validPeerKey(key)) {
        errs.set(i, t('peersKeyInvalid'));
        return;
      }
      const first = seen.get(key);
      if (first !== undefined) {
        errs.set(i, t('peersKeyDuplicate'));
        errs.set(first, t('peersKeyDuplicate'));
        return;
      }
      seen.set(key, i);
    });
    return errs;
  }

  private _statFor(key: string) {
    return (this._tunnel?.peer_stats ?? []).find(s => s.key === key);
  }

  private _handleSave = async () => {
    const errs = this._errors();
    if (errs.size > 0 || this._saving) return;
    this._saving = true;
    try {
      const t2 = await updatePeers(
        this.tunnelId,
        this._rows.map(r => ({ key: r.key.trim(), alias: r.alias.trim() || undefined })),
      );
      this._tunnel = t2;
      const rows = (t2.options.peers ?? []).map(p => ({ key: p.key, alias: p.alias ?? '' }));
      this._rows = rows;
      this._saved = rows.map(r => ({ ...r }));
      this._showSnackbar(t('saved'));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      this._showSnackbar(`${t('saveFailed')}${msg ? ': ' + msg : ''}`);
    }
    this._saving = false;
  };

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

  render() {
    const errs = this._errors();
    const peers = this._tunnel?.options.peers ?? [];
    const t2 = this._tunnel;

    return html`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${() => this._navigate(`/tunnel/${this.tunnelType}/${this.tunnelId}`)}>
            ${icon('chevron-left')}
          </button>
          <span class="page-title">${t('peersTitle')}</span>
          <button class="pill-btn primary appbar-action" title="${t('btnSave')}"
            ?disabled=${this._saving || !this._dirty || errs.size > 0}
            @click=${this._handleSave}>
            ${icon('check')}
          </button>
        </div>

        ${t2
          ? html`
            <div class="section">
              <div class="card">
                ${this._rows.length === 0
                  ? html`<div class="empty">${t('peersEmpty')}</div>`
                  : this._rows.map((row, i) => {
                      const err = errs.get(i);
                      const stat = this._statFor(row.key.trim());
                      return html`
                        <div class="peer-row">
                          <div class="peer-inputs">
                            <input class="form-input alias" .value=${row.alias}
                              placeholder=${t('peersAliasPlaceholder')}
                              @input=${(e: Event) => {
                                this._rows[i] = { ...row, alias: (e.target as HTMLInputElement).value };
                                this._rows = [...this._rows];
                              }}>
                            <input class="form-input key ${err ? 'invalid' : ''}" .value=${row.key}
                              placeholder=${t('peersKeyPlaceholder')}
                              @input=${(e: Event) => {
                                this._rows[i] = { ...row, key: (e.target as HTMLInputElement).value };
                                this._rows = [...this._rows];
                              }}>
                            <button class="icon-btn" title="${t('btnCopy')}"
                              @click=${() => copyToClipboard(row.key)}>
                              ${icon('copy')}
                            </button>
                            <button class="icon-btn danger" title="${t('btnDelete')}"
                              @click=${() => {
                                this._rows = this._rows.filter((_, j) => j !== i);
                              }}>
                              ${icon('trash')}
                            </button>
                          </div>
                          ${err
                            ? html`<div class="row-error">${err}</div>`
                            : stat
                              ? html`
                                <div class="peer-stats">
                                  <span>${formatNumber(stat.current_conns)} ${t('p2pColConns')}</span>
                                  <span>↓ ${formatBytes(stat.output_bytes)}
                                    <span class="rate">${formatRate(stat.output_rate_bytes)}</span></span>
                                  <span>↑ ${formatBytes(stat.input_bytes)}
                                    <span class="rate">${formatRate(stat.input_rate_bytes)}</span></span>
                                </div>`
                              : html`<div class="peer-stats muted">${t('peersNoTraffic')}</div>`}
                        </div>
                      `;
                    })}

                <button class="add-row" @click=${() => {
                  this._rows = [...this._rows, { key: '', alias: '' }];
                }}>
                  ${icon('plus')} ${t('peersAdd')}
                </button>
              </div>

              <div class="hint">${t('peersHint')}</div>
              <div class="hint">${t('peersRestartHint')}</div>
              ${peers.length === 0 ? html`<div class="hint">${t('peersNoneHint')}</div>` : nothing}
            </div>
          `
          : html`<div class="section"><div class="card"><div class="empty">${t('notFound')}</div></div></div>`}

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
    }
    .pill-btn.primary {
      background: var(--accent);
      color: var(--accent-fg);
    }
    .pill-btn svg {
      width: 14px;
      height: 14px;
    }
    .pill-btn:hover {
      opacity: 0.85;
    }
    .pill-btn:disabled {
      opacity: 0.4;
      cursor: default;
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
    .peer-inputs {
      display: grid;
      grid-template-columns: 1fr 2fr auto auto;
      gap: 8px;
      align-items: center;
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
    .form-input.key {
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
    .icon-btn svg {
      width: 14px;
      height: 14px;
    }
    .row-error {
      padding-top: 6px;
      font-size: var(--font-xs);
      color: var(--red);
    }
    .peer-stats {
      display: flex;
      gap: 16px;
      padding-top: 6px;
      font-size: var(--font-xs);
      color: var(--text-muted);
    }
    .peer-stats.muted {
      font-style: italic;
    }
    .peer-stats .rate {
      color: var(--text-muted);
      opacity: 0.8;
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
    }
  `;
}
