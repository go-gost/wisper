import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { copyToClipboard } from '../utils/clipboard';
import { formatRate, formatNumber } from '../utils/format';
import {
  getTunnels,
  isLoading as tunnelsLoading,
  toggleFavorite,
  start as startTunnel,
  stop as stopTunnel,
  subscribe as subTunnel,
} from '../store/tunnel-store';
import {
  getEntrypoints,
  isLoading as entrypointsLoading,
  toggleFavorite as toggleEntrypointFavorite,
  start as startEntrypoint,
  stop as stopEntrypoint,
  subscribe as subEntrypoint,
} from '../store/entrypoint-store';
import { subscribe as subSettings } from '../store/settings-store';
import type { Tunnel, Entrypoint, ServiceStatus } from '../api/types';
import '../components/app-scaffold';
import '../components/nav-tabs';
import '../components/tunnel-card';

type Item =
  | { kind: 'tunnel'; data: Tunnel }
  | { kind: 'entrypoint'; data: Entrypoint };

@customElement('home-page')
export class HomePage extends LitElement {
  @state() private tabIndex = 0; // 0 = tunnels, 1 = entrypoints
  @state() private showFavorites = false;
  @state() private _tunnels: Tunnel[] = [];
  @state() private _entrypoints: Entrypoint[] = [];
  @state() private _tunnelsLoading = false;
  @state() private _entrypointsLoading = false;

  /** ID of the row whose inline panel is currently expanded (null = none). */
  @state() private _expandedId: string | null = null;

  private _unsubs: (() => void)[] = [];

  connectedCallback() {
    super.connectedCallback();
    this._tunnels = getTunnels();
    this._entrypoints = getEntrypoints();
    this._tunnelsLoading = tunnelsLoading();
    this._entrypointsLoading = entrypointsLoading();

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
    for (const fn of this._unsubs) fn();
    this._unsubs = [];
  }

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  private _toggleFavorites() {
    this.showFavorites = !this.showFavorites;
    this._expandedId = null;
  }

  private _toggleExpand(id: string) {
    this._expandedId = this._expandedId === id ? null : id;
  }

  // ── Filters ───────────────────────────────────────────────────────────

  private get _filteredTunnels(): Tunnel[] {
    return this.showFavorites
      ? this._tunnels.filter(t => t.favorite)
      : this._tunnels;
  }

  private get _filteredEntrypoints(): Entrypoint[] {
    return this.showFavorites
      ? this._entrypoints.filter(e => e.favorite)
      : this._entrypoints;
  }

  private get _items(): Item[] {
    if (this.tabIndex === 0) {
      return this._filteredTunnels.map(t => ({ kind: 'tunnel' as const, data: t }));
    }
    return this._filteredEntrypoints.map(e => ({ kind: 'entrypoint' as const, data: e }));
  }

