import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ProtocolType, InspectorRecord } from '../api/types';
import { InspectorApiClient } from '../api/inspector';
import { getSettings, subscribe } from '../store/settings-store';
import { getTunnels } from '../store/tunnel-store';
import { getEntrypoints } from '../store/entrypoint-store';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import type { RangeValue } from '../components/inspector/filter-bar';

import '../components/app-scaffold';
import '../components/inspector/protocol-tabs';
import '../components/inspector/mode-toggle';
import '../components/inspector/filter-bar';
import '../components/inspector/record-list';
import '../components/inspector/live-indicator';

type InspectorMode = 'query' | 'live';

@customElement('inspector-page')
export class InspectorPage extends LitElement {
  @property() parentKind: 'tunnel' | 'entrypoint' = 'tunnel';
  @property() parentType = '';
  @property() parentId = '';

  @state() private _mode: InspectorMode = 'query';
  @state() private _protocol: ProtocolType = 'http';
  @state() private _records: InspectorRecord[] = [];
  @state() private _selectedIndex = -1;
  @state() private _sid = '';
  @state() private _range: RangeValue = 'all';
  @state() private _cursor: string | null = null;
  @state() private _hasMore = true;
  @state() private _loading = false;
  @state() private _liveConnected = false;
  @state() private _liveStopped = false;
  @state() private _error = '';

