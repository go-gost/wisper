import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { TUNNEL_TYPES } from '../api/types';
import type { TunnelType } from '../api/types';
import '../components/app-scaffold';

const TYPE_ICONS: Record<TunnelType, string> = {
  file: 'folder',
  http: 'globe',
  tcp: 'link',
  udp: 'broadcast',
};

const TYPE_COLORS: Record<TunnelType, { bg: string; fg: string }> = {
  file: { bg: '#ecfdf5', fg: '#059669' },
  http: { bg: '#eff6ff', fg: '#3b82f6' },
  tcp: { bg: '#fef2f2', fg: '#dc2626' },
  udp: { bg: '#fefce8', fg: '#d97706' },
};

@customElement('tunnel-type-select-page')
export class TunnelTypeSelectPage extends LitElement {
  static styles = css`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }

    .page-title { font-size: 13px; font-weight: 600; }

    /* ── Type cards ── */
    .list {
      padding: 8px 16px 0;
      display: flex; flex-direction: column;
    }

    .type-card {
      display: flex; align-items: center;
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      margin-bottom: 12px;
      padding: 16px;
      cursor: pointer;
      transition: background var(--transition-fast), box-shadow var(--transition-fast);
      gap: 12px;
    }
    .type-card:hover {
      background: var(--border-subtle);
      box-shadow: var(--shadow-card-hover);
    }
    .type-card:active { transform: scale(0.99); }

    .type-icon {
      width: 36px; height: 36px;
      border-radius: var(--radius-md);
      background: var(--border-subtle);
      display: flex; align-items: center; justify-content: center;
      color: var(--text-secondary); flex-shrink: 0;
    }

    .type-content { flex: 1; min-width: 0; }
    .type-title { font-size: 13px; font-weight: 600; color: var(--text); }
    .type-desc { font-size: 10px; color: var(--text-muted); margin-top: 2px; }

    .type-arrow {
      color: var(--text-muted); flex-shrink: 0;
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
          <button class="back-btn" @click=${() => this._navigate('/')}>
            ${icon('chevron-left')}
          </button>
          <span class="page-title">${t('tunnelNewTitle')}</span>
        </div>

        <div class="list">
          ${TUNNEL_TYPES.map(tt => html`
            <div class="type-card" @click=${() => this._navigate(`/tunnel/${tt.value}/new`)}>
              <div class="type-icon" style="background:${TYPE_COLORS[tt.value].bg};color:${TYPE_COLORS[tt.value].fg}">${icon(TYPE_ICONS[tt.value])}</div>
              <div class="type-content">
                <div class="type-title">
                  ${t(`type${tt.value.charAt(0).toUpperCase() + tt.value.slice(1)}`)} Tunnel
                </div>
                <div class="type-desc">
                  ${t(`type${tt.value.charAt(0).toUpperCase() + tt.value.slice(1)}Desc`)}
                </div>
              </div>
              <span class="type-arrow">${icon('chevron-right')}</span>
            </div>
          `)}
        </div>
      </app-scaffold>
    `;
  }
}
