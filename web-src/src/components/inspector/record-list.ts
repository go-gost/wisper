import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { InspectorRecord, ProtocolType } from '../../api/types';
import { t } from '../../i18n/i18n';
import { formatBytes, formatTimestamp, formatDuration } from '../../utils/format';
import './record-detail';
import '../spinner';

/** Color class for an HTTP method badge. */
function methodClass(method: string): string {
  const m = method.toUpperCase();
  if (m === 'GET') return 'method-green';
  if (m === 'POST' || m === 'PUT' || m === 'PATCH') return 'method-blue';
  if (m === 'CONNECT') return 'method-yellow';
  if (m === 'DELETE') return 'method-red';
  return 'method-default';
}

/** Color class for an HTTP status code (green <300, amber <400, red otherwise). */
function statusClass(code: number): string {
  if (code > 0 && code < 300) return 'status-green';
  if (code >= 300 && code < 400) return 'status-yellow';
  if (code >= 400) return 'status-red';
  return 'status-muted';
}

interface OpcodeInfo { label: string; cls: string; }

/** Human-readable label + color for a WebSocket opcode (matches inspector). */
function opcodeInfo(op: number | undefined): OpcodeInfo | null {
  if (op == null) return null;
  switch (op) {
    case 1: return { label: 'TEXT', cls: 'op-text' };
    case 2: return { label: 'BINARY', cls: 'op-binary' };
    case 8: return { label: 'CLOSE', cls: 'op-close' };
    case 9: return { label: 'PING', cls: 'op-default' };
    case 10: return { label: 'PONG', cls: 'op-default' };
    default: return { label: `#${op}`, cls: 'op-default' };
  }
}

@customElement('record-list')
export class RecordList extends LitElement {
  @property({ attribute: false }) records: InspectorRecord[] = [];
  @property() protocol: ProtocolType = 'http';
  @property({ type: Number }) selectedIndex = -1;
  @property({ type: Boolean }) hasMore = false;
  @property({ type: Boolean }) loading = false;

  private _observer: IntersectionObserver | null = null;

  static styles = css`
    :host { display: block; }
    .list { display: flex; flex-direction: column; gap: 4px; }
    .row {
      background: var(--border-subtle); border-radius: var(--radius-sm);
      padding: 8px 12px; cursor: pointer; display: flex; flex-direction: column;
      gap: 2px; transition: background 0.1s;
    }
    .row:hover { background: #30363d; }
    .row.selected { border-left: 2px solid var(--accent); }
    .line { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--font-sm); }
    .host {
      font-weight: 500; flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .uri {
      font-family: var(--font-mono, 'SF Mono', monospace); color: var(--text-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
    }
    .muted { color: var(--text-muted); flex-shrink: 0; }
    .time {
      margin-left: auto; font-family: var(--font-mono, 'SF Mono', monospace);
      color: var(--text-muted); white-space: nowrap; flex-shrink: 0;
    }
    .status { font-weight: 700; flex-shrink: 0; min-width: 28px; }
    .status-green { color: var(--green); }
    .status-yellow { color: #d2991d; }
    .status-red { color: var(--red); }
    .status-muted { color: var(--text-muted); }
    .method-badge {
      padding: 1px 6px; border-radius: 4px; font-weight: 600;
      font-family: var(--font-mono, 'SF Mono', monospace); flex-shrink: 0;
    }
    .method-green { background: rgba(63,185,80,0.2); color: var(--green); }
    .method-blue { background: rgba(88,166,255,0.2); color: var(--accent); }
    .method-yellow { background: rgba(210,153,29,0.2); color: #d2991d; }
    .method-red { background: rgba(248,81,73,0.2); color: var(--red); }
    .method-default { background: rgba(139,148,158,0.15); color: var(--text-muted); }
    .dir { font-weight: 700; flex-shrink: 0; }
    .dir-in { color: var(--green); }
    .dir-out { color: #d2991d; }
    .opcode { padding: 1px 6px; border-radius: 4px; flex-shrink: 0; }
    .op-text { background: rgba(63,185,80,0.2); color: var(--green); }
    .op-binary { background: rgba(188,140,255,0.2); color: #bc8cff; }
    .op-close { background: rgba(210,153,29,0.2); color: #d2991d; }
    .op-default { background: rgba(139,148,158,0.15); color: var(--text-muted); }
    .sentinel { height: 1px; }
    .empty { text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: var(--font-sm); }
    .loading { display: flex; justify-content: center; padding: 24px; }
  `;

