import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { InspectorRecord, ProtocolType } from '../../api/types';
import { t } from '../../i18n/i18n';
import './record-detail';
import '../spinner';

function methodClass(method: string): string {
  const m = method.toUpperCase();
  if (m === 'GET') return 'method-green';
  if (m === 'POST' || m === 'PUT' || m === 'PATCH') return 'method-blue';
  if (m === 'CONNECT') return 'method-yellow';
  if (m === 'DELETE') return 'method-red';
  return 'method-default';
}

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return 'var(--green)';
  if (code >= 400) return 'var(--red)';
  return 'var(--text-muted)';
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
      padding: 10px 12px; cursor: pointer; display: flex; align-items: center;
      gap: 10px; font-size: var(--font-xs); transition: background 0.1s;
    }
    .row:hover { background: #30363d; }
    .row.selected { border-left: 2px solid var(--accent); }
    .method-badge {
      padding: 2px 6px; border-radius: 4px; font-weight: 600;
      font-size: 10px; font-family: var(--font-mono, 'SF Mono', monospace);
      min-width: 38px; text-align: center;
    }
    .method-green { background: rgba(63,185,80,0.2); color: var(--green); }
    .method-blue { background: rgba(88,166,255,0.2); color: var(--accent); }
    .method-yellow { background: rgba(210,153,29,0.2); color: #d2991d; }
    .method-red { background: rgba(248,81,73,0.2); color: var(--red); }
    .method-default { background: rgba(139,148,158,0.15); color: var(--text-muted); }
    .details { flex: 1; min-width: 0; }
    .host { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { font-size: 10px; color: var(--text-muted); margin-top: 1px; display: flex; gap: 8px; }
    .right { text-align: right; font-size: 10px; color: var(--text-muted); }
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
    const httpHost = r.http?.host || r.host;
    const httpMethod = r.http?.method || '';
    const httpUri = r.http?.uri || '';
    const httpStatus = r.http?.statusCode || 0;
    const wsOpcode = r.websocket?.opcode;

    return html`
      <div class="row ${this.selectedIndex === i ? 'selected' : ''}"
        @click=${() => this.dispatchEvent(new CustomEvent('record-select', { detail: i, bubbles: true, composed: true }))}>
        ${httpMethod ? html`
          <span class="method-badge ${methodClass(httpMethod)}">${httpMethod}</span>
        ` : wsOpcode !== undefined ? html`
          <span class="method-badge method-default">WS</span>
        ` : html`
          <span class="method-badge method-default">—</span>
        `}
        <div class="details">
          <div class="host">${httpHost || r.service}</div>
          <div class="meta">
            <span>${httpUri || r.dst || r.network}</span>
            <span>${r.proto || ''}</span>
          </div>
        </div>
        ${httpStatus ? html`
          <span style="color:${statusColor(httpStatus)};font-weight:600;font-size:var(--font-xs)">${httpStatus}</span>
        ` : ''}
        <div class="right">
          <div>↓${(r.inputBytes / 1024).toFixed(1)}K</div>
          <div>↑${(r.outputBytes / 1024).toFixed(1)}K</div>
        </div>
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
