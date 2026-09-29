import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { GoBackend } from '../api/backend';
import type { WisperEvent } from '../api/types';
import { t } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { formatRelativeTime, formatTimestamp } from '../utils/format';
import { getSettings } from '../store/settings-store';
import '../components/app-scaffold';

export type EventsKind = 'tunnel' | 'entrypoint' | 'global';

/**
 * The event history of one tunnel, one entrypoint, or the host.
 *
 * History is not in the stores: the per-second stats poll carries only stats
 * and status (see stats-store.ts's applyStats), so this page fetches the object
 * itself, and re-fetches on the stats interval while it is mounted — which is
 * what keeps a churning p2p session visible.
 *
 * @attr kind       — 'tunnel' | 'entrypoint' | 'global'.
 * @attr parentType — the object's tunnel type, for the back path.
 * @attr parentId   — the object's id.
 */
@customElement('events-page')
export class EventsPage extends LitElement {
  @property() kind: EventsKind = 'tunnel';
  @property() parentType = '';
  @property() parentId = '';

  @state() private _events: WisperEvent[] = [];
  @state() private _error = '';
  @state() private _confirmClear = false;

  private _backend = new GoBackend();
  private _timer: ReturnType<typeof setInterval> | null = null;

  connectedCallback() {
    super.connectedCallback();
    this._load();
    this._arm();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /** Schedule the next refresh, re-reading the interval each time: settings may
   *  not have loaded when the page mounted, and the user can change the interval
   *  while it is open. */
  private _arm() {
    const sec = getSettings().stats_interval || 3;
    this._timer = setTimeout(() => {
      this._load();
      this._arm();
    }, sec * 1000);
  }

  private async _load(): Promise<void> {
    try {
      if (this.kind === 'global') {
        this._events = (await this._backend.getEvents()).events ?? [];
      } else {
        const obj =
          this.kind === 'tunnel'
            ? await this._backend.getTunnel(this.parentId)
            : await this._backend.getEntrypoint(this.parentId);
        this._events = obj.events ?? [];
      }
      this._error = '';
    } catch (e) {
      this._error = e instanceof Error ? e.message : String(e);
    }
  }

  private async _clear(): Promise<void> {
    this._confirmClear = false;
    try {
      await this._backend.clearEvents();
      this._events = [];
    } catch (e) {
      this._error = e instanceof Error ? e.message : String(e);
    }
  }

  private get _title(): string {
    if (this.kind === 'global') return t('eventsGlobalTitle');
    if (this.kind === 'entrypoint') return t('eventsEntrypointTitle');
    return t('eventsTunnelTitle');
  }

  private get _backPath(): string {
    if (this.kind === 'global') return '/settings';
    return `/${this.kind}/${this.parentType}/${this.parentId}`;
  }

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  private _levelLabel(level: string): string {
    if (level === 'error') return t('eventsLevelError');
    if (level === 'warn') return t('eventsLevelWarn');
    return t('eventsLevelInfo');
  }

  /** A row's timestamp: the absolute local time first — a `title` tooltip is
   *  unreachable on a touch screen, and a relative age alone does not say when
   *  something happened — then the compact relative age. */
  private _timeLabel(e: WisperEvent): string {
    const abs = formatTimestamp(e.time);
    const rel = formatRelativeTime(e.time);
    if (!abs) return rel;
    return rel ? `${abs} · ${rel}` : abs;
  }

  static styles = css`
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }
    .page-title { font-size: var(--font-md); font-weight: 600; flex: 1; }
    .clear-btn {
      background: none; border: none; cursor: pointer; color: var(--accent);
      font-family: inherit; font-size: var(--font-sm); padding: 4px 8px;
      border-radius: var(--radius-sm);
    }
    .clear-btn:hover { background: var(--border-subtle); }
    .row {
      display: flex; align-items: baseline; gap: 10px; padding: 10px 16px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; margin-top: 5px; }
    .dot.info { background: var(--text-muted); }
    .dot.warn { background: #d29922; }
    .dot.error { background: #f85149; }
    .body { flex: 1; min-width: 0; }
    .message { font-size: var(--font-sm); color: var(--text); word-break: break-word; }
    .time { font-size: var(--font-xs); color: var(--text-muted); white-space: nowrap; }
    .empty {
      display: flex; align-items: center; justify-content: center;
      padding: 64px 24px; color: var(--text-muted); font-size: var(--font-md);
    }
    .confirm {
      display: flex; align-items: center; gap: 12px; padding: 12px 16px;
      background: var(--border-subtle); font-size: var(--font-sm);
    }
    .confirm button {
      font-family: inherit; font-size: var(--font-sm); padding: 4px 10px;
      border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);
      background: var(--surface); color: var(--text); cursor: pointer;
    }
  `;

  render() {
    return html`
      <app-scaffold>
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${() => this._navigate(this._backPath)}>
            ${icon('chevron-left')}
          </button>
          <span class="page-title">${this._title}</span>
          ${this.kind === 'global' && this._events.length
            ? html`<button class="clear-btn" @click=${() => (this._confirmClear = true)}>
                ${t('eventsClear')}
              </button>`
            : nothing}
        </div>

        ${this._error
          ? html`<div class="empty">${this._error}</div>`
          : this._events.length === 0
            ? html`<div class="empty">${t('eventsEmpty')}</div>`
            : html`${this._renderRows()}`}
      </app-scaffold>
    `;
  }

  private _renderRows() {
    return html`
      ${this._confirmClear
        ? html`<div class="confirm">
            <span>${t('eventsClearConfirm')}</span>
            <button @click=${() => this._clear()}>${t('eventsClear')}</button>
            <button @click=${() => (this._confirmClear = false)}>${t('btnCancel')}</button>
          </div>`
        : nothing}
      ${this._events.map(
        (e) => html`
          <div class="row">
            <span class="dot ${e.level}" title=${this._levelLabel(e.level)}></span>
            <div class="body">
              <div class="message">${e.message}</div>
              <div class="time">${this._timeLabel(e)}</div>
            </div>
          </div>
        `,
      )}
    `;
  }
}
