import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formatBytes, formatRate } from '../utils/format';
import { icon } from '../utils/icons';
import type { ServiceStatus } from '../api/types';

/**
 * TunnelCard — list row for a tunnel or entrypoint.
 *
 * Layout: status-dot · name + meta · traffic column · chevron
 * Renders separately inside its own Shadow DOM with design-token colours.
 *
 * @attr name     - Display name.
 * @attr meta     - Secondary line text (e.g. "HTTP · Running").
 * @attr status   - running | stopped | error (drives dot colour).
 * @attr endpoint - Copyable address shown in expanded/standalone mode.
 * @attr expanded - Whether the inline expand panel is open.
 * @attr compact  - When true, hides the traffic column (used on home list).
 */
@customElement('tunnel-card')
export class TunnelCard extends LitElement {
  @property() name = '';
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
      align-items: center;
      padding: 8px 12px;
      background: var(--border-subtle);
      border-radius: var(--radius-sm);
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
    }

    .name {
      font-size: var(--font-md);
      font-weight: 600;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      font-size: var(--font-sm);
      color: var(--text-muted);
      margin-top: 1px;
    }

    /* ── Traffic column ── */
    .traffic {
      flex-shrink: 0;
      text-align: right;
      font-size: var(--font-sm);
      color: var(--text);
      line-height: 1.4;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      min-width: 60px;
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
          <div class="meta">${this.meta}</div>
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

        <span class="chevron ${this.expanded ? 'open' : ''}" @click=${this._onChevronClick}>
          ${icon('chevron-right')}
        </span>
      </div>

      ${this.error ? html`<div class="error-banner">${this.error}</div>` : ''}
    `;
  }
}
