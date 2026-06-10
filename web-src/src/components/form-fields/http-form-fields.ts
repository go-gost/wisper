import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../i18n/i18n';

@customElement('http-form-fields')
export class HttpFormFields extends LitElement {
  @property() hostname = '';
  @property({ type: Boolean }) rewriteHost = false;
  @property({ type: Boolean }) enableTLS = false;
  @property({ type: Boolean }) disabled = false;

  static styles = css`
    .fields { display: flex; flex-direction: column; gap: 16px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    label { font-size: 13px; font-weight: 500; color: var(--color-text-secondary); }
    input {
      padding: 10px 12px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text-primary);
      font-size: 14px;
      font-family: inherit;
      transition: border-color var(--transition-fast);
    }
    input:focus { border-color: var(--color-primary); outline: none; }
    input:disabled { opacity: 0.6; }
    .switch-row { display: flex; align-items: center; justify-content: space-between; }
    .switch-label { font-size: 14px; color: var(--color-text-primary); }
    .switch { position: relative; width: 44px; height: 24px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; inset: 0; background: var(--color-border);
      border-radius: 12px; cursor: pointer; transition: var(--transition-fast);
    }
    .slider::before {
      content: ''; position: absolute; width: 18px; height: 18px;
      left: 3px; bottom: 3px; background: white; border-radius: 50%;
      transition: var(--transition-fast);
    }
    input:checked + .slider { background: var(--color-primary); }
    input:checked + .slider::before { transform: translateX(20px); }
    input:disabled + .slider { opacity: 0.5; cursor: not-allowed; }
  `;

  render() {
    return html`
      <div class="fields">
        <div class="switch-row">
          <span class="switch-label">${t('switchRewriteHost')}</span>
          <label class="switch">
            <input type="checkbox" .checked=${this.rewriteHost} ?disabled=${this.disabled}
              @change=${(e: Event) => { this.rewriteHost = (e.target as HTMLInputElement).checked; this.requestUpdate(); }}>
            <span class="slider"></span>
          </label>
        </div>
        ${this.rewriteHost ? html`
          <div class="field">
            <label>${t('fieldHostname')}</label>
            <input type="text" .value=${this.hostname} ?disabled=${this.disabled}
              @input=${(e: Event) => { this.hostname = (e.target as HTMLInputElement).value; }}>
          </div>
        ` : ''}
        <div class="switch-row">
          <span class="switch-label">${t('switchEnableTLS')}</span>
          <label class="switch">
            <input type="checkbox" .checked=${this.enableTLS} ?disabled=${this.disabled}
              @change=${(e: Event) => { this.enableTLS = (e.target as HTMLInputElement).checked; }}>
            <span class="slider"></span>
          </label>
        </div>
      </div>
    `;
  }
}
