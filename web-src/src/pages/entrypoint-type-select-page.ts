import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { ENTRYPOINT_TYPES } from '../api/types';
import '../components/app-scaffold';

@customElement('entrypoint-type-select-page')
export class EntrypointTypeSelectPage extends LitElement {
  static styles = css`
    .page-title {
      font-size: 18px;
      font-weight: 600;
    }

    .back-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 18px;
      padding: 4px;
      color: var(--color-text-secondary);
      border-radius: 50%;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .back-btn:hover {
      background: var(--color-surface-hover);
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 16px;
    }

    .type-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all var(--transition-fast);
      box-shadow: var(--shadow-card);
    }

    .type-card:hover {
      box-shadow: var(--shadow-card-hover);
    }

    .type-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .type-icon {
      width: 40px;
      height: 40px;
      border-radius: var(--radius-md);
      background: var(--color-surface-hover);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }

    .type-label {
      font-weight: 600;
      font-size: 15px;
      color: var(--color-text-primary);
    }

    .type-desc {
      font-size: 13px;
      color: var(--color-text-muted);
      margin-top: 2px;
    }

    .chevron {
      color: var(--color-text-muted);
      font-size: 18px;
    }
  `;

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  render() {
    return html`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${() => this._navigate('/')}>←</button>
          <span class="page-title">${t('entrypointNewTitle')}</span>
        </div>

        <div class="list">
          ${ENTRYPOINT_TYPES.map(et => html`
            <div class="type-card" @click=${() => this._navigate(`/entrypoint/${et.value}/new`)}>
              <div class="type-info">
                <div class="type-icon">${et.value === 'tcp' ? '🔌' : '📡'}</div>
                <div>
                  <div class="type-label">${t(`type${et.value.charAt(0).toUpperCase() + et.value.slice(1)}`)}</div>
                  <div class="type-desc">${t(`type${et.value.charAt(0).toUpperCase() + et.value.slice(1)}EntryDesc`)}</div>
                </div>
              </div>
              <span class="chevron">›</span>
            </div>
          `)}
        </div>
      </app-scaffold>
    `;
  }
}
