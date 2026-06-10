import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * StatsRow — single statistic line: icon | value | rate.
 * Matches prototype stats row layout.
 *
 * @attr icon - Text icon (e.g. "↕", "↑", "↓")
 * @attr value - The current value to display (e.g. "12 / 120")
 * @attr rate - Optional rate label (e.g. "5.2 R/s")
 */
@customElement('stats-row')
export class StatsRow extends LitElement {
  @property() icon = '';
  @property() value = '';
  @property() rate = '';

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: var(--stats-justify, flex-start);
      gap: 8px;
      font-size: 0.9rem;
      margin-bottom: 5px;
      color: var(--color-text-primary);
      opacity: 0.85;
    }

    .icon {
      font-size: 0.95rem;
      width: 22px;
      text-align: center;
      flex-shrink: 0;
    }

    .value {
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }

    .rate {
      color: var(--color-stopped);
      font-size: 0.85rem;
      flex-shrink: 0;
    }
  `;

  render() {
    return html`
      <span class="icon">${this.icon}</span>
      <span class="value">${this.value}</span>
      ${this.rate ? html`<span class="rate">${this.rate}</span>` : ''}
    `;
  }
}
