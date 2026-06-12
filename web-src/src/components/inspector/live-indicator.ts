import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../i18n/i18n';

@customElement('live-indicator')
export class LiveIndicator extends LitElement {
  @property({ type: Boolean }) connected = false;
  @property({ type: Number }) recordCount = 0;
  @property({ type: Boolean }) stopped = false;

  static styles = css`
    :host { display: block; }
    .bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px; background: var(--border-subtle);
      border-radius: var(--radius-sm); font-size: var(--font-xs); gap: 8px;
    }
    .status { display: flex; align-items: center; gap: 6px; }
    .dot {
      width: 8px; height: 8px; border-radius: 50%; display: inline-block;
    }
    .dot.connected { background: var(--green); animation: pulse 1.5s ease-in-out infinite; }
    .dot.disconnected { background: var(--red); }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .actions { display: flex; gap: 6px; }
    .actions button {
      font-size: var(--font-xs); padding: 2px 10px; cursor: pointer;
      background: none; border: 1px solid var(--border);
      border-radius: var(--radius-pill); color: var(--text-muted);
      font-family: inherit;
    }
    .actions button:hover { color: var(--text); border-color: var(--text-muted); }
  `;

  render() {
    return html`
      <div class="bar">
        <span class="status">
          <span class="dot ${this.connected ? 'connected' : 'disconnected'}"></span>
          ${this.connected ? t('inspectorStatusConnected') : t('inspectorStatusDisconnected')}
        </span>
        <span style="color:var(--text-muted)">${t('inspectorRecordsCount', { count: String(this.recordCount) })}</span>
        <span class="actions">
          ${this.stopped
            ? html`<button @click=${() => this.dispatchEvent(new CustomEvent('live-reconnect', { bubbles: true, composed: true }))}>${t('inspectorBtnReconnect')}</button>`
            : html`<button @click=${() => this.dispatchEvent(new CustomEvent('live-stop', { bubbles: true, composed: true }))}>${t('inspectorBtnStop')}</button>`}
          <button @click=${() => this.dispatchEvent(new CustomEvent('live-clear', { bubbles: true, composed: true }))}>${t('inspectorBtnClear')}</button>
        </span>
      </div>
    `;
  }
}
