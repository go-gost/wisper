import { LitElement, html, css, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { GoBackend } from '../api/backend';
import type { Entrypoint, EntrypointRequest } from '../api/types';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { formatBytes, formatDuration, formatRequestTimestamp } from '../utils/format';
import { requestDestination, ruleCovers } from '../utils/entrypoint-request';
import { updateEntrypointRules } from '../store/entrypoint-store';
import '../components/app-scaffold';

const POLL_MS = 2000;
const MAX_RENDERED = 200;

const FILTERS = [
  { value: 'all', label: 'requestsFilterAll' },
  { value: 'direct', label: 'requestsDirect' },
  { value: 'tunneled', label: 'requestsTunnel' },
  { value: 'error', label: 'requestsFlowError' },
] as const;

type RequestFilter = (typeof FILTERS)[number]['value'];

@customElement('entrypoint-requests-page')
export class EntrypointRequestsPage extends LitElement {
  @property({ attribute: 'parent-type' }) parentType = '';
  @property({ attribute: 'parent-id' }) parentId = '';

  @state() private _requests: EntrypointRequest[] = [];
  @state() private _entrypoint: Entrypoint | null = null;
  @state() private _error = '';
  @state() private _auto = true;
  @state() private _loading = false;
  @state() private _pageHidden = document.visibilityState !== 'visible';
  @state() private _savingKey = '';
  @state() private _rowErrors = new Map<string, string>();
  @state() private _expanded = new Set<string>();
  @state() private _query = '';
  @state() private _filter: RequestFilter = 'all';

  private _backend = new GoBackend();
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  private _activeId = '';
  private _loadToken = 0;

  private _onVisibilityChange = () => {
    this._pageHidden = document.visibilityState !== 'visible';
    this._configurePolling();
    if (!this._pageHidden && this._auto) void this._load();
  };

  connectedCallback() {
    super.connectedCallback();
    this._connected = true;
    this._activeId = this.parentId;
    this._pageHidden = document.visibilityState !== 'visible';
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    this._configurePolling();
    void this._load();
  }

  disconnectedCallback() {
    this._connected = false;
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    this._clearTimer();
    super.disconnectedCallback();
  }

  protected updated(changed: PropertyValues) {
    if (!changed.has('parentId') || !this._connected || this.parentId === this._activeId) return;
    this._activeId = this.parentId;
    this._loadToken += 1;
    this._requests = [];
    this._entrypoint = null;
    this._error = '';
    this._loading = false;
    this._savingKey = '';
    this._rowErrors = new Map();
    this._expanded = new Set();
    this._query = '';
    this._filter = 'all';
    this._configurePolling();
    void this._load();
  }

  private _clearTimer() {
    if (this._timer !== null) clearTimeout(this._timer);
    this._timer = null;
  }

  private _configurePolling() {
    this._clearTimer();
    if (!this._connected || !this._auto || this._pageHidden) return;
    this._timer = window.setTimeout(() => {
      this._timer = null;
      if (!this._connected || !this._auto || this._pageHidden) return;
      void this._load().then(() => this._configurePolling());
    }, POLL_MS);
  }

  private async _load(force = false): Promise<void> {
    const id = this.parentId;
    if (!id || !this._connected || (this._loading && !force)) return;

    const token = ++this._loadToken;
    this._loading = true;
    try {
      const [body, entrypoint] = await Promise.all([
        this._backend.getEntrypointRequests(id, 500),
        this._backend.getEntrypoint(id),
      ]);
      if (!this._connected || token !== this._loadToken || id !== this._activeId) return;
      this._requests = [...(body.requests ?? [])].sort(
        (a, b) => Date.parse(b.time) - Date.parse(a.time),
      );
      this._entrypoint = entrypoint;
      this._error = '';
    } catch (e: unknown) {
      if (!this._connected || token !== this._loadToken || id !== this._activeId) return;
      const message = e instanceof Error ? e.message : '';
      this._error = `${t('requestsError')}${message ? `: ${message}` : ''}`;
    } finally {
      if (token === this._loadToken) this._loading = false;
    }
  }

  private _toggleAuto() {
    this._auto = !this._auto;
    this._configurePolling();
    if (this._auto && !this._pageHidden) void this._load();
  }

  private _requestKey(request: EntrypointRequest): string {
    return [request.time, request.host, request.dst, request.network, request.proto].join('|');
  }

  private _onSearchInput(event: Event) {
    this._query = (event.target as HTMLInputElement).value;
  }

  private _matchesFilter(request: EntrypointRequest): boolean {
    switch (this._filter) {
      case 'direct':
        return !request.tunneled;
      case 'tunneled':
        return request.tunneled;
      case 'error':
        return request.err !== '';
      default:
        return true;
    }
  }

  private _matchesQuery(request: EntrypointRequest): boolean {
    const query = this._query.trim().toLowerCase();
    if (!query) return true;
    return [request.host, request.dst].some(value => value.toLowerCase().includes(query));
  }

  private get _filteredRequests(): EntrypointRequest[] {
    return this._requests.filter(
      request => this._matchesFilter(request) && this._matchesQuery(request),
    );
  }

  private get _filtering(): boolean {
    return this._query.trim() !== '' || this._filter !== 'all';
  }

  private _toggleExpanded(request: EntrypointRequest) {
    const key = this._requestKey(request);
    const next = new Set(this._expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this._expanded = next;
  }

  private _setRowError(key: string, message: string) {
    const next = new Map(this._rowErrors);
    if (message) next.set(key, message);
    else next.delete(key);
    this._rowErrors = next;
  }

  private async _toggleRule(request: EntrypointRequest) {
    const id = this.parentId;
    const { key } = requestDestination(request);
    if (!id || !key || this._savingKey) return;

    const rules = this._entrypoint?.options?.rules ?? [];
    const listed = rules.includes(key);
    if (!listed && rules.some(rule => ruleCovers(rule, key))) return;
    const next = listed ? rules.filter(rule => rule !== key) : [...new Set([...rules, key])];
    this._savingKey = key;
    this._setRowError(key, '');
    try {
      const entrypoint = await updateEntrypointRules(id, next);
      if (!this._connected || id !== this._activeId) return;
      this._entrypoint = entrypoint;
      await this._load(true);
    } catch (e: unknown) {
      if (!this._connected || id !== this._activeId) return;
      const message = e instanceof Error ? e.message : '';
      this._setRowError(key, `${t('requestsRuleError')}${message ? `: ${message}` : ''}`);
    } finally {
      if (this._connected && id === this._activeId) this._savingKey = '';
    }
  }

  private _renderDetailChip(label: string, value: string, error = false) {
    return html`
      <span class="detail-chip ${error ? 'error' : ''}">
        <span class="detail-label">${label}:</span>
        <span class="detail-value">${value}</span>
      </span>
    `;
  }

  private _renderDetails(request: EntrypointRequest, duration: string) {
    const route = request.path?.length
      ? request.path.map(hop => hop.chain && hop.node ? `${hop.chain}/${hop.node}` : hop.chain || hop.node || hop.addr).join(' → ')
      : t('requestsRouteDirect');
    const bytes = t('requestsTrafficValue', {
      in: formatBytes(request.input_bytes),
      out: formatBytes(request.output_bytes),
    });
    return html`
      <div class="detail-chips">
        ${request.host && request.host !== request.dst ? this._renderDetailChip(t('requestsHost'), request.host) : nothing}
        ${this._renderDetailChip(t('fieldTarget'), request.dst)}
        ${this._renderDetailChip(t('requestsRoute'), route)}
        ${this._renderDetailChip(t('requestsDuration'), duration)}
        ${this._renderDetailChip(t('requestsBytes'), bytes)}
        ${request.err ? this._renderDetailChip(t('requestsFlowError'), request.err, true) : nothing}
      </div>
    `;
  }

  private _renderRequest(request: EntrypointRequest) {
    const destination = requestDestination(request);
    const destinationLabel = `${destination.name}${destination.port ? `:${destination.port}` : ''}`;
    const rules = this._entrypoint?.options?.rules ?? [];
    const listed = rules.includes(destination.key);
    const coveringRule = listed ? undefined : rules.find(rule => ruleCovers(rule, destination.key));
    const coveredLabel = coveringRule ? t('requestsRuleCoveredBy', { rule: coveringRule }) : '';
    const protocol = [request.network, request.proto].filter(Boolean).join(' · ');
    const traffic = t('requestsTrafficValue', {
      in: formatBytes(request.input_bytes),
      out: formatBytes(request.output_bytes),
    });
    const summary = [protocol, traffic].filter(Boolean).join(' · ');
    const duration = formatDuration(request.duration_ms * 1_000_000);
    const key = this._requestKey(request);
    const expanded = this._expanded.has(key);
    const rowError = this._rowErrors.get(destination.key);
    const actionLabel = listed
      ? t('requestsRemoveRuleFor', { destination: destination.key })
      : t('requestsAddRuleFor', { destination: destination.key });
    const primary = html`
      <span class="destination" title=${destinationLabel}>
        ${destination.name}${destination.port ? html`<span class="destination-port">:${destination.port}</span>` : nothing}
      </span>
      ${request.tunneled
        ? html`<span class="tunnel-lock" role="img" title=${t('requestsTunnel')} aria-label=${t('requestsTunnel')}>
            ${icon('lock')}
          </span>`
        : nothing}
      <span class="duration">${duration}</span>
      <span class="path-chevron" aria-hidden="true">${icon(expanded ? 'chevron-down' : 'chevron-right')}</span>
      <span class="sr-only">${expanded
        ? t('requestsPathHide', { destination: destinationLabel })
        : t('requestsPathShow', { destination: destinationLabel })}</span>
    `;

    return html`
      <li class="request-row ${request.err ? 'error' : ''}">
        <div class="request-line">
          <button type="button" class="row-toggle"
            aria-expanded=${expanded}
            @click=${() => this._toggleExpanded(request)}>${primary}</button>
          ${destination.key
            ? listed
              ? html`<button type="button" class="rule-action"
                  title=${actionLabel}
                  aria-label=${actionLabel}
                  ?disabled=${this._savingKey !== ''}
                  @click=${() => this._toggleRule(request)}>
                  <span aria-hidden="true">${icon('minus')}</span>
                </button>`
              : coveringRule
                ? html`<span class="rule-covered" role="img" title=${coveredLabel} aria-label=${coveredLabel}>
                    <span aria-hidden="true">${icon('check')}</span>
                  </span>`
                : html`<button type="button" class="rule-action"
                    title=${actionLabel}
                    aria-label=${actionLabel}
                    ?disabled=${this._savingKey !== ''}
                    @click=${() => this._toggleRule(request)}>
                    <span aria-hidden="true">${icon('plus')}</span>
                  </button>`
            : nothing}
        </div>
        <div class="request-meta">
          <span class="meta-summary" title=${summary}>${summary}</span>
          <time class="meta-time" datetime=${request.time}>${formatRequestTimestamp(request.time)}</time>
        </div>
        ${rowError ? html`<div class="row-error" role="alert">${rowError}</div>` : nothing}
        ${expanded ? this._renderDetails(request, duration) : nothing}
      </li>
    `;
  }

  private get _backPath(): string {
    return `/entrypoint/${this.parentType}/${this.parentId}`;
  }

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  render() {
    const filtered = this._filteredRequests;
    const visible = filtered.slice(0, MAX_RENDERED);
    const count = this._filtering
      ? t('requestsFilteredCount', { shown: filtered.length, total: this._requests.length })
      : t(this._requests.length === 1 ? 'requestsCountOne' : 'requestsCount', {
          n: this._requests.length,
        });
    return html`
      <app-scaffold>
        <div slot="appBar" class="page-header">
          <button type="button" class="back-btn" aria-label=${t('requestsBack')}
            @click=${() => this._navigate(this._backPath)}>
            <span aria-hidden="true">${icon('chevron-left')}</span>
          </button>
          <h1 class="page-title">${t('requestsPageTitle')}</h1>
          <div class="controls">
            <button type="button" class="auto-toggle" aria-pressed=${this._auto}
              @click=${this._toggleAuto}>
              <span class="toggle-track" aria-hidden="true"><span class="toggle-knob"></span></span>
              <span>${t('requestsAuto')}</span>
            </button>
            <button type="button" class="refresh-button" ?disabled=${this._loading}
              @click=${() => this._load(true)}>
              <span aria-hidden="true">${icon('rotate-cw')}</span>
              <span>${t('requestsRefresh')}</span>
            </button>
          </div>
        </div>

        <div class="requests-panel">
          <div class="panel-header">
            <span class="requests-count">${count}</span>
            ${this._pageHidden ? html`<div class="pause-indicator" role="status">${t('requestsPausedHidden')}</div>` : nothing}
          </div>
          ${this._requests.length > 0
            ? html`
              <div class="request-tools">
                <search class="requests-search">
                  <label class="sr-only" for="requests-search">${t('requestsSearchLabel')}</label>
                  <input id="requests-search" name="q" type="search" class="search-input"
                    .value=${this._query}
                    placeholder=${t('requestsSearchPlaceholder')}
                    autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false"
                    @input=${this._onSearchInput}>
                </search>
                <fieldset class="request-filters">
                  <legend class="sr-only">${t('requestsFilterLabel')}</legend>
                  ${FILTERS.map(filter => html`
                    <label class="filter-chip">
                      <input class="sr-only" type="radio" name="request-filter" value=${filter.value}
                        .checked=${this._filter === filter.value}
                        @change=${() => { this._filter = filter.value; }}>
                      <span>${t(filter.label)}</span>
                    </label>
                  `)}
                </fieldset>
              </div>
            `
            : nothing}
          ${this._error ? html`<div class="requests-error" role="alert">${this._error}</div>` : nothing}
          ${this._requests.length === 0
            ? html`<div class="requests-empty">${t('requestsEmpty')}</div>`
            : filtered.length === 0
              ? html`<div class="requests-no-matches">${t('requestsNoMatches')}</div>`
              : html`
                <ol class="request-list" role="list" aria-label=${t('requestsPageTitle')}>
                  ${visible.map(request => this._renderRequest(request))}
                </ol>
                ${filtered.length > visible.length
                  ? html`<div class="showing-count">${t('requestsShowing', {
                      shown: visible.length,
                      total: filtered.length,
                    })}</div>`
                  : nothing}
              `}
        </div>
      </app-scaffold>
    `;
  }

  static styles = css`
    :host { display: block; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
    .page-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .back-btn, .auto-toggle, .refresh-button {
      min-height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
      background: var(--surface); color: var(--text-secondary); font-family: inherit; font-size: var(--font-sm);
      cursor: pointer;
    }
    .back-btn { padding: 4px 8px; }
    .back-btn svg { width: 15px; height: 15px; }
    .page-title { flex: 1; min-width: 120px; margin: 0; font-size: var(--font-md); font-weight: 600; color: var(--text); }
    .controls { display: flex; align-items: center; gap: 6px; }
    .auto-toggle, .refresh-button { padding: 4px 8px; }
    .refresh-button svg { width: 13px; height: 13px; }
    button:disabled { cursor: default; opacity: 0.55; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .toggle-track {
      width: 28px; height: 16px; padding: 2px; box-sizing: border-box;
      border-radius: 8px; background: var(--border); transition: background var(--transition-fast);
    }
    .toggle-knob {
      display: block; width: 12px; height: 12px; border-radius: 50%; background: #fff;
      transition: transform var(--transition-fast);
    }
    .auto-toggle[aria-pressed='true'] .toggle-track { background: var(--accent); }
    .auto-toggle[aria-pressed='true'] .toggle-knob { transform: translateX(12px); }
    .requests-panel {
      min-width: 0; margin: 16px; background: var(--surface); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg); overflow: hidden; container-type: inline-size;
    }
    .panel-header {
      min-height: 32px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between;
      gap: 12px; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-sm);
    }
    .requests-count { color: var(--text-muted); white-space: nowrap; }
    .pause-indicator { color: var(--amber); font-size: var(--font-xs); }
    .requests-error {
      padding: 8px 12px; color: var(--red-text); background: var(--red-bg);
      font-size: var(--font-sm); line-height: 1.4;
    }
    .requests-empty { padding: 32px 12px; text-align: center; color: var(--text-muted); font-size: var(--font-sm); }
    .requests-no-matches { padding: 32px 12px; text-align: center; color: var(--text-muted); font-size: var(--font-sm); }
    .request-tools {
      min-width: 0; padding: 8px 12px; display: flex; flex-direction: column; gap: 8px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .requests-search { min-width: 0; }
    .search-input {
      width: 100%; box-sizing: border-box; padding: 7px 10px;
      border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--surface); color: var(--text);
      font: inherit; font-size: max(1rem, 1em); outline: none;
      transition: border-color var(--transition-fast);
    }
    .search-input:focus { border-color: var(--accent); }
    .search-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .request-filters {
      min-width: 0; margin: 0; padding: 0; border: 0;
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    .filter-chip {
      position: relative; min-height: 28px; box-sizing: border-box; padding: 3px 10px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--border-subtle); border-radius: 999px;
      background: var(--surface); color: var(--text-secondary);
      font-size: var(--font-xs); cursor: pointer;
    }
    .filter-chip:has(input:checked) {
      border-color: var(--accent); background: var(--accent); color: #fff; font-weight: 600;
    }
    .filter-chip:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
    .request-list {
      list-style: none; min-width: 0; margin: 0; padding: 8px;
      display: flex; flex-direction: column; gap: 4px; overflow-x: hidden;
    }
    .request-row {
      min-width: 0; box-sizing: border-box; padding: 8px 12px;
      border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
      background: var(--surface); font-size: var(--font-sm);
    }
    .request-row.error { border-left: 2px solid var(--red); }
    .request-row:hover { background: var(--border-subtle); }
    .request-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .row-toggle {
      flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px;
      border: 0; padding: 0; background: none; color: inherit; font: inherit; text-align: left;
      white-space: nowrap; cursor: pointer;
    }
    .row-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 2px; }
    .destination {
      flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; color: var(--text); font-family: var(--font-mono, 'SF Mono', monospace);
      font-weight: 500;
    }
    .destination-port { color: var(--text-muted); }
    .tunnel-lock { display: inline-flex; color: var(--accent); flex-shrink: 0; }
    .tunnel-lock svg { width: 13px; height: 13px; }
    .duration {
      margin-left: auto; flex-shrink: 0; color: var(--text-muted);
      font-family: var(--font-mono, 'SF Mono', monospace);
    }
    .path-chevron { display: inline-flex; color: var(--text-muted); flex-shrink: 0; }
    .path-chevron svg { width: 12px; height: 12px; }
    .rule-action {
      flex: 0 0 24px; width: 24px; height: 24px; min-height: 24px; box-sizing: border-box;
      padding: 0; display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
      background: var(--surface); color: var(--accent); cursor: pointer; flex-shrink: 0;
    }
    .rule-action > span, .rule-covered > span { display: inline-flex; }
    .rule-action svg, .rule-covered svg { width: 12px; height: 12px; }
    .rule-covered {
      flex: 0 0 24px; width: 24px; height: 24px; min-height: 24px; box-sizing: border-box;
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--text-muted); cursor: default; flex-shrink: 0;
    }
    .request-meta {
      min-width: 0; margin-top: 2px; display: flex; align-items: center; gap: 8px;
      color: var(--text-muted); font-size: var(--font-xs); line-height: 1.4;
    }
    .meta-summary {
      flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .meta-time {
      margin-left: auto; flex: 0 0 auto; color: var(--text-muted);
      font-family: var(--font-mono, 'SF Mono', monospace); white-space: nowrap;
    }
    .detail-chips {
      min-width: 0; margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px;
    }
    .detail-chip {
      min-width: 0; max-width: 100%; box-sizing: border-box; padding: 2px 8px;
      display: inline-flex; align-items: baseline; gap: 5px; border-radius: var(--radius-sm);
      background: var(--border); color: var(--text);
      font-size: var(--font-xs); line-height: 1.5; overflow-wrap: anywhere;
    }
    .detail-label { flex-shrink: 0; color: var(--text-muted); }
    .detail-value {
      min-width: 0; font-family: var(--font-mono, 'SF Mono', monospace); overflow-wrap: anywhere;
    }
    .detail-chip.error { background: var(--red-bg); color: var(--red-text); }
    .detail-chip.error .detail-label { color: var(--red-text); }
    .row-error {
      min-width: 0; margin-top: 5px; color: var(--red-text); font-size: var(--font-xs);
      line-height: 1.4; overflow-wrap: anywhere;
    }
    .showing-count { padding: 8px 12px; border-top: 1px solid var(--border-subtle); color: var(--text-muted); font-size: var(--font-xs); }
    @media (pointer: coarse) {
      .back-btn, .auto-toggle, .refresh-button { min-height: 36px; }
      .filter-chip { min-height: 32px; }
    }
  `;
}
