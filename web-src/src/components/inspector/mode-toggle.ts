import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from '../../i18n/i18n';

export type InspectorMode = 'query' | 'live';

@customElement('mode-toggle')
export class ModeToggle extends LitElement {
  @property() mode: InspectorMode = 'query';

  static styles = css`
    :host { display: block; }
    .toggle {
      display: flex; background: var(--bg);
      border-radius: var(--radius-md); padding: 3px;
    }
    .btn {
      flex: 1; text-align: center; padding: 6px;
      font-size: var(--font-sm); cursor: pointer; border-radius: 6px;
      border: none; background: none; font-family: inherit;
      color: var(--text-muted); transition: all 0.15s;
    }
    .btn.active { background: var(--border-subtle); color: var(--text); font-weight: 500; }
  `;

  render() {
    return html`
      <div class="toggle">
        <button class="btn ${this.mode === 'query' ? 'active' : ''}"
          @click=${() => this._setMode('query')}>${t('inspectorQuery')}</button>
        <button class="btn ${this.mode === 'live' ? 'active' : ''}"
          @click=${() => this._setMode('live')}>${t('inspectorLive')}</button>
      </div>
    `;
  }

  private _setMode(mode: InspectorMode) {
    this.mode = mode;
    this.dispatchEvent(new CustomEvent('mode-change', { detail: mode, bubbles: true, composed: true }));
  }
}
