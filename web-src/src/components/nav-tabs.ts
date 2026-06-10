import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * NavTabs — pill-style tab bar matching prototype design.
 * Active tab gets a background color change only (no text color change).
 *
 * @fires tab-change — CustomEvent<{index: number}> when a tab is selected.
 */
@customElement('nav-tabs')
export class NavTabs extends LitElement {
  @property({ type: Array }) tabs: string[] = [];
  @property({ type: Number }) activeIndex = 0;

  static styles = css`
    :host {
      display: flex;
      background: var(--color-nav-bg);
      border-radius: 24px;
      padding: 4px;
      transition: background var(--transition-fast);
    }

    button {
      flex: 1;
      padding: 10px 0;
      text-align: center;
      border-radius: 20px;
      border: none;
      background: transparent;
      color: var(--color-text-primary);
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: background var(--transition-fast);
      font-family: inherit;
    }

    button.active {
      background: var(--color-nav-active-bg);
      font-weight: 600;
    }
  `;

  private _handleClick(index: number) {
    if (index === this.activeIndex) return;
    this.activeIndex = index;
    this.dispatchEvent(
      new CustomEvent('tab-change', { detail: { index }, bubbles: true, composed: true }),
    );
  }

  render() {
    return html`
      ${this.tabs.map(
        (label, i) => html`
          <button class=${i === this.activeIndex ? 'active' : ''} @click=${() => this._handleClick(i)}>
            ${label}
          </button>
        `,
      )}
    `;
  }
}
