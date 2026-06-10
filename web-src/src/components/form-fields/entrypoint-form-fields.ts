import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../i18n/i18n';

@customElement('entrypoint-form-fields')
export class EntrypointFormFields extends LitElement {
  @property({ type: Boolean }) keepalive = false;
  @property({ type: Number }) ttl = 0;
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
    .hint { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }
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
          <span class="switch-label">${t('switchKeepalive')}</span>
          <label class="switch">
            <input type="checkbox" .checked=${this.keepalive} ?disabled=${this.disabled}
              @change=${(e: Event) => { this.keepalive = (e.target as HTMLInputElement).checked; }}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="field">
          <label>${t('fieldTTL')}</label>
          <input type="text" .value=${this.ttl > 0 ? `${this.ttl}s` : ''} ?disabled=${this.disabled}
            placeholder=${t('fieldTTLHint')}
            @input=${(e: Event) => {
              const raw = (e.target as HTMLInputElement).value;
              this.ttl = parseInt(raw) || 0;
            }}>
          <span class="hint">${t('fieldTTLHint')}</span>
        </div>
      </div>
    `;
  }
}
