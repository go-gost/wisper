import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../i18n/i18n';

@customElement('inspector-filter-bar')
export class InspectorFilterBar extends LitElement {
  @property() sid = '';

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
    `;
  }
}
