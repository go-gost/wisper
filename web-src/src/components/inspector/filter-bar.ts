import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../i18n/i18n';

export type RangeValue = 'all' | number;

const RANGES: { minutes: number; label: string }[] = [
  { minutes: 5, label: '5m' },
  { minutes: 15, label: '15m' },
  { minutes: 60, label: '1h' },
  { minutes: 360, label: '6h' },
  { minutes: 1440, label: '24h' },
];

@customElement('inspector-filter-bar')
export class InspectorFilterBar extends LitElement {
  @property() sid = '';
  @property() mode: 'query' | 'live' = 'query';
  @property() range: RangeValue = 'all';

  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  static styles = css`
    :host { display: block; }
    .filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
    input {
      flex: 1; min-width: 80px; padding: 8px 10px;
      background: var(--bg); border: 1px solid var(--border);
      border-radius: var(--radius-sm); color: var(--text);
      font-size: var(--font-sm); font-family: var(--font-mono, 'SF Mono', monospace);
      outline: none; box-sizing: border-box;
    }
    input:focus { border-color: var(--accent); }
    .range-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .range-label { font-size: var(--font-sm); color: var(--text-muted); flex-shrink: 0; }
    .pills { display: flex; gap: 2px; background: var(--bg); border-radius: var(--radius-md); padding: 3px; }
    .pill {
      padding: 4px 10px; font-size: var(--font-sm); font-weight: 500;
      color: var(--text-muted); border-radius: 6px; cursor: pointer;
      border: none; background: none; font-family: inherit; transition: all 0.15s;
    }
    .pill.active { background: var(--accent); color: var(--accent-fg, #fff); }
    .pill:hover:not(.active) { color: var(--text); }
  `;

  private _fireChange() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.dispatchEvent(new CustomEvent('filter-change', {
        detail: { sid: this.sid },
        bubbles: true, composed: true,
      }));
    }, 400);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
  }

  render() {
    return html`
      <div class="filter-row">
        <input .value=${this.sid} placeholder=${t('inspectorFilterSid')}
          @input=${(e: Event) => { this.sid = (e.target as HTMLInputElement).value; this._fireChange(); }}>
      </div>
      ${this.mode === 'query' ? html`
        <div class="range-row">
          <span class="range-label">${t('inspectorTime')}</span>
          <div class="pills">
            ${RANGES.map(r => html`
              <button class="pill ${this.range === r.minutes ? 'active' : ''}"
                @click=${() => this.dispatchEvent(new CustomEvent('range-change', { detail: r.minutes, bubbles: true, composed: true }))}>
                ${r.label}
              </button>
            `)}
            <button class="pill ${this.range === 'all' ? 'active' : ''}"
              @click=${() => this.dispatchEvent(new CustomEvent('range-change', { detail: 'all', bubbles: true, composed: true }))}>
              ${t('inspectorRangeAll')}
            </button>
          </div>
        </div>
      ` : ''}
    `;
  }
}
