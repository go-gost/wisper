import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formatBytes, formatRate, formatNumber } from '../utils/format';
import { t } from '../i18n/i18n';
import type { ServiceStats, ServiceStatus } from '../api/types';

/**
 * TunnelCard — displays a tunnel or entrypoint summary card in lists.
 * Used on the home page for both tunnels and entrypoints.
 *
 * @attr name - Display name
 * @attr type - Tunnel/entrypoint type label (e.g. "HTTP", "TCP")
 * @attr endpoint - Local endpoint address
 * @attr entrypoint - Public URL
 * @attr status - Current service status (running/stopped/error)
 * @attr error - Error message if status === error
 * @attr stats - ServiceStats object with live metrics
 */
@customElement('tunnel-card')
export class TunnelCard extends LitElement {
  @property() name = '';
  @property() type = '';
  @property() endpoint = '';
  @property() entrypoint = '';
  @property() status: ServiceStatus = 'stopped';
  @property() stats: ServiceStats | null = null;
  @property() error = '';

  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 16px;
      cursor: pointer;
      transition: all var(--transition-fast);
      box-shadow: var(--shadow-card);
    }

    .card:hover {
      box-shadow: var(--shadow-card-hover);
    }

    .card:active {
      transform: scale(0.99);
    }

    .top-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .name {
      font-weight: 600;
      font-size: 15px;
      color: var(--color-text-primary);
    }

    .status-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot.running {
      background: var(--color-running);
      box-shadow: 0 0 6px var(--color-running);
    }

    .status-dot.stopped {
      background: var(--color-stopped);
    }

    .status-dot.error {
      background: var(--color-error);
      box-shadow: 0 0 6px var(--color-error);
    }

    .status-label {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .mid-row {
      display: flex;
      gap: 16px;
      margin-bottom: 8px;
      font-size: 13px;
      color: var(--color-text-secondary);
    }

    .type-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      background: var(--color-surface-hover);
      font-size: 11px;
      font-weight: 500;
      color: var(--color-text-secondary);
    }

    .endpoint {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 4px;
      color: var(--color-text-muted);
    }

    .error-banner {
      margin-top: 8px;
      padding: 8px 12px;
      background: var(--color-error-bg);
      border-radius: var(--radius-sm);
      font-size: 12px;
      color: var(--color-error);
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
        <div class="top-row">
          <span class="name">${this.name}</span>
          <div class="status-row">
            <span class="status-label">${this._statusLabel(this.status)}</span>
            <span class="status-dot ${this.status}"></span>
          </div>
        </div>

        <div class="mid-row">
          <span class="type-badge">${this.type}</span>
          <span class="endpoint" title=${this.endpoint}>${this.endpoint}</span>
        </div>

        ${s ? html`
          <div class="stats-grid">
            <stats-row icon="link" .value=${formatNumber(s.current_conns)} .label=${formatRate(s.request_rate)}></stats-row>
            <stats-row icon="arrow_upward" .value=${formatBytes(s.input_bytes)} .label=${formatRate(s.input_rate_bytes)}></stats-row>
            <stats-row icon="arrow_downward" .value=${formatBytes(s.output_bytes)} .label=${formatRate(s.output_rate_bytes)}></stats-row>
          </div>
        ` : ''}

        ${this.error ? html`<div class="error-banner">${this.error}</div>` : ''}
      </div>
    `;
  }
}
