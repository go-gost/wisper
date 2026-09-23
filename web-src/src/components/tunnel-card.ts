import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formatBytes, formatRate, formatRelativeTime } from '../utils/format';
import { icon } from '../utils/icons';
import type { TransportView } from '../utils/transport';
import type { ServiceStatus } from '../api/types';

/**
 * TunnelCard — list row for a tunnel or entrypoint.
 *
 * Layout: status-dot · name + type + meta · traffic column · chevron
 * Renders separately inside its own Shadow DOM with design-token colours.
 *
 * @attr name      - Display name.
 * @attr typeLabel - Service type label (e.g. "HTTP").
 * @attr meta      - Secondary line text (e.g. "3 conns" or "Stopped").
 * @attr status    - running | stopped | error (drives dot colour).
 * @attr endpoint  - Copyable address shown in expanded/standalone mode.
 * @attr expanded  - Whether the inline expand panel is open.
 * @attr compact   - When true, hides the traffic column (used on home list).
 */
@customElement('tunnel-card')
export class TunnelCard extends LitElement {
  @property() name = '';
  @property() typeLabel = '';
  @property() meta = '';
  @property() status: ServiceStatus = 'stopped';
  @property() endpoint = '';

  // Stats (optional — only shown when running)
  @property({ type: Number }) currentConns = 0;
  @property({ type: Number }) totalConns = 0;
  @property({ type: Number }) requestRate = 0;
  @property({ type: Number }) inputBytes = 0;
  @property({ type: Number }) outputBytes = 0;
  @property({ type: Number }) inputRate = 0;
  @property({ type: Number }) outputRate = 0;

  /** The p2p transport chip (utils/transport.transportView), or null when the
   *  object has no p2p peers connected. Text comes pre-localized, as props do. */
  @property({ attribute: false }) transport: TransportView | null = null;

  @property() createdAt = '';
  @property({ type: Boolean }) expanded = false;
  @property({ type: Boolean }) compact = true;

  /** Error message — displayed in an inline banner when non-empty. */
  @property() error = '';

  static styles = css`
    :host {
      display: block;
    }

    .row {
      display: flex;
      align-items: flex-start;
      padding: 8px 12px;
      background: var(--border-subtle);
      border-radius: var(--radius-lg);
      cursor: pointer;
      transition: background var(--transition-fast);
      gap: 10px;
    }

    .row:hover {
      background: var(--border);
    }

    .row.stopped {
      opacity: 0.55;
    }

    /* ── Status dot ── */
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--text-muted);
      align-self: center;
    }

    .dot.running {
      background: var(--green);
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.3);
    }

    .dot.error {
      background: var(--red);
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.3);
    }

    /* ── Info column ── */
    .info {
      flex: 1;
      min-width: 0;
      align-self: stretch;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 1px;
    }

    .name {
      font-size: var(--font-md);
      font-weight: 600;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .type-label,
    .meta {
      font-size: var(--font-sm);
      color: var(--text-muted);
    }

    /* ── p2p transport: one small icon beside the created-at, the reason in
       its tooltip (a card has no room for the words) ── */
    .right-top {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .transport {
      display: inline-flex;
      align-items: center;
      color: var(--text-muted);
    }
    .transport svg {
      width: 12px;
      height: 12px;
    }
    .transport.direct {
      color: var(--green-text);
    }
    .transport.warn {
      color: var(--amber);
    }

    /* ── Right column: created-at + traffic ── */
    .right-col {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      min-width: 60px;
      align-self: center;
    }

    .created-at {
      font-size: var(--font-sm);
      color: var(--text-muted);
      text-align: right;
      line-height: 1.4;
    }

    /* ── Traffic stats ── */
    .traffic {
      text-align: right;
      font-size: var(--font-sm);
      color: var(--text);
      line-height: 1.4;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }

    .traffic-row {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 2px;
    }

    .traffic-total {
      color: var(--text-secondary);
      font-size: var(--font-sm);
    }

    /* ── Chevron ── */
    .chevron {
      flex-shrink: 0;
      color: var(--text-muted);
      transition: transform var(--transition-fast);
      display: flex;
      align-items: center;
      justify-content: center;
      align-self: stretch;
      padding: 0 8px;
      margin: -8px -12px;
      margin-left: 0;
    }

    .chevron.open {
      transform: rotate(90deg);
    }

    /* ── Error ── */
    .error-banner {
      padding: 5px 14px 5px 34px;
      background: var(--red-bg);
      border-radius: var(--radius-sm);
      margin-top: 2px;
      font-size: var(--font-sm);
      color: var(--red-text);
    }
  `;

  private _onRowClick() {
    this.dispatchEvent(new CustomEvent('card-click', { bubbles: true, composed: true }));
  }

  private _onChevronClick(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('chevron-click', { bubbles: true, composed: true }));
  }

  render() {
    const stopped = this.status === 'stopped';

    return html`
      <div class="row ${stopped ? 'stopped' : ''}" @click=${this._onRowClick}>
        <span class="dot ${this.status}"></span>

        <div class="info">
          <div class="name">${this.name}</div>
          ${this.typeLabel ? html`<div class="type-label">${this.typeLabel}</div>` : ''}
          ${this.meta ? html`<div class="meta">${this.meta}</div>` : ''}
        </div>

        <div class="right-col">
          <div class="right-top">
            ${this.transport
              ? html`<span class="transport ${this.transport.tone}" title=${this.transport.hint}>
                  ${icon(this.transport.icon)}
                </span>`
              : nothing}
            ${this.createdAt ? html`<span class="created-at">${formatRelativeTime(this.createdAt)}</span>` : ''}
          </div>
          ${this.status === 'running' ? html`
            <div class="traffic">
              <div class="traffic-row">
                <span class="traffic-total">${formatBytes(this.inputBytes)}</span>
                <span>↑ ${formatRate(this.inputRate)}</span>
              </div>
              <div class="traffic-row">
                <span class="traffic-total">${formatBytes(this.outputBytes)}</span>
                <span>↓ ${formatRate(this.outputRate)}</span>
              </div>
            </div>
          ` : ''}
        </div>

        <span class="chevron ${this.expanded ? 'open' : ''}" @click=${this._onChevronClick}>
          ${icon('chevron-right')}
        </span>
      </div>

      ${this.error ? html`<div class="error-banner">${this.error}</div>` : ''}
    `;
  }
}
