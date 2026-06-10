import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * StatsRow — displays a single statistic with an icon, value, and rate label.
 *
 * @attr icon - Material icon name (e.g., "swap_vert")
 * @attr value - The current value to display (e.g., "1.5 KB/s")
 * @attr label - Optional sub-label
 */
@customElement('stats-row')
export class StatsRow extends LitElement {
  @property() icon = '';
  @property() value = '';
  @property() label = '';

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }

    .icon {
      font-size: 18px;
      color: var(--color-text-muted);
      flex-shrink: 0;
      width: 20px;
      text-align: center;
    }

    .value {
      font-weight: 600;
      color: var(--color-text-primary);
    }

    .label {
      font-size: 11px;
      color: var(--color-text-muted);
    }
  `;

  render() {
    return html`
      <span class="icon">${this.icon}</span>
      <span class="value">${this.value}</span>
      ${this.label ? html`<span class="label">${this.label}</span>` : ''}
    `;
  }
}
