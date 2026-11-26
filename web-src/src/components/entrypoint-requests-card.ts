import { LitElement, html, css, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { GoBackend } from '../api/backend';
import type { Entrypoint, EntrypointRequest } from '../api/types';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { formatBytes, formatClockTime, formatDuration } from '../utils/format';
import { updateEntrypointRules } from '../store/entrypoint-store';

const POLL_MS = 2000;
const MAX_RENDERED = 200;

@customElement('entrypoint-requests-card')
export class EntrypointRequestsCard extends LitElement {
  @property({ attribute: false }) entrypoint: Entrypoint | null = null;

  @state() private _requests: EntrypointRequest[] = [];
  @state() private _error = '';
  @state() private _open = true;
  @state() private _auto = true;
  @state() private _loading = false;
  @state() private _pageHidden = document.visibilityState === 'hidden';
  @state() private _savingKey = '';
  @state() private _rowErrors = new Map<string, string>();

  private _backend = new GoBackend();
  private _poll = 0;
  private _connected = false;
  private _activeEntrypointId = '';
  private _entrypointVersion = 0;
  private _loadToken = 0;

  private _onVisibilityChange = () => {
    this._pageHidden = document.visibilityState === 'hidden';
    this._configurePolling();
    if (!this._pageHidden && this._open && this._auto) void this._load(true);
  };

  connectedCallback() {
    super.connectedCallback();
    this._connected = true;
    this._activeEntrypointId = this.entrypoint?.id ?? '';
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    this._configurePolling();
    void this._load();
  }

  disconnectedCallback() {
    this._connected = false;
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    window.clearInterval(this._poll);
    this._poll = 0;
    super.disconnectedCallback();
  }

  protected updated(changed: PropertyValues) {
    if (!changed.has('entrypoint') || !this._connected) return;
    const id = this.entrypoint?.id ?? '';
    if (id === this._activeEntrypointId) return;

    this._activeEntrypointId = id;
    this._entrypointVersion += 1;
    this._loadToken += 1;
    this._requests = [];
    this._error = '';
    this._loading = false;
    this._savingKey = '';
    this._rowErrors = new Map();
    this._configurePolling();
    void this._load();
  }

  private _configurePolling() {
    window.clearInterval(this._poll);
    this._poll = 0;
    if (!this._connected || !this._open || !this._auto || this._pageHidden) return;
    this._poll = window.setInterval(() => void this._load(), POLL_MS);
  }

  private async _load(force = false) {
    const id = this.entrypoint?.id;
    if (!id || !this._connected || (this._loading && !force)) return;

    const version = this._entrypointVersion;
    const token = ++this._loadToken;
    this._loading = true;
    try {
      const body = await this._backend.getEntrypointRequests(id, 500);
      if (!this._connected || version !== this._entrypointVersion || token !== this._loadToken) return;
      this._requests = body.requests ?? [];
      this._error = '';
    } catch (e: unknown) {
      if (!this._connected || version !== this._entrypointVersion || token !== this._loadToken) return;
      const message = e instanceof Error ? e.message : '';
      this._error = `${t('requestsError')}${message ? `: ${message}` : ''}`;
    } finally {
      if (version === this._entrypointVersion && token === this._loadToken) {
        this._loading = false;
      }
    }
  }

  private _toggleOpen() {
    this._open = !this._open;
    this._configurePolling();
    if (this._open) void this._load(true);
  }

  private _toggleAuto() {
    this._auto = !this._auto;
    this._configurePolling();
    if (this._auto && this._open && !this._pageHidden) void this._load(true);
  }

  private _destination(request: EntrypointRequest): { key: string; name: string; port: string } {
    const dst = request.dst.trim();
    let address = dst;
    let port = '';

    if (dst.startsWith('[')) {
      const end = dst.indexOf(']');
      if (end > 0) {
        address = dst.slice(1, end);
        const suffix = dst.slice(end + 1);
        if (/^:\d+$/.test(suffix)) port = suffix.slice(1);
      }
    } else {
      const match = dst.match(/^(.*):(\d+)$/);
      if (match && !match[1].includes(':')) {
        address = match[1];
        port = match[2];
      }
    }

    const host = request.host.trim();
    return { key: host || address, name: host || address, port };
  }

  private _setRowError(key: string, message: string) {
    const next = new Map(this._rowErrors);
    if (message) next.set(key, message);
    else next.delete(key);
    this._rowErrors = next;
  }

  private async _toggleRule(request: EntrypointRequest) {
    const id = this.entrypoint?.id;
    const { key } = this._destination(request);
    if (!id || !key || this._savingKey) return;

    const rules = this.entrypoint?.options?.rules ?? [];
    const listed = rules.includes(key);
    const next = listed ? rules.filter(rule => rule !== key) : [...rules, key];
    const version = this._entrypointVersion;
    this._savingKey = key;
    this._setRowError(key, '');
    try {
      await updateEntrypointRules(id, next);
      if (!this._connected || version !== this._entrypointVersion) return;
      await this._load(true);
    } catch (e: unknown) {
      if (!this._connected || version !== this._entrypointVersion) return;
      const message = e instanceof Error ? e.message : '';
      this._setRowError(key, `${t('requestsRuleError')}${message ? `: ${message}` : ''}`);
    } finally {
      if (this._connected && version === this._entrypointVersion) this._savingKey = '';
    }
  }

  private _renderRequest(request: EntrypointRequest) {
    const destination = this._destination(request);
    const rules = this.entrypoint?.options?.rules ?? [];
    const listed = rules.includes(destination.key);
    const protocol = [request.network, request.proto].filter(Boolean).join('/');
    const rowError = this._rowErrors.get(destination.key);

    return html`
      <li class="request-row">
        <div class="request-primary">
          <div class="request-field request-time">
            <span class="field-label">${t('requestsTime')}</span>
            <time datetime=${request.time}>${formatClockTime(Date.parse(request.time))}</time>
          </div>
          <div class="request-field request-destination">
            <span class="field-label">${t('requestsDestination')}</span>
            <span class="destination-text" title=${destination.name}>
              ${destination.name}${destination.port ? html`<span class="destination-port">:${destination.port}</span>` : nothing}
            </span>
          </div>
          <span class="route-badge ${request.tunneled ? 'tunnel' : 'direct'}">
            ${request.tunneled ? t('requestsTunnel') : t('requestsDirect')}
          </span>
          ${destination.key
            ? html`
              <button type="button" class="rule-action"
                aria-label=${listed
                  ? t('requestsRemoveRuleFor', { destination: destination.key })
                  : t('requestsAddRuleFor', { destination: destination.key })}
                ?disabled=${this._savingKey !== ''}
                @click=${() => this._toggleRule(request)}>
                ${listed ? t('requestsRemoveRule') : t('requestsAddRule')}
              </button>`
            : nothing}
        </div>
        <div class="request-meta">
          <span class="request-field">
            <span class="field-label">${t('requestsProtocol')}</span>
            <span>${protocol}</span>
          </span>
          <span class="request-field">
            <span class="field-label">${t('requestsTraffic')}</span>
            <span>${t('requestsTrafficValue', {
              in: formatBytes(request.input_bytes),
              out: formatBytes(request.output_bytes),
            })}</span>
          </span>
          <span class="request-field">
            <span class="field-label">${t('requestsDuration')}</span>
            <span>${formatDuration(request.duration_ms * 1_000_000)}</span>
          </span>
          ${request.err
            ? html`<span class="request-field request-error">
                <span class="field-label">${t('requestsFlowError')}</span>
                <span>${request.err}</span>
              </span>`
            : nothing}
        </div>
        ${rowError ? html`<div class="row-error" role="alert">${rowError}</div>` : nothing}
      </li>
    `;
  }

  render() {
    const visible = this._requests.slice(0, MAX_RENDERED);
    const paused = this._pageHidden
      ? t('requestsPausedHidden')
      : !this._open
        ? t('requestsPausedCollapsed')
        : '';

    return html`
      <div class="card">
        <header class="card-header">
          <div class="header-main">
            <div class="title-group">
              <h2 id="requests-title">${t('requestsTitle')}</h2>
              <span class="requests-count">${t(
                this._requests.length === 1 ? 'requestsCountOne' : 'requestsCount',
                { n: this._requests.length },
              )}</span>
            </div>
            <div class="controls">
              <button type="button" class="auto-toggle" aria-pressed=${this._auto}
                @click=${this._toggleAuto}>
                <span class="toggle-track" aria-hidden="true"><span class="toggle-knob"></span></span>
                <span>${t('requestsAuto')}</span>
              </button>
              <button type="button" class="refresh-button" ?disabled=${this._loading}
                @click=${() => this._load(true)}>
                ${icon('rotate-cw')}<span>${t('requestsRefresh')}</span>
              </button>
              <button type="button" class="collapse-button"
                aria-label=${this._open ? t('requestsCollapse') : t('requestsExpand')}
                aria-expanded=${this._open}
                @click=${this._toggleOpen}>
                ${icon(this._open ? 'chevron-up' : 'chevron-down')}
              </button>
            </div>
          </div>
          ${paused ? html`<div class="pause-indicator" role="status">${paused}</div>` : nothing}
        </header>
        ${this._open
          ? html`
            <div class="requests-body">
              ${this._error ? html`<div class="requests-error" role="alert">${this._error}</div>` : nothing}
              ${this._requests.length === 0
                ? html`<div class="requests-empty">${t('requestsEmpty')}</div>`
                : html`
                  <ol class="request-list" role="list" aria-label=${t('requestsTitle')}>
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
          `
          : nothing}
      </div>
    `;
  }

  static styles = css`
    :host { display: block; margin-top: 16px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      overflow: hidden;
      container-type: inline-size;
    }
    .card-header { padding: 12px 14px; background: var(--surface); }
    .header-main { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .title-group { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    h2 { margin: 0; font-size: var(--font-md); font-weight: 600; color: var(--text); }
    .requests-count { font-size: var(--font-sm); color: var(--text-muted); white-space: nowrap; }
    .controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    button { font-family: inherit; cursor: pointer; }
    button:disabled { cursor: default; opacity: 0.55; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .auto-toggle, .refresh-button, .collapse-button {
      min-height: 28px; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
      background: var(--surface); color: var(--text-secondary); font-size: var(--font-sm);
    }
    .auto-toggle { padding: 4px 8px; }
    .refresh-button { padding: 4px 8px; }
    .refresh-button svg { width: 13px; height: 13px; }
    .collapse-button { width: 28px; padding: 3px; }
    .collapse-button svg { width: 15px; height: 15px; }
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
    .pause-indicator { margin-top: 8px; font-size: var(--font-xs); color: var(--amber); }
    .requests-body { border-top: 1px solid var(--border-subtle); }
    .requests-error {
      padding: 8px 14px; color: var(--red-text); background: var(--red-bg);
      font-size: var(--font-sm); line-height: 1.4;
    }
    .requests-empty { padding: 18px 14px; color: var(--text-muted); font-size: var(--font-sm); }
    .request-list { list-style: none; margin: 0; padding: 0; }
    .request-row { padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); }
    .request-row:last-child { border-bottom: none; }
    .request-primary {
      display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto;
      align-items: center; gap: 8px 12px;
    }
    .request-field { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: var(--font-sm); }
    .field-label { color: var(--text-muted); font-size: var(--font-xs); line-height: 1.2; }
    .request-time { font-variant-numeric: tabular-nums; color: var(--text-secondary); }
    .request-destination { color: var(--text); }
    .destination-text { overflow-wrap: anywhere; }
    .destination-port { color: var(--text-muted); }
    .route-badge {
      display: inline-flex; align-items: center; justify-content: center; padding: 2px 8px;
      border-radius: var(--radius-pill); font-size: var(--font-xs); font-weight: 600; white-space: nowrap;
    }
    .route-badge.tunnel { color: var(--info); background: var(--info-bg); }
    .route-badge.direct { color: var(--green-text); background: var(--green-bg); }
    .rule-action {
      min-height: 28px; padding: 4px 8px; border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm); background: var(--surface); color: var(--accent);
      font-size: var(--font-xs); font-weight: 600; white-space: nowrap;
    }
    .request-meta { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 8px; }
    .request-meta .request-field { flex-direction: row; align-items: baseline; gap: 5px; }
    .request-error { color: var(--red-text); overflow-wrap: anywhere; }
    .row-error { margin-top: 6px; color: var(--red-text); font-size: var(--font-xs); line-height: 1.4; }
    .showing-count { padding: 8px 14px; color: var(--text-muted); font-size: var(--font-xs); }
    @container (max-width: 560px) {
      .header-main { align-items: flex-start; }
      .controls { width: 100%; }
      .request-primary { grid-template-columns: auto minmax(0, 1fr) auto; }
      .rule-action { grid-column: 1 / -1; justify-self: start; }
      .request-meta { flex-direction: column; gap: 6px; }
    }
    @media (pointer: coarse) {
      .auto-toggle, .refresh-button, .collapse-button, .rule-action { min-height: 32px; }
      .collapse-button { width: 32px; }
    }
  `;
}
