import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { InspectorRecord } from '../../api/types';
import { t } from '../../i18n/i18n';
import './body-viewer';

@customElement('record-detail')
export class RecordDetail extends LitElement {
  @property({ attribute: false }) record: InspectorRecord | null = null;

  static styles = css`
    :host { display: block; }
    .panel {
      background: var(--bg); border-radius: var(--radius-md);
      padding: 12px; margin-top: 8px;
    }
    .section { margin-bottom: 10px; }
    .section-title {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--text-muted); margin-bottom: 4px; font-weight: 600;
    }
    .meta-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px;
      font-size: var(--font-xs);
    }
    .meta-item { display: flex; justify-content: space-between; padding: 2px 0; }
    .meta-label { color: var(--text-muted); }
    .meta-value { font-family: var(--font-mono, 'SF Mono', monospace); }
    pre {
      font-family: var(--font-mono, 'SF Mono', monospace);
      font-size: var(--font-xs); background: #0d1117;
      border-radius: var(--radius-sm); padding: 8px; overflow-x: auto;
      white-space: pre-wrap; word-break: break-all; max-height: 200px;
      overflow-y: auto; margin: 0;
    }
  `;

  render() {
    const r = this.record;
    if (!r) return html``;

    return html`
      <div class="panel">
        <div class="section">
          <div class="section-title">Overview</div>
          <div class="meta-grid">
            <div class="meta-item"><span class="meta-label">Host</span><span class="meta-value">${r.host}</span></div>
            <div class="meta-item"><span class="meta-label">Remote</span><span class="meta-value">${r.remote}</span></div>
            <div class="meta-item"><span class="meta-label">Local</span><span class="meta-value">${r.local}</span></div>
            <div class="meta-item"><span class="meta-label">Client IP</span><span class="meta-value">${r.clientIP}</span></div>
            <div class="meta-item"><span class="meta-label">Service</span><span class="meta-value">${r.service}</span></div>
            <div class="meta-item"><span class="meta-label">Proto</span><span class="meta-value">${r.proto || '—'}</span></div>
            <div class="meta-item"><span class="meta-label">Bytes ↓</span><span class="meta-value">${r.inputBytes.toLocaleString()}</span></div>
            <div class="meta-item"><span class="meta-label">Bytes ↑</span><span class="meta-value">${r.outputBytes.toLocaleString()}</span></div>
            <div class="meta-item"><span class="meta-label">Duration</span><span class="meta-value">${(r.duration / 1e6).toFixed(1)}ms</span></div>
            <div class="meta-item"><span class="meta-label">Error</span><span class="meta-value">${r.err || '—'}</span></div>
          </div>
        </div>

        ${r.http ? html`
          <div class="section">
            <div class="section-title">${t('inspectorDetailHeaders')} — Request</div>
            <pre>${r.http.request.header}</pre>
          </div>
          <div class="section">
            <div class="section-title">${t('inspectorDetailHeaders')} — Response</div>
            <pre>${r.http.response.header}</pre>
          </div>
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

        ${r.tls ? html`
          <div class="section">
            <div class="section-title">TLS</div>
            <div class="meta-grid">
              <div class="meta-item"><span class="meta-label">SNI</span><span class="meta-value">${r.tls.serverName}</span></div>
              <div class="meta-item"><span class="meta-label">ALPN</span><span class="meta-value">${r.tls.proto}</span></div>
              <div class="meta-item"><span class="meta-label">Version</span><span class="meta-value">${r.tls.version}</span></div>
              <div class="meta-item"><span class="meta-label">Cipher</span><span class="meta-value">${r.tls.cipherSuite}</span></div>
            </div>
          </div>
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

        ${r.dns ? html`
          <div class="section">
            <div class="section-title">DNS</div>
            <div class="meta-grid">
              <div class="meta-item"><span class="meta-label">Name</span><span class="meta-value">${r.dns.name}</span></div>
              <div class="meta-item"><span class="meta-label">Type</span><span class="meta-value">${r.dns.type}</span></div>
              <div class="meta-item"><span class="meta-label">Class</span><span class="meta-value">${r.dns.class}</span></div>
              <div class="meta-item"><span class="meta-label">Cached</span><span class="meta-value">${r.dns.cached ? 'Yes' : 'No'}</span></div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }
}
