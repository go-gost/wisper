import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { decodeBase64 } from '../../api/inspector';
import { t } from '../../i18n/i18n';

type BodyTab = 'text' | 'hex' | 'json';

/** Cap hexdump output so very large bodies don't flood the DOM. */
const HEX_CAP = 4096;

@customElement('body-viewer')
export class BodyViewer extends LitElement {
  @property() body = '';

  static styles = css`
    :host { display: block; }
    .tabs { display: flex; gap: 4px; margin-bottom: 8px; }
    .tab {
      font-size: var(--font-sm); padding: 3px 8px; border-radius: 4px;
      cursor: pointer; color: var(--text-muted);
      background: var(--border-subtle); border: none; font-family: inherit;
    }
    .tab.active { color: var(--text); background: var(--accent); }
    pre {
      font-family: var(--font-mono, 'SF Mono', monospace);
      font-size: var(--font-sm); background: var(--bg);
      border-radius: var(--radius-sm); padding: 8px; overflow-x: auto;
      white-space: pre-wrap; word-break: break-all; max-height: 300px;
      overflow-y: auto; margin: 0;
    }
    /* Hex columns are fixed-width; never wrap (scroll horizontally instead). */
    pre.hex { white-space: pre; word-break: normal; }
    .toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
    .copy-btn {
      font-size: var(--font-sm); padding: 2px 8px; cursor: pointer;
      background: var(--border-subtle); border: none; border-radius: 4px;
      color: var(--text-muted); font-family: inherit; margin-left: auto;
    }
  `;

  @state() private _tab: BodyTab = 'text';

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
        return this._renderHexdump(bytes);
      case 'json':
        try {
          const text = new TextDecoder().decode(bytes);
          return JSON.stringify(JSON.parse(text), null, 2);
        } catch { return new TextDecoder().decode(bytes); }
      default:
        return new TextDecoder().decode(bytes);
    }
  }

  /**
   * Render bytes as a canonical `hexdump -C` block: 8-digit hex offset,
   * 16 bytes per line (split 8+8) in hex, and an ASCII gutter where
   * non-printable bytes render as `.`. Output is capped at HEX_CAP bytes.
   */
  private _renderHexdump(bytes: Uint8Array): string {
    const view = bytes.length > HEX_CAP ? bytes.slice(0, HEX_CAP) : bytes;
    const lines: string[] = [];
    for (let off = 0; off < view.length; off += 16) {
      let hex = '';
      let ascii = '';
      for (let i = 0; i < 16; i++) {
        if (i === 8) hex += ' '; // gap between the two 8-byte groups
        const idx = off + i;
        if (idx >= view.length) {
          hex += '   '; // pad short final line so columns stay aligned
        } else {
          const b = view[idx];
          hex += b.toString(16).padStart(2, '0') + ' ';
          ascii += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.';
        }
      }
      lines.push(`${off.toString(16).padStart(8, '0')}  ${hex} |${ascii}|`);
    }
    if (bytes.length > HEX_CAP) {
      lines.push(`... (${(bytes.length - HEX_CAP).toLocaleString()} more bytes not shown)`);
    }
    return lines.join('\n');
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
      <pre class="${this._tab === 'hex' ? 'hex' : ''}">${this._renderContent()}</pre>
    `;
  }
}
