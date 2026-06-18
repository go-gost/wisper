import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

/**
 * AppScaffold — layout wrapper that centers content at max-width.
 *
 * Sticky appbar at top (always shown), scrollable content body, and an
 * optional floating action button anchored to the bottom-right.
 *
 * @slot appBar  - Content for the sticky top app bar (back button, title, actions).
 * @slot         - Default slot for page content.
 * @slot fab     - Optional floating action button.
 */
@customElement('app-scaffold')
export class AppScaffold extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }

    .shell {
      max-width: var(--max-content-width, 800px);
      margin: 0 auto;
      min-height: 100vh;
      position: relative;
      display: flex;
      flex-direction: column;
    }

    .appbar {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      background: var(--bg);
      position: sticky;
      top: 0;
      z-index: 10;
      gap: 8px;
    }

    .appbar ::slotted(*) {
      flex: 1;
      min-width: 0;
    }

    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .fab-slot {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 20;
    }

    @media (min-width: 848px) {
      .fab-slot {
        right: calc((100vw - var(--max-content-width, 800px)) / 2 + 24px);
      }
    }
  `;

  render() {
    return html`
      <div class="shell">
        <div class="appbar">
          <slot name="appBar"></slot>
        </div>
        <div class="content">
          <slot></slot>
        </div>
        <div class="fab-slot">
          <slot name="fab"></slot>
        </div>
      </div>
    `;
  }
}
