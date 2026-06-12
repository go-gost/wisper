import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ProtocolType } from '../../api/types';
import { t } from '../../i18n/i18n';

const PROTOCOLS: { type: ProtocolType; labelKey: string }[] = [
  { type: 'http', labelKey: 'inspectorProtocolHttp' },
  { type: 'websocket', labelKey: 'inspectorProtocolWs' },
  { type: 'tls', labelKey: 'inspectorProtocolTls' },
  { type: 'dns', labelKey: 'inspectorProtocolDns' },
];

@customElement('protocol-tabs')
export class ProtocolTabs extends LitElement {
  @property() active: ProtocolType = 'http';

  static styles = css`
    :host { display: block; }
    .tabs {
      display: flex; gap: 2px;
      background: var(--bg);
      border-radius: var(--radius-md);
      padding: 3px;
    }
    .tab {
      flex: 1; text-align: center; padding: 6px 4px;
      font-size: var(--font-xs); font-weight: 500;
      color: var(--text-muted);
      border-radius: 6px; cursor: pointer; border: none; background: none;
      font-family: inherit; transition: all 0.15s;
    }
    .tab.active { background: var(--accent); color: var(--accent-fg, #fff); }
    .tab:hover:not(.active) { color: var(--text); }
  `;

  render() {
    return html`
      <div class="tabs">
        ${PROTOCOLS.map(p => html`
          <button class="tab ${this.active === p.type ? 'active' : ''}"
            @click=${() => this.dispatchEvent(new CustomEvent('protocol-change', { detail: p.type, bubbles: true, composed: true }))}>
            ${t(p.labelKey)}
          </button>
        `)}
      </div>
    `;
  }
}
