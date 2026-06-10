import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('wisper-spinner')
export class WisperSpinner extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
      width: 32px;
      height: 32px;
    }

    .spinner {
      width: 100%;
      height: 100%;
      border: 3px solid var(--color-border);
      border-top-color: var(--color-primary);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;

  render() {
    return html`<div class="spinner"></div>`;
  }
}
