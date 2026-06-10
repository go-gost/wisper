import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

/**
 * AppScaffold — centers content within a max-width of 800px.
 * This is the standard page layout for all pages in the app.
 *
 * @slot - Default slot for page content.
 * @slot appBar - Optional top app bar content.
 * @slot fab - Optional floating action button.
 */
@customElement('app-scaffold')
export class AppScaffold extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }

    .container {
      max-width: var(--max-content-width, 800px);
      margin: 0 auto;
      padding: 0 16px 24px;
    }

    .app-bar {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--color-bg);
      border-bottom: 1px solid var(--color-divider);
      padding: 12px 0;
    }

    .app-bar-inner {
      max-width: var(--max-content-width, 800px);
      margin: 0 auto;
      padding: 0 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .fab-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 20;
    }

    @media (min-width: 832px) {
      .fab-container {
        right: calc(50% - 400px + 24px);
      }
    }
  `;

  render() {
    return html`
      <div class="app-bar">
        <div class="app-bar-inner">
          <slot name="appBar"></slot>
        </div>
      </div>
      <div class="container">
        <slot></slot>
      </div>
      <div class="fab-container">
        <slot name="fab"></slot>
      </div>
    `;
  }
}
