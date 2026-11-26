import { LitElement, html, css, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { GoBackend } from '../api/backend';
import type { Entrypoint, EntrypointRequest } from '../api/types';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { formatBytes, formatClockTime, formatDuration } from '../utils/format';
import { requestDestination, ruleCovers } from '../utils/entrypoint-request';
import { updateEntrypointRules } from '../store/entrypoint-store';
import '../components/app-scaffold';

const POLL_MS = 2000;
const MAX_RENDERED = 200;

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

  private _renderPath(request: EntrypointRequest) {
    return html`
      <div class="path-heading">${t('requestsPath')}</div>
      <ol class="request-path" role="list">
        ${(request.path ?? []).map(hop => html`
          <li>
            <span>${t('requestsHop', { n: hop.hop })} · ${hop.chain || '—'} · ${hop.node || '—'}</span>
            <span class="path-address" title=${hop.addr}>${hop.addr}</span>
            <span>${formatDuration(hop.connect_ms * 1_000_000)}</span>
            ${hop.err ? html`<span class="request-error">${t('requestsFlowError')}: ${hop.err}</span>` : nothing}
          </li>
        `)}
      </ol>
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
    const duration = `${(request.duration_ms / 1000).toFixed(1)} s`;
    const key = this._requestKey(request);
    const expanded = this._expanded.has(key);
    const hasPath = Boolean(request.path?.length);
    const rowError = this._rowErrors.get(destination.key);
    const actionLabel = listed
      ? t('requestsRemoveRuleFor', { destination: destination.key })
      : t('requestsAddRuleFor', { destination: destination.key });
    const primary = html`
      <time datetime=${request.time}>${formatClockTime(Date.parse(request.time))}</time>
      <span class="destination" title=${destinationLabel}>
        ${destination.name}${destination.port ? html`<span class="destination-port">:${destination.port}</span>` : nothing}
      </span>
      <span class="route-badge ${request.tunneled ? 'tunnel' : 'direct'}">
        ${request.tunneled ? t('requestsTunnel') : t('requestsDirect')}
      </span>
      ${hasPath
        ? html`
          <span class="path-chevron" aria-hidden="true">${icon(expanded ? 'chevron-down' : 'chevron-right')}</span>
          <span class="sr-only">${expanded
            ? t('requestsPathHide', { destination: destinationLabel })
            : t('requestsPathShow', { destination: destinationLabel })}</span>
        `
        : nothing}
    `;

    return html`
      <li class="request-row">
        <div class="request-line">
          ${hasPath
            ? html`<button type="button" class="row-toggle"
                aria-expanded=${expanded}
                @click=${() => this._toggleExpanded(request)}>${primary}</button>`
            : html`<div class="row-content">${primary}</div>`}
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
          ${protocol ? html`<span class="protocol">${protocol}</span><span class="meta-separator">·</span>` : nothing}
          <span class="traffic">${t('requestsTrafficValue', {
            in: formatBytes(request.input_bytes),
            out: formatBytes(request.output_bytes),
          })}</span>
          <span class="meta-separator">·</span>
          <span class="duration">${duration}</span>
          ${request.err
            ? html`<span class="request-error" title=${request.err}>${request.err}</span>`
            : nothing}
        </div>
        ${rowError ? html`<div class="row-error" role="alert">${rowError}</div>` : nothing}
        ${hasPath && expanded ? this._renderPath(request) : nothing}
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
    const visible = this._requests.slice(0, MAX_RENDERED);
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
            <span class="requests-count">${t(
              this._requests.length === 1 ? 'requestsCountOne' : 'requestsCount',
              { n: this._requests.length },
            )}</span>
            ${this._pageHidden ? html`<div class="pause-indicator" role="status">${t('requestsPausedHidden')}</div>` : nothing}
          </div>
          ${this._error ? html`<div class="requests-error" role="alert">${this._error}</div>` : nothing}
          ${this._requests.length === 0
            ? html`<div class="requests-empty">${t('requestsEmpty')}</div>`
            : html`
              <ol class="request-list" role="list" aria-label=${t('requestsPageTitle')}>
                ${visible.map(request => this._renderRequest(request))}
              </ol>
              ${this._requests.length > visible.length
                ? html`<div class="showing-count">${t('requestsShowing', {
                    shown: visible.length,
                    total: this._requests.length,
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
    .request-list { list-style: none; min-width: 0; margin: 0; padding: 0; overflow-x: hidden; }
    .request-row {
      min-width: 0; padding: 6px 12px; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-sm);
    }
    .request-row:last-child { border-bottom: none; }
    .request-row:hover { background: var(--border-subtle); }
    .request-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .row-toggle, .row-content {
      flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px;
      border: 0; padding: 0; background: none; color: inherit; font: inherit; text-align: left;
      white-space: nowrap;
    }
    .row-toggle { cursor: pointer; }
    .row-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 2px; }
    .request-row time {
      color: var(--text-muted); font-family: var(--font-mono, 'SF Mono', monospace); flex-shrink: 0;
    }
    .destination {
      flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; color: var(--text);
    }
    .destination-port { color: var(--text-muted); }
    .route-badge {
      display: inline-flex; align-items: center; justify-content: center; padding: 1px 6px;
      border-radius: var(--radius-pill); font-size: var(--font-xs); font-weight: 600; flex-shrink: 0;
    }
    .route-badge.tunnel { color: var(--info); background: var(--info-bg); }
    .route-badge.direct { color: var(--green-text); background: var(--green-bg); }
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
      min-width: 0; margin-top: 2px; color: var(--text-muted); font-size: var(--font-xs);
      line-height: 1.4; overflow-wrap: anywhere;
    }
    .protocol, .traffic, .duration {
      color: var(--text-muted); font-family: var(--font-mono, 'SF Mono', monospace);
    }
    .meta-separator { color: var(--text-muted); }
    .request-error {
      display: block; min-width: 0; max-width: 100%; margin-top: 2px; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; color: var(--red-text);
    }
    .row-error {
      min-width: 0; margin-top: 5px; color: var(--red-text); font-size: var(--font-xs);
      line-height: 1.4; overflow-wrap: anywhere;
    }
    .path-heading { margin-top: 6px; color: var(--text-muted); font-size: var(--font-xs); font-weight: 600; }
    .request-path {
      min-width: 0; margin: 2px 0 0; padding: 0; list-style: none; color: var(--text-muted); font-size: var(--font-xs);
    }
    .request-path li {
      display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; min-width: 0; line-height: 1.5;
    }
    .request-path li > span { min-width: 0; overflow-wrap: anywhere; }
    .request-path .path-address { flex: 1 1 100%; }
    .request-path .request-error { color: var(--red-text); }
    .showing-count { padding: 8px 12px; border-top: 1px solid var(--border-subtle); color: var(--text-muted); font-size: var(--font-xs); }
    @media (pointer: coarse) {
      .back-btn, .auto-toggle, .refresh-button { min-height: 36px; }
    }
  `;
}
