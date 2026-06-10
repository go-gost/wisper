import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { copyToClipboard } from '../utils/clipboard';
import { t } from '../i18n/i18n';

/**
 * CopyableText — displays monospace text with a copy button.
 * Shows a brief "Copied" tooltip on success.
 */
@customElement('copyable-text')
export class CopyableText extends LitElement {
  @property() value = '';
  @property({ type: Boolean }) private _copied = false;

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    code {
      flex: 1;
      padding: 8px 12px;
      background: var(--color-surface-hover);
      border-radius: var(--radius-sm);
      font-size: 13px;
      font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--color-text-primary);
    }

    button {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 14px;
      padding: 6px;
      border-radius: var(--radius-sm);
      color: var(--color-text-muted);
      position: relative;
      transition: all var(--transition-fast);
    }

    button:hover {
      background: var(--color-surface-hover);
      color: var(--color-text-primary);
    }

    .tooltip {
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      padding: 4px 10px;
      background: var(--color-text-primary);
      color: var(--color-bg);
      border-radius: var(--radius-sm);
      font-size: 11px;
      white-space: nowrap;
      margin-bottom: 4px;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--transition-fast);
    }

    .tooltip.show {
      opacity: 1;
    }
  `;

  private async _copy() {
    const ok = await copyToClipboard(this.value);
    if (ok) {
      this._copied = true;
      this.requestUpdate();
      setTimeout(() => {
        this._copied = false;
        this.requestUpdate();
      }, 2000);
    }
  }

  render() {
    return html`
      <code>${this.value}</code>
      <button @click=${this._copy}>
        <span class="tooltip ${this._copied ? 'show' : ''}">${t('copiedToClipboard')}</span>
        📋
      </button>
    `;
  }
}
