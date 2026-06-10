import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { t, onLocaleChange } from '../i18n/i18n';
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

  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
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
    setTimeout(() => { this._snackbar = ''; this.requestUpdate(); }, 2000);
  }

  private _debouncedSave(field: string, value: string | boolean) {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(async () => {
      try {
        await updateSettings({ [field]: value });
        this._showSnackbar('✓ ' + t('saved'));
      } catch {
        this._showSnackbar(t('saveFailed'));
      }
    }, 600);
  }

  private async _setTheme(theme: ThemePreference) {
    this._theme = theme;
    await updateSettings({ theme });
    this._showSnackbar('✓ ' + t('saved'));
  }

  private async _setLang(lang: LanguagePreference) {
    this._lang = lang;
    await updateSettings({ lang });
    this._showSnackbar('✓ ' + t('saved'));
  }

  private _cycleOption<T>(current: T, options: T[]): T {
    const idx = options.indexOf(current);
    return options[(idx + 1) % options.length];
  }

  static styles = css`
    /* ── AppBar ── */
    .back-btn {
      background: none; border: none; cursor: pointer;
      font-size: 1.3rem; color: var(--color-text-primary); padding: 4px 8px;
      border-radius: 8px; display: flex; align-items: center;
    }
    .back-btn:hover { background: var(--color-surface-variant); }
    .page-title { font-size: 1.15rem; font-weight: 600; }

    /* ── Settings header (matching prototype) ── */
    .settings-header {
      text-align: center;
      padding: 32px 16px 24px;
    }
    .settings-icon {
      width: 80px; height: 80px;
      background: var(--color-primary);
      border-radius: 18px;
      margin: 0 auto 16px;
      display: flex; align-items: center; justify-content: center;
      color: white; font-weight: 700; font-size: 1.8rem;
    }
    .settings-app-name { font-weight: 600; font-size: 1.2rem; margin-bottom: 4px; }
    .settings-version { color: var(--color-stopped); font-size: 0.9rem; }

    /* ── Card ── */
    .detail-section { margin: 0 16px 16px; }
    .detail-card {
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-card);
      padding: 0;
      transition: background var(--transition-fast);
    }
    .card-padded { padding: 20px; }
    .card-title {
      font-size: 14px; font-weight: 600; color: var(--color-text-primary);
      margin-bottom: 12px;
    }

    /* ── Form fields ── */
    .form-group { margin-bottom: 12px; }
    .form-label {
      display: block;
      font-size: 0.8rem; font-weight: 500;
      color: var(--color-stopped);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%; padding: 12px 14px;
      border: 1.5px solid var(--color-input-border);
      border-radius: var(--radius-md); background: var(--color-input-bg);
      color: var(--color-text-primary); font-size: 0.95rem;
      font-family: inherit; outline: none; box-sizing: border-box;
      transition: border-color var(--transition-fast), background var(--transition-fast);
    }
    .form-input:focus { border-color: var(--color-primary); }
    .hint { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }

    /* ── Switch row ── */
    .switch-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .switch-label { font-size: 0.95rem; color: var(--color-text-primary); }
    .switch-desc { font-size: 12px; color: var(--color-text-muted); }
    .switch {
      width: 44px; height: 24px; border-radius: 12px;
      background: var(--color-stopped); position: relative;
      cursor: pointer; transition: background var(--transition-fast); flex-shrink: 0;
    }
    .switch.on { background: var(--color-primary); }
    .switch-knob {
      width: 20px; height: 20px; border-radius: 50%;
      background: white; position: absolute; top: 2px; left: 2px;
      transition: left var(--transition-fast);
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .switch.on .switch-knob { left: 22px; }

    /* ── Selector rows (matching prototype) ── */
    .selector-field {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px; border-bottom: 1px solid var(--color-divider);
      cursor: pointer;
    }
    .selector-field:last-child { border-bottom: none; }
    .selector-field:hover { background: var(--color-surface-variant); }
    .selector-label { font-size: 0.95rem; }
    .selector-value {
      display: flex; align-items: center; gap: 4px;
      color: var(--color-stopped); font-size: 0.9rem;
    }

    /* ── Toast ── */
    .toast {
      position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
      background: var(--color-toast-bg); color: var(--color-toast-fg);
      padding: 12px 24px; border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: 0.9rem; z-index: 100;
      display: flex; align-items: center; gap: 8px;
      max-width: 400px; transition: background var(--transition-fast);
      animation: toast-in 0.3s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
  `;

  render() {
    return html`
      <app-scaffold>
        <!-- AppBar -->
        <div slot="appBar" style="display:flex;align-items:center;gap:8px;">
          <button class="back-btn" @click=${() => this._navigate('/')}>←</button>
          <span class="page-title">${t('settingsTitle')}</span>
        </div>

        <!-- App Info Header -->
        <div class="settings-header">
          <div class="settings-icon">W</div>
          <div class="settings-app-name">${t('appName')}</div>
          <div class="settings-version">v0.1.0</div>
        </div>

        <!-- Server Settings -->
        <div class="detail-section">
          <div class="detail-card">
            <div class="card-padded">
              <div class="card-title">Server</div>
              <div class="form-group">
                <label class="form-label">${t('settingsServer')}</label>
                <input class="form-input" .value=${this._server}
                  placeholder=${t('settingsServerHint')}
                  @input=${(e: Event) => {
                    this._server = (e.target as HTMLInputElement).value;
                    this._debouncedSave('server', this._server);
                  }}>
                <div class="hint">${t('settingsServerHint')}</div>
              </div>
              <div class="form-group">
                <label class="form-label">${t('settingsEntrypoint')}</label>
                <input class="form-input" .value=${this._entrypoint}
                  placeholder=${t('settingsEntrypointHint')}
                  @input=${(e: Event) => {
                    this._entrypoint = (e.target as HTMLInputElement).value;
                    this._debouncedSave('entrypoint', this._entrypoint);
                  }}>
                <div class="hint">${t('settingsEntrypointHint')}</div>
              </div>
              <div class="switch-row">
                <div>
                  <div class="switch-label">${t('settingsInsecure')}</div>
                  <div class="switch-desc">${t('settingsInsecureDesc')}</div>
                </div>
                <div class="switch ${this._insecure ? 'on' : ''}" @click=${() => {
                  this._insecure = !this._insecure;
                  this._debouncedSave('insecure', this._insecure);
                }}>
                  <div class="switch-knob"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Theme & Language -->
        <div class="detail-section">
          <div class="detail-card">
            <div class="selector-field" @click=${() => this._setLang(this._cycleOption(this._lang, LANG_OPTIONS.map(o => o.value)))}>
              <span class="selector-label">${t('settingsLanguage')}</span>
              <span class="selector-value">${t(LANG_OPTIONS.find(o => o.value === this._lang)?.labelKey ?? 'settingsLangEn')} ▶</span>
            </div>
            <div class="selector-field" @click=${() => this._setTheme(this._cycleOption(this._theme, THEME_OPTIONS.map(o => o.value)))}>
              <span class="selector-label">${t('settingsTheme')}</span>
              <span class="selector-value">${t(THEME_OPTIONS.find(o => o.value === this._theme)?.labelKey ?? 'settingsThemeSystem')} ▶</span>
            </div>
          </div>
        </div>

        ${this._snackbar ? html`<div class="toast">${this._snackbar}</div>` : ''}
      </app-scaffold>
    `;
  }
}