  private _isLoading(): boolean {
    return this.tabIndex === 0 ? this._tunnelsLoading : this._entrypointsLoading;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private _statusLabel(s: ServiceStatus): string {
    switch (s) {
      case 'running': return t('statusRunning');
      case 'stopped': return t('statusStopped');
      case 'error': return t('statusError');
    }
  }

  private _metaLine(item: Item): string {
    const type = item.data.type.toUpperCase();
    const status = this._statusLabel(item.data.status);
    if (item.data.status === 'running') {
      return `${type} · ${formatNumber(item.data.stats.current_conns)} conns`;
    }
    return `${type} · ${status}`;
  }

  // ── Empty state ───────────────────────────────────────────────────────

  private _renderEmptyState() {
    const isTunnel = this.tabIndex === 0;
    const allEmpty = isTunnel
      ? this._tunnels.length === 0
      : this._entrypoints.length === 0;

    if (this.showFavorites) {
      return html`
        <div class="empty">
          <div class="empty-icon-wrap">${icon('star')}</div>
          <div class="empty-title">${t('homeNoFavorites')}</div>
          <div class="empty-desc">${isTunnel ? t('homeNoFavTunnelHint') : t('homeNoFavEntryHint')}</div>
          <button class="empty-sub-link" @click=${this._toggleFavorites}>
            ${isTunnel ? t('homeShowAllTunnels') : t('homeShowAllEntrypoints')}
          </button>
        </div>
      `;
    }

    if (allEmpty) {
      const fabPath = isTunnel ? '/tunnel/new' : '/entrypoint/new';
      return html`
        <div class="empty">
          <div class="empty-icon-wrap">${icon(isTunnel ? 'link' : 'broadcast')}</div>
          <div class="empty-title">${isTunnel ? t('homeEmptyTunnels') : t('homeEmptyEntrypoints')}</div>
          <div class="empty-desc">${isTunnel ? t('homeEmptyTunnelDesc') : t('homeEmptyEntryDesc')}</div>
          <button class="empty-action" @click=${() => this._navigate(fabPath)}>
            ${isTunnel ? t('tunnelNewTitle') : t('entrypointNewTitle')}
          </button>
        </div>
      `;
    }

    return html``;
  }

  // ── Styles ────────────────────────────────────────────────────────────

  static styles = css`
    /* ── Home header (inside appbar slot) ── */
    .home-header {
      display: flex;
      align-items: center;
      width: 100%;
      gap: 8px;
    }

    .app-icon {
      width: 28px;
      height: 28px;
      padding: 4px;
      border-radius: 50%;
      background: #000;
      object-fit: contain;
      flex-shrink: 0;
    }

    .appbar-title {
      font-size: var(--font-md);
      font-weight: 600;
      color: var(--text);
    }

    .header-spacer {
      flex: 1;
    }

    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background var(--transition-fast), color var(--transition-fast);
      width: 28px;
      height: 28px;
    }

    .icon-btn:hover {
      background: var(--border-subtle);
      color: var(--text);
    }

    .icon-btn.active {
      color: var(--amber);
    }

    /* ── List ── */
    .list {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px 16px 80px 16px;
    }

    /* ── Expand panel ── */
    .expand-panel {
      padding: 12px 16px 12px 30px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .expand-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: var(--font-sm);
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      color: var(--text-secondary);
      word-break: break-all;
    }

    .expand-row .mono {
      flex: 1;
      color: var(--text);
    }

    .expand-actions {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }

    .action-btn {
      padding: 5px 12px;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: var(--font-sm);
      line-height: 1;
      cursor: pointer;
      font-family: inherit;
      transition: background var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .action-btn svg {
      width: 14px;
      height: 14px;
    }

    .action-btn:hover {
      background: var(--border-subtle);
    }

    .action-btn.start {
      background: var(--green);
      color: #fff;
      border-color: var(--green);
    }

    .action-btn.stop {
      background: var(--red);
      color: #fff;
      border-color: var(--red);
    }

    .action-btn.danger {
      color: var(--red);
      border-color: var(--red-border);
    }

    .expand-error {
      font-size: var(--font-sm);
      color: var(--red-text);
      padding: 4px 8px;
      background: var(--red-bg);
      border-radius: var(--radius-sm);
    }

    /* ── Expand detail card ── */
    .detail-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
    }
    .detail-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-row .dlabel {
      color: var(--text-muted);
      font-size: var(--font-sm);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .detail-row .dval {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: var(--font-md);
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .dval-mono {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail-row.error {
      background: var(--red-bg);
    }
    .detail-row .error-text {
      color: var(--red-text);
    }
    .copy-btn-mini {
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px;
      color: var(--text-muted);
      display: flex;
      border-radius: 3px;
    }
    .copy-btn-mini:hover {
      background: var(--border-subtle);
      color: var(--text);
    }

    /* ── Empty state ── */
    .empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 40px;
      color: var(--text-muted);
      gap: 8px;
      text-align: center;
    }

    .empty-icon-wrap {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--surface);
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 8px;
      color: var(--text-muted);
    }

    .empty-title {
      font-weight: 600;
      font-size: var(--font-md);
      color: var(--text);
    }

    .empty-desc {
      font-size: var(--font-md);
      color: var(--text-secondary);
      max-width: 240px;
      line-height: 1.5;
      margin-bottom: 4px;
    }

    .empty-action {
      padding: 7px 18px;
      border-radius: var(--radius-md);
      border: none;
      background: var(--accent);
      color: var(--accent-fg);
      font-size: var(--font-md);
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: opacity var(--transition-fast);
    }

    .empty-action:hover {
      opacity: 0.85;
    }

    .empty-sub-link {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: var(--font-sm);
      cursor: pointer;
      font-family: inherit;
      text-decoration: underline;
      padding: 4px 8px;
    }

    .empty-sub-link:hover {
      color: var(--text);
    }

    /* ── Loading ── */
    .loading {
      display: flex;
      justify-content: center;
      padding: 24px;
    }

    /* ── FAB ── */
    .fab {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      background: var(--accent);
      color: var(--accent-fg);
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.1s, opacity var(--transition-fast);
    }

    .fab:hover {
      opacity: 0.9;
    }

    .fab:active {
      transform: scale(0.96);
    }

    /* ── Toast ── */
    .toast {
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--surface);
      color: var(--text);
      padding: 10px 20px;
      border-radius: var(--radius-lg);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-size: var(--font-sm);
      z-index: 100;
      animation: toast-in 0.3s ease;
    }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(-12px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }

    /* ── Delete dialog ── */
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 200;
      animation: fade-in 0.15s ease;
    }

    @keyframes fade-in {
      from { opacity: 0; }
    }

    .dialog-box {
      background: var(--surface);
      border-radius: var(--radius-lg);
      padding: 24px;
      max-width: 320px;
      width: 90%;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    }

    .dialog-title {
      font-weight: 600;
      font-size: var(--font-md);
      margin-bottom: 8px;
      text-align: center;
    }

    .dialog-message {
      color: var(--text-secondary);
      font-size: var(--font-sm);
      margin-bottom: 20px;
      text-align: center;
      line-height: 1.5;
    }

    .dialog-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }

    .dialog-btn {
      padding: 8px 20px;
      border-radius: var(--radius-pill);
      border: none;
      cursor: pointer;
      font-size: var(--font-sm);
      font-weight: 500;
      font-family: inherit;
      transition: opacity var(--transition-fast);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .dialog-btn.cancel {
      background: var(--border-subtle);
      color: var(--text);
    }

    .dialog-btn.danger {
      background: var(--red);
      color: #fff;
    }

    .dialog-btn:hover {
      opacity: 0.85;
    }
  `;

  // ── Action state ─────────────────────────────────────────────────────

  @state() private _snackbar = '';
  @state() private _deleteTarget: { kind: 'tunnel' | 'entrypoint'; id: string; name: string } | null = null;

  private _showSnackbar(msg: string) {
    this._snackbar = msg;
    setTimeout(() => {
      this._snackbar = '';
      this.requestUpdate();
    }, 2500);
  }

  private async _handleStart(item: Item) {
    try {
      if (item.kind === 'tunnel') {
        await startTunnel(item.data.id);
      } else {
        await startEntrypoint(item.data.id);
      }
      this._showSnackbar(t('started'));
    } catch {
      this._showSnackbar(t('startFailed'));
    }
  }

  private async _handleStop(item: Item) {
    try {
      if (item.kind === 'tunnel') {
        await stopTunnel(item.data.id);
      } else {
        await stopEntrypoint(item.data.id);
      }
      this._showSnackbar(t('stopped'));
    } catch {
      this._showSnackbar(t('stopFailed'));
    }
  }

  private _confirmDelete(kind: 'tunnel' | 'entrypoint', id: string, name: string) {
    this._deleteTarget = { kind, id, name };
  }

  private async _handleDelete() {
    if (!this._deleteTarget) return;
    const { kind, id } = this._deleteTarget;
    this._deleteTarget = null;
    try {
      if (kind === 'tunnel') {
        await import('../store/tunnel-store').then(m => m.remove(id));
      } else {
        await import('../store/entrypoint-store').then(m => m.remove(id));
      }
      this._expandedId = null;
      this._showSnackbar(t('deleted'));
    } catch {
      this._showSnackbar(t('deleteFailed'));
    }
  }

  private async _handleFavorite(item: Item) {
    if (item.kind === 'tunnel') {
      await toggleFavorite(item.data.id);
    } else {
      await toggleEntrypointFavorite(item.data.id);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────

  render() {
    const items = this._items;
    const isLoading = this._isLoading();
    const emptyLabel = this.tabIndex === 0 ? t('homeEmptyTunnels') : t('homeEmptyEntrypoints');
    const fabPath = this.tabIndex === 0 ? '/tunnel/new' : '/entrypoint/new';

    return html`
      <app-scaffold>
        <!-- Appbar -->
        <div slot="appBar" class="home-header">
          <img class="app-icon" src="/logo.png" alt="Wisper" />
          <span class="appbar-title">${t('appName')}</span>
          <span class="header-spacer"></span>
          <button class="icon-btn" @click=${() => this._navigate('/settings')}>
            ${icon('settings')}
          </button>
        </div>

        <!-- Tabs -->
        <nav-tabs
          .tabs=${[t('homeTabTunnel'), t('homeTabEntrypoint')]}
          .activeIndex=${this.tabIndex}
          @tab-change=${(e: CustomEvent) => {
            this.tabIndex = e.detail.index;
            this._expandedId = null;
          }}
        ></nav-tabs>

        <!-- Body -->
        ${isLoading
          ? html`<div class="loading"><wisper-spinner></wisper-spinner></div>`
          : items.length === 0
            ? this._renderEmptyState()
            : html`
              <div class="list">
                ${items.map(item => {
                  const detailPath =
                    item.kind === 'tunnel'
                      ? `/tunnel/${item.data.type}/${item.data.id}`
                      : `/entrypoint/${item.data.type}/${item.data.id}`;
                  const isExpanded = this._expandedId === item.data.id;

                  return html`
                    <div>
                      <tunnel-card
                        .name=${item.data.name}
                        .meta=${this._metaLine(item)}
                        .status=${item.data.status}
                        .endpoint=${item.data.endpoint}
                        .error=${item.data.error}
                        .createdAt=${item.data.created_at}
                        .currentConns=${item.data.stats.current_conns}
                        .totalConns=${item.data.stats.total_conns}
                        .requestRate=${item.data.stats.request_rate}
                        .inputBytes=${item.data.stats.input_bytes}
                        .outputBytes=${item.data.stats.output_bytes}
                        .inputRate=${item.data.stats.input_rate_bytes}
                        .outputRate=${item.data.stats.output_rate_bytes}
                        .expanded=${isExpanded}
                        .compact=${true}
                        @card-click=${() => this._navigate(detailPath)}
                        @chevron-click=${() => this._toggleExpand(item.data.id)}
                      ></tunnel-card>

                      ${isExpanded
                        ? html`
                          <div class="expand-panel">
                            <div class="detail-card">
                              <div class="detail-row">
                                <span class="dlabel">${item.kind === 'tunnel' ? 'Entrypoint' : 'Endpoint'}</span>
                                <span class="dval">
                                  <span class="dval-mono">${item.data.entrypoint}</span>
                                  <button class="copy-btn-mini" @click=${async (e: Event) => { e.stopPropagation(); await copyToClipboard(item.data.entrypoint); this._showSnackbar(t('copiedToClipboard')); }}>
                                    ${icon('copy')}
                                  </button>
                                </span>
                              </div>
                              <div class="detail-row">
                                <span class="dlabel">${item.kind === 'tunnel' ? 'Target' : 'Bind'}</span>
                                <span class="dval"><span class="dval-mono">${item.data.endpoint}</span></span>
                              </div>
                              ${item.kind === 'tunnel' && (item.data as import('../api/types').Tunnel).options?.hostname
                                ? html`<div class="detail-row">
                                  <span class="dlabel">Host Rewrite</span>
                                  <span class="dval"><span class="dval-mono">${(item.data as import('../api/types').Tunnel).options.hostname}</span></span>
                                </div>`
                                : ''}
                              ${item.data.error
                                ? html`<div class="detail-row error"><span class="dlabel">Error</span><span class="dval error-text"><span class="dval-mono">${item.data.error}</span></span></div>`
                                : ''}
                            </div>
                            <div class="expand-actions">
                              ${item.data.status === 'running'
                                ? html`
                                  <button class="action-btn stop" @click=${(e: Event) => {
                                    e.stopPropagation();
                                    this._handleStop(item);
                                  }}>■ ${t('btnStop')}</button>
                                `
                                : html`
                                  <button class="action-btn start" @click=${(e: Event) => {
                                    e.stopPropagation();
                                    this._handleStart(item);
                                  }}>▶ ${t('btnStart')}</button>
                                `}
                              <button class="action-btn" @click=${(e: Event) => {
                                e.stopPropagation();
                                this._navigate(detailPath + '?edit');
                              }}>${icon('edit')} ${t('btnEdit')}</button>
                              <button class="action-btn danger" @click=${(e: Event) => {
                                e.stopPropagation();
                                this._confirmDelete(item.kind, item.data.id, item.data.name);
                              }}>${icon('trash')} ${t('btnDelete')}</button>
                            </div>
                          </div>
                        `
                        : ''}
                    </div>
                  `;
                })}
              </div>
            `}

        <!-- FAB -->
        <div slot="fab">
          <button class="fab" @click=${() => this._navigate(fabPath)}>
            ${icon('plus')}
          </button>
        </div>
      </app-scaffold>

      ${this._snackbar ? html`<div class="toast">${this._snackbar}</div>` : ''}

      ${this._deleteTarget
        ? html`
          <div class="dialog-overlay" @click=${() => { this._deleteTarget = null; }}>
            <div class="dialog-box" @click=${(e: Event) => e.stopPropagation()}>
              <div class="dialog-title">${t('deleteConfirmTitle')}</div>
              <div class="dialog-message">${t('deleteConfirmMessage')}</div>
              <div class="dialog-actions">
                <button class="dialog-btn cancel" @click=${() => { this._deleteTarget = null; }}>
                  ${t('btnCancel')}
                </button>
                <button class="dialog-btn danger" @click=${this._handleDelete}>
                  ${t('btnDelete')}
                </button>
              </div>
            </div>
          </div>
        `
        : ''}
    `;
  }
}
