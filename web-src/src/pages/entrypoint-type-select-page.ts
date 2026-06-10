import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { ENTRYPOINT_TYPES } from '../api/types';
import '../components/app-scaffold';

@customElement('entrypoint-type-select-page')
export class EntrypointTypeSelectPage extends LitElement {
  static styles = css`
    .back-btn {
      background: none; border: none; cursor: pointer;
      font-size: 1.3rem; color: var(--color-text-primary); padding: 4px 8px;
      border-radius: 8px; display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--color-surface-variant); }
    .page-title { font-size: 1.15rem; font-weight: 600; }

    .list {
      display: flex; flex-direction: column; gap: 0;
      padding: 8px 16px 0;
    }

    .type-card {
      display: flex; align-items: center;
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-card);
      margin-bottom: 16px;
      padding: 16px 24px;
      cursor: pointer;
      transition: background var(--transition-fast), box-shadow var(--transition-fast), transform 0.1s;
    }
    .type-card:hover { transform: translateY(-1px); box-shadow: var(--shadow-card-hover); }
    .type-card:active { transform: translateY(0); }

    .type-card-content { flex: 1; }
    .type-card-title { font-weight: 600; font-size: 1rem; margin-bottom: 4px; }
    .type-card-desc { color: var(--color-stopped); font-size: 0.85rem; }
    .type-card-arrow { font-size: 1.2rem; color: var(--color-stopped); }
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
              <div class="type-card-content">
                <div class="type-card-title">${et.value === 'tcp' ? '🔌' : '📡'} ${t(`type${et.value.charAt(0).toUpperCase() + et.value.slice(1)}`)}</div>
                <div class="type-card-desc">${t(`type${et.value.charAt(0).toUpperCase() + et.value.slice(1)}EntryDesc`)}</div>
              </div>
              <span class="type-card-arrow">→</span>
            </div>
          `)}
        </div>
      </app-scaffold>
    `;
  }
}
