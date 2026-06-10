import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../i18n/i18n';

/**
 * HttpFormFields — tunnel form fields specific to HTTP tunnels.
 * Matches prototype styling.
 */
@customElement('http-form-fields')
export class HttpFormFields extends LitElement {
  @property() hostname = '';
  @property({ type: Boolean }) rewriteHost = false;
  @property({ type: Boolean }) enableTLS = false;
  @property({ type: Boolean }) disabled = false;

  static styles = css`
    .fields { display: flex; flex-direction: column; gap: 8px; }

    .form-group { margin-bottom: 8px; }
    .form-label {
      display: block;
      font-size: 0.8rem; font-weight: 500;
      color: var(--color-stopped);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%;
      padding: 12px 14px;
      border: 1.5px solid var(--color-input-border);
      border-radius: var(--radius-md);
      background: var(--color-input-bg);
      color: var(--color-text-primary);
      font-size: 0.95rem;
      font-family: inherit;
      outline: none;
      transition: border-color var(--transition-fast), background var(--transition-fast);
      box-sizing: border-box;
    }
    .form-input:focus { border-color: var(--color-primary); }
    .form-input:disabled { opacity: 0.6; }

    .switch-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 0;
    }
    .switch-label { font-size: 0.95rem; }
    .switch {
      width: 44px; height: 24px; border-radius: 12px;
      background: var(--color-stopped); position: relative;
      cursor: pointer; transition: background var(--transition-fast);
      flex-shrink: 0;
    }
    .switch.on { background: var(--color-primary); }
    .switch-knob {
      width: 20px; height: 20px; border-radius: 50%;
      background: white; position: absolute;
      top: 2px; left: 2px;
      transition: left var(--transition-fast);
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .switch.on .switch-knob { left: 22px; }
  `;

  render() {
    return html`
      <div class="fields">
        <div class="switch-row">
          <span class="switch-label">${t('switchRewriteHost')}</span>
          <div class="switch ${this.rewriteHost ? 'on' : ''}" @click=${() => {
            if (!this.disabled) { this.rewriteHost = !this.rewriteHost; this.requestUpdate(); }
          }}>
            <div class="switch-knob"></div>
          </div>
        </div>

        ${this.rewriteHost ? html`
          <div class="form-group">
            <label class="form-label">${t('fieldHostname')}</label>
            <input class="form-input" type="text" .value=${this.hostname} ?disabled=${this.disabled}
              @input=${(e: Event) => { this.hostname = (e.target as HTMLInputElement).value; }}>
          </div>
        ` : ''}

        <div class="switch-row">
          <span class="switch-label">${t('switchEnableTLS')}</span>
          <div class="switch ${this.enableTLS ? 'on' : ''}" @click=${() => {
            if (!this.disabled) { this.enableTLS = !this.enableTLS; }
          }}>
            <div class="switch-knob"></div>
          </div>
        </div>
      </div>
    `;
  }
}
