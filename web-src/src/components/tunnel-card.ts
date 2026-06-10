import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formatBytes, formatRate, formatNumber } from '../utils/format';
import { t } from '../i18n/i18n';
import type { ServiceStats, ServiceStatus } from '../api/types';

/**
 * TunnelCard — displays a tunnel or entrypoint summary card in lists.
 * Matches prototype design with two-column layout:
 *   left: name, meta (TYPE · status), endpoint
 *   right: stats rows
 *   status dot: absolutely positioned at top-right
 *
 * @attr name - Display name
 * @attr type - Tunnel/entrypoint type label (e.g. "HTTP", "TCP")
 * @attr endpoint - Local endpoint address
 * @attr status - Current service status (running/stopped/error)
 * @attr error - Error message if status === error
 * @attr stats - ServiceStats object with live metrics
 */
@customElement('tunnel-card')
export class TunnelCard extends LitElement {
  @property() name = '';
  @property() type = '';
  @property() endpoint = '';
  @property() status: ServiceStatus = 'stopped';
  @property() stats: ServiceStats | null = null;
  @property() error = '';

  static styles = css`
    :host {
      display: block;
    }

    .card {
      position: relative;
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-card);
      padding: 20px 24px;
      margin: 0 16px 16px;
      cursor: pointer;
      transition: background var(--transition-fast), box-shadow var(--transition-fast), transform 0.1s;
    }

    .card:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-card-hover);
    }

    .card:active {
      transform: translateY(0);
    }

    /* ── Two-column body ── */
    .tunnel-card-body {
      display: flex;
      gap: 24px;
      align-items: flex-start;
    }

    .tunnel-card-left {
      flex: 1;
      min-width: 0;
    }

    .tunnel-card-right {
      flex-shrink: 0;
      text-align: right;
      padding-top: 20px;
      --stats-justify: flex-end;
    }

    /* ── Header ── */
    .tunnel-card-header {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
    }

    .tunnel-name {
      font-weight: 600;
      font-size: 1.1rem;
    }

    /* ── Status dot — absolute top-right ── */
    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      position: absolute;
      top: 20px;
      right: 24px;
    }

    .status-dot.running {
      background: var(--color-running);
    }

    .status-dot.stopped {
      background: var(--color-stopped);
    }

    .status-dot.error {
      background: var(--color-error);
    }

    /* ── Meta ── */
    .tunnel-meta {
      color: var(--color-stopped);
      font-size: 0.9rem;
      margin-bottom: 4px;
    }

    .tunnel-endpoint {
      font-size: 0.95rem;
      color: var(--color-text-primary);
      opacity: 0.8;
    }

    /* ── Error banner ── */
    .error-banner {
      margin-top: 12px;
      padding: 8px 12px;
      background: var(--color-error-bg);
      border-radius: var(--radius-sm);
      font-size: 0.8rem;
      color: var(--color-error);
    }

    /* ── Responsive ── */
    @media (max-width: 600px) {
      .tunnel-card-body {
        flex-direction: column;
        gap: 12px;
      }

      .tunnel-card-right {
        text-align: left;
        padding-top: 0;
        --stats-justify: flex-start;
      }
    }
  `;

  private _statusLabel(s: ServiceStatus): string {
    switch (s) {
      case 'running': return t('statusRunning');
      case 'stopped': return t('statusStopped');
      case 'error': return t('statusError');
    }
  }

  render() {
    const s = this.stats;

    return html`
      <div class="card">
        <span class="status-dot ${this.status}"></span>

        <div class="tunnel-card-body">
          <!-- Left: info -->
          <div class="tunnel-card-left">
            <div class="tunnel-card-header">
              <span class="tunnel-name">${this.name}</span>
            </div>
            <div class="tunnel-meta">${this.type} · ${this._statusLabel(this.status)}</div>
            <div class="tunnel-endpoint">${this.endpoint}</div>
          </div>

          <!-- Right: stats -->
          ${s ? html`
            <div class="tunnel-card-right">
              <stats-row icon="↕" .value=${`${formatNumber(s.current_conns)} / ${formatNumber(s.total_conns)}`} .rate=${formatRate(s.request_rate)}></stats-row>
              <stats-row icon="↑" .value=${formatBytes(s.input_bytes)} .rate=${formatRate(s.input_rate_bytes)}></stats-row>
              <stats-row icon="↓" .value=${formatBytes(s.output_bytes)} .rate=${formatRate(s.output_rate_bytes)}></stats-row>
            </div>
          ` : ''}
        </div>

        ${this.error ? html`<div class="error-banner">${this.error}</div>` : ''}
      </div>
    `;
  }
}