  private _client: InspectorApiClient | null = null;
  private _clientUrl = '';
  private _unsub: (() => void) | null = null;
  private _ws: WebSocket | null = null;
  private _reconnectDelay = 1000;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    super.connectedCallback();
    this._initClient();
    this._fetchRecords();
    // Settings load asynchronously (app.ts firstUpdated). If inspector_url
    // wasn't available yet, re-init and run the first query once it arrives.
    this._unsub = subscribe(() => this._onSettings());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._closeWs();
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._unsub?.();
    this._unsub = null;
  }

  /** (Re)build the API client when inspector_url is available or changed. */
  private _initClient(): boolean {
    const url = getSettings().inspector_url || '';
    if (url && url !== this._clientUrl) {
      this._client = new InspectorApiClient(url);
      this._clientUrl = url;
      return true;
    }
    return false;
  }

  private _onSettings() {
    const wasUnconfigured = !this._client;
    if (this._initClient() && wasUnconfigured) {
      // First time we have a working URL — run the query/openWs that
      // connectedCallback had to skip because settings hadn't loaded yet.
      if (this._mode === 'query') {
        this._hasMore = true;
        this._cursor = null;
        this._fetchRecords();
      } else {
        this._openWs();
      }
    }
  }

  private _getClientId(): string {
    if (this.parentKind === 'tunnel') {
      return this.parentId;
    }
    const eps = getEntrypoints();
    const ep = eps.find(e => e.id === this.parentId);
    return (ep as any)?.options?.tunnel_id || this.parentId;
  }

  private _getParentName(): string {
    if (this.parentKind === 'tunnel') {
      const ts = getTunnels();
      return ts.find(t => t.id === this.parentId)?.name || this.parentId;
    }
    const eps = getEntrypoints();
    return eps.find(e => e.id === this.parentId)?.name || this.parentId;
  }

  private async _fetchRecords(before?: string) {
    if (!this._client || this._loading) return;
    this._loading = true;
    this._error = '';

    try {
      const resp = await this._client.query({
        client_id: this._getClientId(),
        type: this._protocol,
        sid: this._sid || undefined,
        start: this._range !== 'all' ? Math.floor(Date.now() / 1000) - (this._range as number) * 60 : undefined,
        before,
        limit: 50,
      });

      if (resp.code === 0 && resp.data) {
        const list = resp.data.list || [];
        if (before) {
          this._records = [...this._records, ...list];
        } else {
          this._records = list;
        }
        this._cursor = resp.data.before || null;
        this._hasMore = list.length >= 50;
      } else {
        this._error = resp.msg || resp.error || `query failed (code ${resp.code})`;
      }
    } catch (e) {
      // Surface instead of swallowing — a blank list with no clue is worse
      // than a visible error. (This is how the previous `if (after)`
      // ReferenceError hid itself: the catch ate it and the list went blank.)
      this._error = e instanceof Error ? e.message : String(e);
      console.error('[inspector] query failed:', e);
    }

    this._loading = false;
  }

  private _onLoadMore() {
    if (this._mode === 'query' && this._hasMore && this._cursor) {
      this._fetchRecords(this._cursor);
    }
  }

  private _openWs() {
    if (!this._client) return;
    this._closeWs();
    this._liveStopped = false;
    this._reconnectDelay = 1000;

    try {
      this._ws = this._client.connectTail({
        client_id: this._getClientId(),
        type: this._protocol,
        sid: this._sid || undefined,
      });

      this._ws.onopen = () => {
        this._liveConnected = true;
      };

      this._ws.onmessage = (ev) => {
        try {
          const record = JSON.parse(ev.data) as InspectorRecord;
          this._records = [record, ...this._records].slice(0, 200);
        } catch { /* ignore malformed messages */ }
      };

      this._ws.onclose = () => {
        this._liveConnected = false;
        if (!this._liveStopped) {
          this._scheduleReconnect();
        }
      };

      this._ws.onerror = () => {
        this._ws?.close();
      };
    } catch { /* connection failed */ }
  }

  private _scheduleReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      this._openWs();
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30000);
    }, this._reconnectDelay);
  }

  private _closeWs() {
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.onmessage = null;
      this._ws.close();
      this._ws = null;
    }
    this._liveConnected = false;
  }

  private _onModeChange(e: CustomEvent) {
    const mode = e.detail as InspectorMode;
    this._mode = mode;
    this._selectedIndex = -1;
    if (mode === 'live') {
      this._records = [];
      this._openWs();
    } else {
      this._closeWs();
      this._records = [];
      this._fetchRecords();
    }
  }

  private _onProtocolChange(e: CustomEvent) {
    this._protocol = e.detail as ProtocolType;
    this._selectedIndex = -1;
    if (this._mode === 'live') {
      this._records = [];
      this._openWs();
    } else {
      this._records = [];
      this._hasMore = true;
      this._cursor = null;
      this._fetchRecords();
    }
  }

  private _onFilterChange(e: CustomEvent) {
    const { sid } = e.detail;
    this._sid = sid;
    this._selectedIndex = -1;
    if (this._mode === 'live') {
      this._records = [];
      this._openWs();
    } else {
      this._records = [];
      this._hasMore = true;
      this._cursor = null;
      this._fetchRecords();
    }
  }

  private _onRangeChange(e: CustomEvent) {
    this._range = e.detail as RangeValue;
    this._selectedIndex = -1;
    // Mirror the protocol/sid handlers: reset cursor + refetch.
    // range-change only fires in query mode (the time row is query-only),
    // so no live-mode branch is needed.
    this._records = [];
    this._hasMore = true;
    this._cursor = null;
    this._fetchRecords();
  }

  private _onRecordSelect(e: CustomEvent) {
    const idx = e.detail as number;
    // Clicking the already-selected row collapses it; otherwise switch.
    this._selectedIndex = this._selectedIndex === idx ? -1 : idx;
  }

  private _onLiveStop() {
    this._liveStopped = true;
    this._closeWs();
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
  }

  private _onLiveReconnect() {
    this._liveStopped = false;
    this._openWs();
  }

  private _onLiveClear() {
    this._records = [];
    this._selectedIndex = -1;
  }

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  static styles = css`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }
    .page-title { font-size: var(--font-md); font-weight: 600; flex: 1; }
    .id-chip {
      font-size: var(--font-sm); padding: 2px 8px; border-radius: 10px;
      background: var(--border-subtle); color: var(--text-muted);
      font-family: var(--font-mono, 'SF Mono', monospace);
    }
    .spacer { height: 8px; }
  `;

  render() {
    const parentName = this._getParentName();
    const backPath = this.parentKind === 'tunnel'
      ? `/tunnel/${this.parentType}/${this.parentId}`
      : `/entrypoint/${this.parentType}/${this.parentId}`;
    const shortId = this._getClientId().slice(0, 8);

    // Not configured — show empty state
    if (!this._client) {
      return html`
        <app-scaffold>
          <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
            <button class="back-btn" @click=${() => this._navigate(backPath)}>
              ${icon('chevron-left')}
            </button>
            <span class="page-title">${t('inspectorTitle')}</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:64px 24px;text-align:center;color:var(--text-muted);gap:12px;">
            <div style="font-size:48px;">🔍</div>
            <div style="font-size:var(--font-md);color:var(--text-secondary);">${t('inspectorNotConfigured')}</div>
            <div style="font-size:var(--font-sm);">${t('inspectorNotConfiguredDesc')}</div>
            <a href="/settings" style="color:var(--accent);font-size:var(--font-sm);text-decoration:none;margin-top:8px;">&rarr; ${t('settingsTitle')}</a>
          </div>
        </app-scaffold>
      `;
    }

    return html`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${() => this._navigate(backPath)}>
            ${icon('chevron-left')}
          </button>
          <span class="page-title">
            &larr; ${parentName || this.parentId} &middot; ${t('inspectorTitle')}
          </span>
          <span class="id-chip">${shortId}</span>
        </div>

        <div style="padding:12px 16px 0;">
          <mode-toggle .mode=${this._mode} @mode-change=${this._onModeChange}></mode-toggle>
        </div>

        <div style="padding:8px 16px 0;">
          <protocol-tabs .active=${this._protocol} @protocol-change=${this._onProtocolChange}></protocol-tabs>
        </div>

        <div style="padding:8px 16px 0;">
          <inspector-filter-bar
            .sid=${this._sid}
            .mode=${this._mode}
            .range=${this._range}
            @filter-change=${this._onFilterChange}
            @range-change=${this._onRangeChange}>
          </inspector-filter-bar>
        </div>

        ${this._mode === 'live' ? html`
          <div style="padding:8px 16px 0;">
            <live-indicator
              .connected=${this._liveConnected}
              .recordCount=${this._records.length}
              .stopped=${this._liveStopped}
              @live-stop=${this._onLiveStop}
              @live-reconnect=${this._onLiveReconnect}
              @live-clear=${this._onLiveClear}>
            </live-indicator>
          </div>
        ` : ''}

        <div class="spacer"></div>

        <div style="padding:0 16px;">
          ${this._error ? html`<div style="color:var(--red);font-size:var(--font-sm);padding:6px 0;">⚠ ${this._error}</div>` : ''}
          <record-list
            .records=${this._records}
            .protocol=${this._protocol}
            .selectedIndex=${this._selectedIndex}
            .loading=${this._mode === 'query' && this._loading}
            .hasMore=${this._mode === 'query' && this._hasMore}
            @record-select=${this._onRecordSelect}
            @load-more=${() => this._onLoadMore()}>
          </record-list>
        </div>
      </app-scaffold>
    `;
  }
}
