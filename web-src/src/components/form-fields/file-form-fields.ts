import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../i18n/i18n';

/**
 * FileFormFields — tunnel form fields specific to file tunnels.
 * Matches prototype styling: uppercase labels, 1.5px borders, 12px radius.
 */
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
      gap: 8px;
    }

    .form-group { margin-bottom: 8px; }
    .form-label {
      display: block;
      font-size: 0.8rem;
      font-weight: 500;
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

    /* ── Password wrapper ── */
    .password-wrapper {
      position: relative;
    }
    .password-wrapper .form-input { padding-right: 40px; }
    .password-toggle {
      position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
      background: none; border: none; cursor: pointer;
      font-size: 1.1rem; color: var(--color-stopped);
    }

    /* ── Switch ── */
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

    /* ── Auth fields show/hide ── */
    .auth-field {
      overflow: hidden;
      transition: max-height .3s ease, opacity .3s ease, margin .3s ease;
    }
    .auth-field.hidden {
      max-height: 0; opacity: 0; margin-bottom: 0; pointer-events: none;
    }
    .auth-field.visible {
      max-height: 100px; opacity: 1;
    }
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

  private _togglePassword(e: Event) {
    const btn = e.target as HTMLElement;
    const input = btn.parentElement!.querySelector('.form-input') as HTMLInputElement;
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🙈';
    } else {
      input.type = 'password';
      btn.textContent = '👁';
    }
  }

  render() {
    return html`
      <div class="fields">
        <div class="form-group">
          <label class="form-label">${t('fieldDirectory')}</label>
          <input class="form-input" type="text" .value=${this.directory} ?disabled=${this.disabled}
            placeholder="Select directory"
            @input=${(e: Event) => { this.directory = (e.target as HTMLInputElement).value; this._fireChange(); }}>
        </div>

        <div class="switch-row">
          <span class="switch-label">${t('switchBasicAuth')}</span>
          <div class="switch ${this.basicAuth ? 'on' : ''}" @click=${() => {
            if (!this.disabled) { this.basicAuth = !this.basicAuth; this._fireChange(); this.requestUpdate(); }
          }}>
            <div class="switch-knob"></div>
          </div>
        </div>

        <div class="auth-field ${this.basicAuth ? 'visible' : 'hidden'}">
          <div class="form-group">
            <label class="form-label">${t('fieldUsername')}</label>
            <input class="form-input" type="text" .value=${this.username} ?disabled=${this.disabled}
              placeholder="Enter username"
              @input=${(e: Event) => { this.username = (e.target as HTMLInputElement).value; this._fireChange(); }}>
          </div>
          <div class="form-group">
            <label class="form-label">${t('fieldPassword')}</label>
            <div class="password-wrapper">
              <input class="form-input" type="password" .value=${this.password} ?disabled=${this.disabled}
                placeholder="Enter password"
                @input=${(e: Event) => { this.password = (e.target as HTMLInputElement).value; this._fireChange(); }}>
              <button class="password-toggle" @click=${this._togglePassword}>👁</button>
            </div>
          </div>
        </div>

        <div class="switch-row">
          <span class="switch-label">${t('switchFileUpload')}</span>
          <div class="switch ${this.fileUpload ? 'on' : ''}" @click=${() => {
            if (!this.disabled) { this.fileUpload = !this.fileUpload; this._fireChange(); this.requestUpdate(); }
          }}>
            <div class="switch-knob"></div>
          </div>
        </div>
      </div>
    `;
  }
}
