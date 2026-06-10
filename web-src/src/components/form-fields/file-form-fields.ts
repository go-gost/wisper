import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../i18n/i18n';

@customElement('file-form-fields')
export class FileFormFields extends LitElement {
  @property() directory = '';
  @property({ type: Boolean }) basicAuth = false;
  @property() username = '';
  @property() password = '';
  @property({ type: Boolean }) fileUpload = false;
  @property({ type: Boolean }) disabled = false;

  static styles = css`
    .fields {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

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

    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .switch-label { font-size: 14px; color: var(--color-text-primary); }
    .switch {
      position: relative;
      width: 44px;
      height: 24px;
    }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute;
      inset: 0;
      background: var(--color-border);
      border-radius: 12px;
      cursor: pointer;
      transition: var(--transition-fast);
    }
    .slider::before {
      content: '';
      position: absolute;
      width: 18px;
      height: 18px;
      left: 3px;
      bottom: 3px;
      background: white;
      border-radius: 50%;
      transition: var(--transition-fast);
    }
    input:checked + .slider { background: var(--color-primary); }
    input:checked + .slider::before { transform: translateX(20px); }
    input:disabled + .slider { opacity: 0.5; cursor: not-allowed; }
  `;

  private _fireChange() {
    this.dispatchEvent(new CustomEvent('field-change', {
      detail: {
        directory: this.directory,
        basicAuth: this.basicAuth,
        username: this.username,
        password: this.password,
        fileUpload: this.fileUpload,
      },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    return html`
      <div class="fields">
        <div class="field">
          <label>${t('fieldDirectory')}</label>
          <input type="text" .value=${this.directory} ?disabled=${this.disabled}
            @input=${(e: Event) => { this.directory = (e.target as HTMLInputElement).value; this._fireChange(); }}>
        </div>
        <div class="switch-row">
          <span class="switch-label">${t('switchBasicAuth')}</span>
          <label class="switch">
            <input type="checkbox" .checked=${this.basicAuth} ?disabled=${this.disabled}
              @change=${(e: Event) => { this.basicAuth = (e.target as HTMLInputElement).checked; this._fireChange(); this.requestUpdate(); }}>
            <span class="slider"></span>
          </label>
        </div>
        ${this.basicAuth ? html`
          <div class="field">
            <label>${t('fieldUsername')}</label>
            <input type="text" .value=${this.username} ?disabled=${this.disabled}
              @input=${(e: Event) => { this.username = (e.target as HTMLInputElement).value; this._fireChange(); }}>
          </div>
          <div class="field">
            <label>${t('fieldPassword')}</label>
            <input type="password" .value=${this.password} ?disabled=${this.disabled}
              @input=${(e: Event) => { this.password = (e.target as HTMLInputElement).value; this._fireChange(); }}>
          </div>
        ` : ''}
        <div class="switch-row">
          <span class="switch-label">${t('switchFileUpload')}</span>
          <label class="switch">
            <input type="checkbox" .checked=${this.fileUpload} ?disabled=${this.disabled}
              @change=${(e: Event) => { this.fileUpload = (e.target as HTMLInputElement).checked; this._fireChange(); }}>
            <span class="slider"></span>
          </label>
        </div>
      </div>
    `;
  }
}
