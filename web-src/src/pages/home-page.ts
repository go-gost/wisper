import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { getTunnels, isLoading as tunnelsLoading, toggleFavorite } from '../store/tunnel-store';
import { getEntrypoints, isLoading as entrypointsLoading, toggleFavorite as toggleEntrypointFavorite } from '../store/entrypoint-store';
import { subscribe as subTunnel } from '../store/tunnel-store';
import { subscribe as subEntrypoint } from '../store/entrypoint-store';
import { subscribe as subSettings } from '../store/settings-store';
import '../components/app-scaffold';
import '../components/nav-tabs';
import '../components/tunnel-card';

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
    /* ── Home Header ── */
    .home-header {
      display: flex;
      align-items: center;
      padding: 16px;
      gap: 12px;
    }

    .app-icon {
      width: 42px;
      height: 42px;
      background: var(--color-primary);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: 1.1rem;
    }

    .header-actions {
      margin-left: auto;
      display: flex;
      gap: 4px;
    }

    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 6px 10px;
      border-radius: 8px;
      color: var(--color-text-primary);
      font-size: 1.1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background var(--transition-fast);
      width: 36px;
      height: 36px;
    }

    .icon-btn:hover {
      background: var(--color-surface-variant);
    }

    .icon-btn.active {
      color: var(--color-fav);
    }

    /* ── Nav wrapper ── */
    .nav-wrapper {
      margin: 0 16px 12px;
    }

    /* ── List ── */
    .list {
      display: flex;
      flex-direction: column;
      gap: 0;
      padding-bottom: 80px;
    }

    /* ── Empty state ── */
    .empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: var(--color-stopped);
    }

    .empty-icon {
      font-size: 3rem;
      margin-bottom: 12px;
      opacity: 0.4;
    }

    .empty-text {
      font-size: 1rem;
    }

    /* ── Loading ── */
    .loading {
      display: flex;
      justify-content: center;
      padding: 24px;
    }

    /* ── FAB (rounded square, like prototype) ── */
    .fab {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      border: none;
      background: var(--color-primary);
      color: var(--color-primary-text);
      font-size: 1.5rem;
      cursor: pointer;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.1s, background var(--transition-fast);
    }

    .fab:hover {
      transform: scale(1.05);
    }

    .fab:active {
      transform: scale(0.97);
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

  render() {
    const items = this._list;
    const emptyLabel = this.tabIndex === 0 ? t('homeEmptyTunnels') : t('homeEmptyEntrypoints');
    const fabPath = this.tabIndex === 0 ? '/tunnel/new' : '/entrypoint/new';

    return html`
      <app-scaffold>
        <!-- Home Header (NOT in appBar slot — renders as page content) -->
        <div class="home-header">
          <div class="app-icon">W</div>
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
                <span class="empty-text">${emptyLabel}</span>
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
          <button class="fab" @click=${() => this._navigate(fabPath)}>+</button>
        </div>
      </app-scaffold>
    `;
  }
}
