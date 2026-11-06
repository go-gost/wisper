import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { formatBytes, maskKey } from '../utils/format';
import { GoBackend } from '../api/backend';
import type { EntryPeer } from '../api/types';
import '../components/app-scaffold';

/**
 * A tun spoke's local peer view. It is deliberately not the hub's allowlist:
 * the hub row and blocked-but-gone keys are real rows here, and a block is a
 * local inbound policy that never edits the hub.
 */
@customElement('entrypoint-peers-page')
export class EntrypointPeersPage extends LitElement {
  @property() entrypointType = '';
  @property() entrypointId = '';

  @state() private _peers: EntryPeer[] = [];
  @state() private _error = '';
  @state() private _savingKey = '';
  @state() private _snackbar = '';

  private _backend = new GoBackend();
  private _poll = 0;

  connectedCallback() {
    super.connectedCallback();
    void this._load();
    // The membership and the direct-link state change without a local edit.
    // Five seconds matches the entrypoint detail page's poll, so this page
    // costs no extra cadence on a phone.
    this._poll = window.setInterval(() => void this._load(), 5000);
  }

  disconnectedCallback() {
    window.clearInterval(this._poll);
    this._poll = 0;
    super.disconnectedCallback();
  }

  private async _load() {
    try {
      const body = await this._backend.listEntrypointPeers(this.entrypointId);
      this._peers = body.peers ?? [];
      this._error = '';
    } catch (e: unknown) {
      // Keep the last view; a transient fetch failure must not blank the page.
      this._error = e instanceof Error ? e.message : '';
    }
  }

  private async _toggle(peer: EntryPeer) {
    if (peer.state === 'hub' || this._savingKey) return;
    const blocked = this._peers.filter(p => p.blocked).map(p => p.key);
    const next = peer.blocked
      ? blocked.filter(k => k !== peer.key)
      : [...blocked, peer.key];
    this._savingKey = peer.key;
    this._error = '';
    try {
      const body = await this._backend.updateEntrypointPeers(this.entrypointId, next);
      this._peers = body.peers ?? [];
      this._showSnackbar(t('saved'));
    } catch (e: unknown) {
      this._error = e instanceof Error ? e.message : '';
    } finally {
      this._savingKey = '';
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

  private _stateLabel(peer: EntryPeer): string {
    switch (peer.state) {
      case 'hub':
        return t('entrypointPeersStateHub');
      case 'blocked':
        return t('entrypointPeersStateBlocked');
      case 'disabled':
        return t('entrypointPeersStateDisabled');
      case 'direct-off':
        return t('entrypointPeersStateDirectOff');
      case 'direct':
        return t('entrypointPeersStateDirect');
      case 'connecting':
        return t('entrypointPeersStateConnecting');
      default:
        return peer.state;
    }
  }

  private _renderPeer(peer: EntryPeer) {
    const blockable = peer.state !== 'hub';
    const name = peer.name || t('peersNoAlias');
    return html`
      <div class="peer-row">
        <div class="row-line">
          <div class="peer-main">
            <div class="peer-name">${name}</div>
            <div class="peer-key">${maskKey(peer.key)}</div>
          </div>
          <span class="state ${peer.state}">
            ${peer.state === 'direct' ? icon('zap') : nothing}${this._stateLabel(peer)}
          </span>
          ${blockable
            ? html`
              <button class="block-btn ${peer.blocked ? 'on' : ''}"
                ?disabled=${this._savingKey !== ''}
                @click=${() => this._toggle(peer)}>
                ${peer.blocked ? t('entrypointPeersUnblock') : t('entrypointPeersBlock')}
              </button>`
            : nothing}
        </div>
        ${peer.ips?.length || peer.lans?.length || peer.transport || peer.rtt_ms || peer.input_bytes || peer.output_bytes
          ? html`
            <div class="meta">
              ${peer.ips?.length ? html`<span>${t('entrypointPeersIPs')} ${peer.ips.join(', ')}</span>` : nothing}
              ${peer.lans?.length ? html`<span>${t('entrypointPeersLANs')} ${peer.lans.join(', ')}</span>` : nothing}
              ${peer.transport ? html`<span>${t('entrypointPeersTransport')} ${peer.transport}</span>` : nothing}
              ${peer.rtt_ms
                ? html`<span>${t('entrypointPeersRTT', { ms: peer.rtt_ms })}</span>`
                : nothing}
              ${peer.input_bytes || peer.output_bytes
                ? html`<span>${t('entrypointPeersTraffic', {
                  in: formatBytes(peer.input_bytes ?? 0),
                  out: formatBytes(peer.output_bytes ?? 0),
                })}</span>`
                : nothing}
            </div>`
          : nothing}
        ${peer.disabled ? html`<div class="meta warn">${t('entrypointPeersDisabledHint')}</div>` : nothing}
      </div>
    `;
  }

  render() {
    return html`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${() => this._navigate(`/entrypoint/${this.entrypointType}/${this.entrypointId}`)}>
            ${icon('chevron-left')}
          </button>
          <span class="page-title">${t('entrypointPeersTitle')}</span>
        </div>

        <div class="section">
          <div class="card">
            ${this._peers.length === 0
              ? html`<div class="empty">${t('entrypointPeersEmpty')}</div>`
              : this._peers.map(peer => this._renderPeer(peer))}
          </div>
          <div class="hint">${t('entrypointPeersHint')}</div>
          <div class="hint">${t('entrypointPeersLocalHint')}</div>
          ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
        </div>

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
      padding: 12px 14px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .peer-row:last-child {
      border-bottom: none;
    }
    .row-line {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .peer-main {
      flex: 1;
      min-width: 0;
    }
    .peer-name {
      font-size: var(--font-sm);
      font-weight: 600;
    }
    .peer-key {
      margin-top: 2px;
      font-family: var(--font-mono, monospace);
      font-size: var(--font-xs);
      color: var(--text-muted);
      overflow-wrap: anywhere;
    }
    .state {
      flex: none;
      padding: 2px 8px;
      border-radius: var(--radius-pill);
      background: var(--border-subtle);
      color: var(--text-secondary);
      font-size: var(--font-xs);
    }
    .state.hub {
      color: var(--accent);
    }
    .state.blocked {
      color: var(--red);
    }
    .state.disabled {
      color: var(--text-muted);
    }
    .state.direct {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      color: var(--green-text);
      background: var(--green-bg);
    }
    .state.direct svg {
      width: 12px;
      height: 12px;
    }
    .block-btn {
      flex: none;
      padding: 4px 10px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-pill);
      background: none;
      color: var(--text);
      font: inherit;
      font-size: var(--font-xs);
      cursor: pointer;
    }
    .block-btn:hover {
      background: var(--border-subtle);
    }
    .block-btn.on {
      border-color: var(--red);
      color: var(--red);
    }
    .block-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      margin-top: 6px;
      color: var(--text-muted);
      font-size: var(--font-xs);
      font-family: var(--font-mono, monospace);
    }
    .meta.warn {
      color: var(--text-secondary);
      font-family: inherit;
    }
    .hint {
      padding: 10px 4px 0;
      font-size: var(--font-xs);
      color: var(--text-muted);
      line-height: 1.5;
    }
    .error {
      padding: 8px 4px 0;
      font-size: var(--font-xs);
      color: var(--red);
    }
    .toast {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      background: var(--text);
      color: var(--bg);
      padding: 8px 14px;
      border-radius: var(--radius-pill);
      font-size: var(--font-sm);
      z-index: 100;
    }
  `;
}
