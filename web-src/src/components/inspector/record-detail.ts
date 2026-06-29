import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { InspectorRecord } from '../../api/types';
import { InspectorApiClient } from '../../api/inspector';
import { t } from '../../i18n/i18n';
import { formatHeaders } from '../../utils/format';
import './body-viewer';
import '../spinner';

@customElement('record-detail')
export class RecordDetail extends LitElement {
  @property({ attribute: false }) record: InspectorRecord | null = null;
  @property({ attribute: false }) client: InspectorApiClient | null = null;

  @state() private _fullRecord: InspectorRecord | null = null;
  @state() private _loadingDetail = false;
  /** Track which record ID we already fetched (or tried to) — avoids repeats. */
  private _fetchedId = '';

  static styles = css`
    :host { display: block; }
    .panel {
      background: var(--bg); border-radius: var(--radius-md);
      padding: 12px; margin-top: 8px;
    }
    .section { margin-bottom: 10px; }
    .section-title {
      font-size: var(--font-sm); text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--text-muted); margin-bottom: 4px; font-weight: 600;
    }
    .meta-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px;
      font-size: var(--font-sm);
    }
    .meta-item { display: flex; justify-content: space-between; padding: 2px 0; min-width: 0; }
    .meta-label { color: var(--text-muted); flex-shrink: 0; margin-right: 8px; }
    .meta-value { font-family: var(--font-mono, 'SF Mono', monospace); min-width: 0; word-break: break-word; text-align: right; }
    .uri-item { grid-column: 1 / -1; justify-content: flex-start; gap: 8px; }
    .uri-item .meta-label { flex-shrink: 0; }
    .uri-text { word-break: break-all; min-width: 0; flex: 1; }
    pre {
      font-family: var(--font-mono, 'SF Mono', monospace);
      font-size: var(--font-sm); background: #0d1117;
      border-radius: var(--radius-sm); padding: 8px; overflow-x: auto;
      white-space: pre-wrap; word-break: break-all; max-height: 200px;
      overflow-y: auto; margin: 0;
    }
    .loading-detail {
      display: flex; align-items: center; gap: 6px;
      color: var(--text-muted); font-size: var(--font-sm); padding: 8px 0;
    }
  `;

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('record')) {
      const r = this.record;
      // When record switches, clear the cached full record unless the new
      // record matches the one we fetched.
      if (r?.id !== this._fetchedId) {
        this._fullRecord = null;
        this._fetchedId = '';
      }
      // Auto-fetch detail when the list response is "thin" (body/headers
      // excluded by the server's projection).
      if (r && this.client) {
        this._maybeFetchDetail(r);
      }
    }
    if (changed.has('client')) {
      const r = this.record;
      if (r && this.client) {
        this._maybeFetchDetail(r);
      }
    }
  }

  private _needsDetail(r: InspectorRecord): boolean {
    if (!r.id) return false;
    if (r.http) {
      return r.http.request.body == null || r.http.request.header == null;
    }
    if (r.websocket) {
      return r.websocket.payload == null;
    }
    return false;
  }

  private async _maybeFetchDetail(r: InspectorRecord) {
    if (!this._needsDetail(r)) return;
    if (r.id === this._fetchedId) return;

    const fetchId = r.id!;
    this._fetchedId = fetchId;
    this._loadingDetail = true;
    try {
      const full = await this.client!.getRecord(fetchId);
      // Guard against the user switching records mid-fetch.
      if (this._fetchedId === fetchId) {
        this._fullRecord = full;
      }
    } catch (e) {
      console.warn('[inspector] fetch detail failed:', e);
    }
    if (this._fetchedId === fetchId) {
      this._loadingDetail = false;
    }
  }

  render() {
    const r = this._fullRecord || this.record;
    if (!r) return html``;

    return html`
      <div class="panel">
        ${this._loadingDetail ? html`
          <div class="loading-detail"><wisper-spinner></wisper-spinner> Loading details...</div>
        ` : ''}

        <div class="section">
          <div class="section-title">Overview</div>
          <div class="meta-grid">
            <div class="meta-item"><span class="meta-label">Host</span><span class="meta-value">${r.host}</span></div>
            <div class="meta-item"><span class="meta-label">Remote</span><span class="meta-value">${r.remote}</span></div>
            <div class="meta-item"><span class="meta-label">Local</span><span class="meta-value">${r.local}</span></div>
            <div class="meta-item"><span class="meta-label">Client IP</span><span class="meta-value">${r.clientIP}</span></div>
            <div class="meta-item"><span class="meta-label">Service</span><span class="meta-value">${r.service}</span></div>
            <div class="meta-item"><span class="meta-label">Proto</span><span class="meta-value">${r.http?.proto || r.proto || '—'}</span></div>
            <div class="meta-item"><span class="meta-label">Bytes ↓</span><span class="meta-value">${r.inputBytes.toLocaleString()}</span></div>
            <div class="meta-item"><span class="meta-label">Bytes ↑</span><span class="meta-value">${r.outputBytes.toLocaleString()}</span></div>
            <div class="meta-item"><span class="meta-label">Duration</span><span class="meta-value">${(r.duration / 1e6).toFixed(1)}ms</span></div>
            <div class="meta-item"><span class="meta-label">Error</span><span class="meta-value">${r.err || '—'}</span></div>
          </div>
        </div>

        ${r.http ? html`
          <div class="section">
            <div class="section-title">Request</div>
            <div class="meta-grid">
              <div class="meta-item"><span class="meta-label">Method</span><span class="meta-value">${r.http.method || '—'}</span></div>
              <div class="meta-item"><span class="meta-label">Host</span><span class="meta-value">${r.http.host || '—'}</span></div>
              <div class="meta-item uri-item"><span class="meta-label">URI</span><span class="meta-value uri-text">${r.http.uri || '—'}</span></div>
            </div>
          </div>
          ${r.http.request.header ? html`
            <div class="section">
              <div class="section-title">${t('inspectorDetailHeaders')} — Request</div>
              <pre>${formatHeaders(r.http.request.header)}</pre>
            </div>
          ` : ''}
          ${r.http.response.header ? html`
            <div class="section">
              <div class="section-title">${t('inspectorDetailHeaders')} — Response</div>
              <pre>${formatHeaders(r.http.response.header)}</pre>
            </div>
          ` : ''}
          ${r.http.request.body ? html`
            <div class="section">
              <div class="section-title">${t('inspectorDetailBody')} — Request</div>
              <body-viewer .body=${r.http.request.body}></body-viewer>
            </div>
          ` : ''}
          ${r.http.response.body ? html`
            <div class="section">
              <div class="section-title">${t('inspectorDetailBody')} — Response</div>
              <body-viewer .body=${r.http.response.body}></body-viewer>
            </div>
          ` : ''}
        ` : ''}

        ${r.websocket ? html`
          <div class="section">
            <div class="section-title">WebSocket</div>
            <div class="meta-grid">
              <div class="meta-item"><span class="meta-label">From</span><span class="meta-value">${r.websocket.from}</span></div>
              <div class="meta-item"><span class="meta-label">OpCode</span><span class="meta-value">${r.websocket.opcode}</span></div>
              <div class="meta-item"><span class="meta-label">Length</span><span class="meta-value">${r.websocket.length}</span></div>
            </div>
            ${r.websocket.payload ? html`
              <div class="section-title" style="margin-top:8px;">Payload</div>
              <body-viewer .body=${r.websocket.payload}></body-viewer>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }
}
