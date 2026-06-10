import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { getTunnels, isLoading as tunnelsLoading, refresh as refreshTunnels, toggleFavorite } from '../store/tunnel-store';
import { getEntrypoints, isLoading as entrypointsLoading, refresh as refreshEntrypoints, toggleFavorite as toggleEntrypointFavorite } from '../store/entrypoint-store';
import { subscribe as subTunnel } from '../store/tunnel-store';
import { subscribe as subEntrypoint } from '../store/entrypoint-store';
import { subscribe as subSettings } from '../store/settings-store';
import '../components/app-scaffold';
import '../components/nav-tabs';
import '../components/tunnel-card';
import '../components/stats-row';

@customElement('home-page')
export class HomePage extends LitElement {
  @state() private tabIndex = 0;
  @state() private showFavorites = false;
  @state() private _tunnels = getTunnels();
  @state() private _entrypoints = getEntrypoints();
  @state() private _tunnelsLoading = tunnelsLoading();
  @state() private _entrypointsLoading = entrypointsLoading();

  private _unsubs: (() => void)[] = [];

  connectedCallback() {
    super.connectedCallback();
    this._unsubs.push(
      subTunnel(() => {
        this._tunnels = getTunnels();
        this._tunnelsLoading = tunnelsLoading();
        this.requestUpdate();
      }),
      subEntrypoint(() => {
        this._entrypoints = getEntrypoints();
        this._entrypointsLoading = entrypointsLoading();
        this.requestUpdate();
      }),
      subSettings(() => this.requestUpdate()),
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
  }

  static styles = css`
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 18px;
      color: var(--color-primary);
    }

    .brand-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: var(--color-primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 16px;
    }

    .header-actions {
      display: flex;
      gap: 8px;
    }

    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 20px;
      padding: 6px;
      border-radius: 50%;
      color: var(--color-text-secondary);
      transition: all var(--transition-fast);
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .icon-btn:hover {
      background: var(--color-surface-hover);
      color: var(--color-text-primary);
    }

    .icon-btn.active {
      color: var(--color-primary);
    }

    .nav-wrapper {
      margin-bottom: 16px;
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 16px;
      color: var(--color-text-muted);
      text-align: center;
    }

    .empty-icon {
      font-size: 48px;
      margin-bottom: 12px;
      opacity: 0.4;
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: 24px;
    }

    .fab {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      background: var(--color-primary);
      color: var(--color-primary-text);
      font-size: 28px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      transition: all var(--transition-fast);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .fab:hover {
      background: var(--color-primary-hover);
      transform: scale(1.05);
    }
  `;

  private _handleTabChange(e: CustomEvent) {
    this.tabIndex = e.detail.index;
    this.showFavorites = false;
  }

  private _toggleFavorites() {
    this.showFavorites = !this.showFavorites;
  }

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  private get _filteredTunnels() {
    return this.showFavorites
      ? this._tunnels.filter(t => t.favorite)
      : this._tunnels;
  }

  private get _filteredEntrypoints() {
    return this.showFavorites
      ? this._entrypoints.filter(e => e.favorite)
      : this._entrypoints;
  }

  private get _list() {
    return this.tabIndex === 0 ? this._filteredTunnels : this._filteredEntrypoints;
  }

  private get _isLoading() {
    return this.tabIndex === 0 ? this._tunnelsLoading : this._entrypointsLoading;
  }

  private _handleToggleFavorite(e: Event, id: string) {
    e.stopPropagation();
    if (this.tabIndex === 0) {
      toggleFavorite(id);
    } else {
      toggleEntrypointFavorite(id);
    }
  }

  render() {
    const items = this._list;
    const emptyLabel = this.tabIndex === 0 ? t('homeEmptyTunnels') : t('homeEmptyEntrypoints');
    const fabPath = this.tabIndex === 0 ? '/tunnel/new' : '/entrypoint/new';

    return html`
      <app-scaffold>
        <div slot="appBar" class="header">
          <div class="brand">
            <div class="brand-icon">W</div>
            ${t('appName')}
          </div>
          <div class="header-actions">
            <button
              class="icon-btn ${this.showFavorites ? 'active' : ''}"
              title=${this.showFavorites ? t('homeAllTooltip') : t('homeFavoritesTooltip')}
              @click=${this._toggleFavorites}
            >${this.showFavorites ? '★' : '☆'}</button>
            <button class="icon-btn" title=${t('settingsTitle')} @click=${() => this._navigate('/settings')}>⚙</button>
          </div>
        </div>

        <div class="nav-wrapper">
          <nav-tabs
            .tabs=${[t('homeTabTunnel'), t('homeTabEntrypoint')]}
            .activeIndex=${this.tabIndex}
            @tab-change=${this._handleTabChange}
          ></nav-tabs>
        </div>

        ${this._isLoading
          ? html`<div class="loading"><wisper-spinner></wisper-spinner></div>`
          : items.length === 0
            ? html`
              <div class="empty">
                <span class="empty-icon">☁️</span>
                <span>${emptyLabel}</span>
              </div>
            `
            : html`
              <div class="list">
                ${items.map(item => html`
                  <div @click=${() => {
                    const prefix = this.tabIndex === 0 ? '/tunnel' : '/entrypoint';
                    this._navigate(`${prefix}/${item.type}/${item.id}`);
                  }}>
                    <tunnel-card
                      .name=${item.name}
                      .type=${item.type.toUpperCase()}
                      .endpoint=${item.endpoint}
                      .status=${item.status}
                      .stats=${item.stats}
                      .error=${item.error}
                    ></tunnel-card>
                  </div>
                `)}
              </div>
            `}

        <div slot="fab">
          <button class="fab" title="+" @click=${() => this._navigate(fabPath)}>+</button>
        </div>
      </app-scaffold>
    `;
  }
}