  updated() {
    if (this._observer) this._observer.disconnect();
    this._observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && this.hasMore) {
        this.dispatchEvent(new CustomEvent('load-more', { bubbles: true, composed: true }));
      }
    });
    const sentinel = this.shadowRoot?.querySelector('.sentinel');
    if (sentinel) this._observer.observe(sentinel);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._observer?.disconnect();
  }

  private _renderRow(r: InspectorRecord, i: number) {
    const host = r.http?.host || r.host || r.service;
    const uri = r.http?.uri || '';
    const time = r.time ? formatTimestamp(r.time) : '';
    const proto = r.http?.proto || r.proto || '';
    const bytes = html`<span class="muted">↓${formatBytes(r.inputBytes)} ↑${formatBytes(r.outputBytes)}</span>`;
    const duration = formatDuration(r.duration);

    let body;
    if (r.http) {
      const method = r.http.method || '';
      const status = r.http.statusCode || 0;
      body = html`
        <div class="line">
          <span class="status ${statusClass(status)}">${status || '—'}</span>
          ${method ? html`<span class="method-badge ${methodClass(method)}">${method}</span>` : ''}
          <span class="host">${host}</span>
          <span class="muted">${duration}</span>
        </div>
        ${uri ? html`<div class="uri">${uri}</div>` : ''}
        <div class="line">
          ${bytes}
          ${proto ? html`<span class="muted">${proto}</span>` : ''}
          ${time ? html`<span class="time">${time}</span>` : ''}
        </div>
      `;
    } else if (r.websocket) {
      const from = r.websocket.from;
      const op = opcodeInfo(r.websocket.opcode);
      body = html`
        <div class="line">
          <span class="dir ${from === 'client' ? 'dir-in' : 'dir-out'}">${from === 'client' ? '→' : '←'}</span>
          <span class="host">${host}</span>
          ${op ? html`<span class="opcode ${op.cls}">${op.label}</span>` : ''}
        </div>
        ${uri ? html`<div class="uri">${uri}</div>` : ''}
        <div class="line">
          <span class="muted">${formatBytes(r.websocket.length ?? 0)}</span>
          ${time ? html`<span class="time">${time}</span>` : ''}
        </div>
      `;
    } else {
      // Generic record (no http/websocket payload) — show identity + stats.
      const fallbackUri = uri || r.dst || r.network;
      body = html`
        <div class="line">
          <span class="host">${host}</span>
          <span class="muted">${duration}</span>
        </div>
        ${fallbackUri ? html`<div class="uri">${fallbackUri}</div>` : ''}
        <div class="line">
          ${bytes}
          ${proto ? html`<span class="muted">${proto}</span>` : ''}
          ${time ? html`<span class="time">${time}</span>` : ''}
        </div>
      `;
    }

    return html`
      <div class="row ${this.selectedIndex === i ? 'selected' : ''}"
        @click=${() => this.dispatchEvent(new CustomEvent('record-select', { detail: i, bubbles: true, composed: true }))}>
        ${body}
      </div>
      ${this.selectedIndex === i ? html`<record-detail .record=${r}></record-detail>` : ''}
    `;
  }

  render() {
    if (this.records.length === 0) {
      if (this.loading) {
        return html`<div class="loading"><wisper-spinner></wisper-spinner></div>`;
      }
      return html`<div class="empty">${t('inspectorNoRecords')}</div>`;
    }
    return html`
      <div class="list">
        ${this.records.map((r, i) => this._renderRow(r, i))}
        <div class="sentinel"></div>
      </div>
    `;
  }
}
