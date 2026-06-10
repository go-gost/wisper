import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * NavTabs — pill-style tab bar with animated active indicator.
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
      gap: 4px;
      padding: 4px;
      background: var(--color-surface);
      border-radius: var(--radius-pill);
      border: 1px solid var(--color-border);
    }

    button {
      flex: 1;
      padding: 8px 16px;
      border: none;
      border-radius: var(--radius-pill);
      background: transparent;
      color: var(--color-text-secondary);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all var(--transition-fast);
      position: relative;
      white-space: nowrap;
    }

    button.active {
      background: var(--color-primary);
      color: var(--color-primary-text);
    }

    button:hover:not(.active) {
      color: var(--color-text-primary);
      background: var(--color-surface-hover);
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
