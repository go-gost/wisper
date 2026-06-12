import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { decodeBase64 } from '../../api/inspector';
import { t } from '../../i18n/i18n';

type BodyTab = 'text' | 'hex' | 'json';

@customElement('body-viewer')
export class BodyViewer extends LitElement {
  @property() body = '';

  static styles = css`
    :host { display: block; }
    .tabs { display: flex; gap: 4px; margin-bottom: 8px; }
    .tab {
      font-size: var(--font-xs); padding: 3px 8px; border-radius: 4px;
      cursor: pointer; color: var(--text-muted);
      background: var(--border-subtle); border: none; font-family: inherit;
    }
    .tab.active { color: var(--text); background: var(--accent); }
    pre {
      font-family: var(--font-mono, 'SF Mono', monospace);
      font-size: var(--font-xs); background: var(--bg);
      border-radius: var(--radius-sm); padding: 8px; overflow-x: auto;
      white-space: pre-wrap; word-break: break-all; max-height: 300px;
      overflow-y: auto; margin: 0;
    }
    .toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .copy-btn {
      font-size: var(--font-xs); padding: 2px 8px; cursor: pointer;
      background: var(--border-subtle); border: none; border-radius: 4px;
      color: var(--text-muted); font-family: inherit; margin-left: auto;
    }
  `;

  private _tab: BodyTab = 'text';

  private _decode(): Uint8Array {
    if (!this.body) return new Uint8Array(0);
    try {
      return decodeBase64(this.body);
    } catch {
      return new TextEncoder().encode(this.body);
    }
  }

  private _renderContent(): string {
    const bytes = this._decode();
    switch (this._tab) {
      case 'hex':
        return Array.from(bytes.slice(0, 4096))
          .map(b => b.toString(16).padStart(2, '0'))
          .join(' ');
      case 'json':
        try {
          const text = new TextDecoder().decode(bytes);
          return JSON.stringify(JSON.parse(text), null, 2);
        } catch { return new TextDecoder().decode(bytes); }
      default:
        return new TextDecoder().decode(bytes);
    }
  }

  private _copyContent() {
    navigator.clipboard.writeText(this._renderContent());
  }

  render() {
    return html`
      <div class="toolbar">
        <div class="tabs">
          <button class="tab ${this._tab === 'text' ? 'active' : ''}" @click=${() => { this._tab = 'text'; }}>${t('inspectorTabText')}</button>
          <button class="tab ${this._tab === 'hex' ? 'active' : ''}" @click=${() => { this._tab = 'hex'; }}>${t('inspectorTabHex')}</button>
          <button class="tab ${this._tab === 'json' ? 'active' : ''}" @click=${() => { this._tab = 'json'; }}>${t('inspectorTabJson')}</button>
        </div>
        <button class="copy-btn" @click=${() => this._copyContent()}>${t('inspectorBtnCopy')}</button>
      </div>
      <pre>${this._renderContent()}</pre>
    `;
  }
}
