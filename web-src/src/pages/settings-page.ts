import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { t, onLocaleChange } from '../i18n/i18n';
import { icon } from '../utils/icons';
import { getSettings, updateSettings, subscribe } from '../store/settings-store';
import type { ThemePreference, LanguagePreference } from '../api/types';
import '../components/app-scaffold';

const THEME_OPTIONS: { value: ThemePreference; labelKey: string }[] = [
  { value: 'system', labelKey: 'settingsThemeSystem' },
  { value: 'light', labelKey: 'settingsThemeLight' },
  { value: 'dark', labelKey: 'settingsThemeDark' },
];

const LANG_OPTIONS: { value: LanguagePreference; labelKey: string }[] = [
  { value: 'en', labelKey: 'settingsLangEn' },
  { value: 'zh', labelKey: 'settingsLangZh' },
];

@customElement('settings-page')
export class SettingsPage extends LitElement {
  @state() private _server = '';
  @state() private _entrypoint = '';
  @state() private _insecure = false;
  @state() private _theme: ThemePreference = 'system';
  @state() private _lang: LanguagePreference = 'en';
  @state() private _snackbar = '';
  @state() private _saving = false;

  private _unsubs: (() => void)[] = [];

  connectedCallback() {
    super.connectedCallback();
    const s = getSettings();
    this._server = s.server;
    this._entrypoint = s.entrypoint;
    this._insecure = s.insecure;
    this._theme = s.theme;
    this._lang = s.lang;

    this._unsubs.push(
      subscribe(() => {
        const s2 = getSettings();
        this._server = s2.server;
        this._entrypoint = s2.entrypoint;
        this._insecure = s2.insecure;
        this._theme = s2.theme;
        this._lang = s2.lang;
        this.requestUpdate();
      }),
      onLocaleChange(() => this.requestUpdate()),
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const fn of this._unsubs) fn();
  }

