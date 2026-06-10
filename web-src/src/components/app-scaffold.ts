import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

/**
 * AppScaffold — centers content within max-width 1200px.
 *
 * The app bar is only shown when content is provided in the `appBar` slot,
 * allowing the home page to render without a sticky header.
 *
 * @slot - Default slot for page content.
 * @slot appBar - Optional sticky top app bar.
 * @slot fab - Optional floating action button.
 */
@customElement('app-scaffold')
export class AppScaffold extends LitElement {
  @state() private _hasAppBar = false;

  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }

    .shell {
      max-width: var(--max-content-width, 1200px);
      margin: 0 auto;
      min-height: 100vh;
      position: relative;
      display: flex;
      flex-direction: column;
    }

    .app-bar {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      background: var(--color-appbar-bg);
      box-shadow: var(--color-appbar-shadow);
      position: sticky;
      top: 0;
      z-index: 10;
      gap: 8px;
      transition: background var(--transition-fast);
    }

    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .fab-container {
      position: absolute;
      bottom: 24px;
      right: 24px;
      z-index: 20;
    }
  `;

  private _onAppBarSlotChange(e: Event) {
    const slot = e.target as HTMLSlotElement;
    this._hasAppBar = slot.assignedNodes().length > 0;
  }

  render() {
    return html`
      <div class="shell">
        <div class="app-bar" style="${this._hasAppBar ? '' : 'display:none;'}">
          <slot name="appBar" @slotchange=${this._onAppBarSlotChange}></slot>
        </div>
        <div class="content">
          <slot></slot>
        </div>
        <div class="fab-container">
          <slot name="fab"></slot>
        </div>
      </div>
    `;
  }
}
