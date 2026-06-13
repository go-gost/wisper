import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * NavTabs — centered pill-style tab bar.
 *
 * @attr tabs       — Array of tab labels.
 * @attr activeIndex — Index of the currently active tab (0-based).
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
      justify-content: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }

    .pill-group {
      display: inline-flex;
      background: var(--border-subtle);
      border-radius: var(--radius-pill);
      padding: 3px;
    }

    button {
      padding: 7px 18px;
      text-align: center;
      border-radius: var(--radius-pill);
      border: none;
      background: transparent;
      color: var(--text-secondary);
      font-size: var(--font-md);
      font-weight: 500;
      cursor: pointer;
      letter-spacing: 0.3px;
      transition: background var(--transition-fast), color var(--transition-fast);
      font-family: inherit;
      white-space: nowrap;
    }

    button.active {
      background: var(--surface);
      color: var(--text);
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
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
      <div class="pill-group">
        ${this.tabs.map(
          (label, i) => html`
            <button class=${i === this.activeIndex ? 'active' : ''} @click=${() => this._handleClick(i)}>
              ${label}
            </button>
          `,
        )}
      </div>
    `;
  }
}