  private _navigate(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  private _showSnackbar(msg: string) {
    this._snackbar = msg;
    setTimeout(() => {
      this._snackbar = '';
      this.requestUpdate();
    }, 2000);
  }

  private async _saveSettings() {
    this._saving = true;
    try {
      await updateSettings({
        server: this._server,
        entrypoint: this._entrypoint,
        insecure: this._insecure,
      });
      this._showSnackbar('✓ ' + t('saved'));
    } catch {
      this._showSnackbar(t('saveFailed'));
    }
    this._saving = false;
  }

  private async _setTheme(theme: ThemePreference) {
    this._theme = theme;
    this.requestUpdate();
    this._showSnackbar('✓ ' + t(THEME_OPTIONS.find(o => o.value === theme)?.labelKey ?? 'settingsThemeSystem'));
    try {
      await updateSettings({ theme });
    } catch {
      // UI already updated optimistically
    }
  }

  private async _setLang(lang: LanguagePreference) {
    this._lang = lang;
    this.requestUpdate();
    this._showSnackbar('✓ ' + t(LANG_OPTIONS.find(o => o.value === lang)?.labelKey ?? 'settingsLangEn'));
    try {
      await updateSettings({ lang });
    } catch {
      // UI already updated optimistically
    }
  }

  private _cycleOption<T>(current: T, options: T[]): T {
    const idx = options.indexOf(current);
    return options[(idx + 1) % options.length];
  }

  static styles = css`
    /* ── Back nav ── */
    .back-btn {
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 4px; border-radius: var(--radius-sm);
      display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--border-subtle); }

    .page-title { font-size: 13px; font-weight: 600; flex: 1; }

    /* ── App info ── */
    .app-info {
      text-align: center;
      padding: 28px 16px 20px;
    }
    .app-logo {
      width: 64px; height: 64px;
      background: var(--accent);
      border-radius: var(--radius-lg);
      margin: 0 auto 12px;
      display: flex; align-items: center; justify-content: center;
      color: var(--accent-fg);
      font-weight: 700; font-size: 24px;
    }
    .app-name {
      font-size: 16px; font-weight: 600;
      color: var(--text); margin-bottom: 2px;
    }
    .app-version {
      font-size: 11px; color: var(--text-muted);
    }

    /* ── Section ── */
    .section { padding: 0 16px 16px; }
    .section-title {
      font-size: 11px; font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }

    /* ── Card ── */
    .card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }
    .card-padded { padding: 16px; }

    /* ── Form ── */
    .form-group { margin-bottom: 12px; }
    .form-group:last-child { margin-bottom: 0; }
    .form-label {
      display: block;
      font-size: 8px; font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%; padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface); color: var(--text);
      font-size: 12px; font-family: inherit; outline: none;
      box-sizing: border-box;
      transition: border-color var(--transition-fast);
    }
    .form-input:focus { border-color: var(--accent); }
    .hint {
      font-size: 9px; color: var(--text-muted); margin-top: 2px;
    }

    /* ── Switch ── */
    .switch-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 0; border-bottom: 1px solid var(--border-subtle);
    }
    .switch-row:last-child { border-bottom: none; }
    .switch-label { font-size: 11px; color: var(--text); }
    .switch-desc { font-size: 9px; color: var(--text-muted); }
    .switch {
      width: 40px; height: 22px; border-radius: 11px;
      background: var(--border); position: relative;
      cursor: pointer; transition: background var(--transition-fast);
      flex-shrink: 0;
    }
    .switch.on { background: var(--accent); }
    .switch-knob {
      width: 18px; height: 18px; border-radius: 50%;
      background: #fff; position: absolute; top: 2px; left: 2px;
      transition: left var(--transition-fast);
      box-shadow: 0 1px 2px rgba(0,0,0,0.15);
    }
    .switch.on .switch-knob { left: 20px; }

    /* ── Selector rows ── */
    .selector-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 1px solid var(--border-subtle);
      cursor: pointer;
    }
    .selector-row:last-child { border-bottom: none; }
    .selector-row:hover { background: var(--border-subtle); }
    .selector-label { font-size: 11px; color: var(--text); }
    .selector-value {
      display: flex; align-items: center; gap: 4px;
      color: var(--text-muted); font-size: 10px;
    }

    /* ── Save button ── */
    .save-btn {
      width: 100%; padding: 10px;
      border-radius: var(--radius-md);
      border: none;
      background: var(--accent); color: var(--accent-fg);
      font-size: 12px; font-weight: 500; cursor: pointer;
      font-family: inherit;
      margin-top: 12px;
      transition: opacity var(--transition-fast);
    }
    .save-btn:hover { opacity: 0.85; }
    .save-btn:disabled { opacity: 0.5; cursor: default; }

    /* ── Toast ── */
    .toast {
      position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
      background: var(--surface); color: var(--text);
      padding: 10px 20px; border-radius: var(--radius-lg);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: 12px; z-index: 100;
      animation: toast-in 0.3s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
  `;

  render() {
    return html`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${() => this._navigate('/')}>
            ${icon('chevron-left')}
          </button>
          <span class="page-title">${t('settingsTitle')}</span>
        </div>

        <!-- App Info -->
        <div class="app-info">
          <div class="app-logo">W</div>
          <div class="app-name">${t('appName')}</div>
          <div class="app-version">v1.0.0 · GOST Tunnel Manager</div>
        </div>

        <!-- Server Configuration -->
        <div class="section">
          <div class="section-title">Server Configuration</div>
          <div class="card">
            <div class="card-padded">
              <div class="form-group">
                <label class="form-label">${t('settingsServer')}</label>
                <input class="form-input" .value=${this._server}
                  placeholder=${t('settingsServerHint')}
                  @input=${(e: Event) => { this._server = (e.target as HTMLInputElement).value; }}>
                <div class="hint">${t('settingsServerHint')}</div>
              </div>
              <div class="form-group">
                <label class="form-label">${t('settingsEntrypoint')}</label>
                <input class="form-input" .value=${this._entrypoint}
                  placeholder=${t('settingsEntrypointHint')}
                  @input=${(e: Event) => { this._entrypoint = (e.target as HTMLInputElement).value; }}>
                <div class="hint">${t('settingsEntrypointHint')}</div>
              </div>
              <div class="switch-row" style="border-bottom:none;">
                <div>
                  <div class="switch-label">${t('settingsInsecure')}</div>
                  <div class="switch-desc">${t('settingsInsecureDesc')}</div>
                </div>
                <div class="switch ${this._insecure ? 'on' : ''}"
                  @click=${() => { this._insecure = !this._insecure; }}>
                  <div class="switch-knob"></div>
                </div>
              </div>
              <button class="save-btn" ?disabled=${this._saving} @click=${this._saveSettings}>
                ${icon('check')} ${t('btnSave')}
              </button>
            </div>
          </div>
        </div>

        <!-- Preferences -->
        <div class="section">
          <div class="section-title">Preferences</div>
          <div class="card">
            <div class="selector-row" @click=${() => this._setLang(
              this._cycleOption(this._lang, LANG_OPTIONS.map(o => o.value))
            )}>
              <span class="selector-label">${t('settingsLanguage')}</span>
              <span class="selector-value">
                ${t(LANG_OPTIONS.find(o => o.value === this._lang)?.labelKey ?? 'settingsLangEn')}
                ${icon('chevron-right')}
              </span>
            </div>
            <div class="selector-row" @click=${() => this._setTheme(
              this._cycleOption(this._theme, THEME_OPTIONS.map(o => o.value))
            )}>
              <span class="selector-label">${t('settingsTheme')}</span>
              <span class="selector-value">
                ${t(THEME_OPTIONS.find(o => o.value === this._theme)?.labelKey ?? 'settingsThemeSystem')}
                ${icon('chevron-right')}
              </span>
            </div>
          </div>
        </div>

        ${this._snackbar ? html`<div class="toast">${this._snackbar}</div>` : ''}
      </app-scaffold>
    `;
  }
}
