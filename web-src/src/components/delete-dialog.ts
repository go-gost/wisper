import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../i18n/i18n';

/**
 * DeleteConfirmDialog — a modal confirmation dialog.
 * Emits 'confirm' on delete, 'cancel' on dismiss.
 */
@customElement('delete-dialog')
export class DeleteDialog extends LitElement {
  @property({ type: Boolean }) open = false;

  static styles = css`
    .overlay {
      display: none;
      position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      z-index: 200; align-items: center; justify-content: center;
    }
    .overlay.open { display: flex; }

    .dialog {
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      padding: 24px;
      max-width: 360px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    .title { font-size: 16px; font-weight: 600; margin-bottom: 8px; color: var(--color-text-primary); }
    .message { font-size: 14px; color: var(--color-text-secondary); margin-bottom: 24px; }
    .actions { display: flex; gap: 8px; justify-content: flex-end; }
    button {
      padding: 8px 20px; border-radius: var(--radius-pill); border: 1px solid var(--color-border);
      font-size: 14px; font-weight: 500; cursor: pointer;
      background: var(--color-surface); color: var(--color-text-primary);
      transition: all var(--transition-fast);
    }
    button:hover { background: var(--color-surface-hover); }
    button.danger { background: var(--color-error); color: white; border-color: var(--color-error); }
    button.danger:hover { opacity: 0.9; }
  `;

  close() {
    this.open = false;
    this.dispatchEvent(new CustomEvent('cancel'));
  }

  confirm() {
    this.open = false;
    this.dispatchEvent(new CustomEvent('confirm'));
  }

  render() {
    return html`
      <div class="overlay ${this.open ? 'open' : ''}" @click=${(e: Event) => { if (e.target === e.currentTarget) this.close(); }}>
        <div class="dialog">
          <div class="title">${t('deleteConfirmTitle')}</div>
          <div class="message">${t('deleteConfirmMessage')}</div>
          <div class="actions">
            <button @click=${this.close}>${t('btnCancel')}</button>
            <button class="danger" @click=${this.confirm}>${t('btnDelete')}</button>
          </div>
        </div>
      </div>
    `;
  }
}
