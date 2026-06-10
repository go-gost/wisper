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
        this._showSnackbar(t('saved'));
      } catch {
        this._showSnackbar(t('saveFailed'));
      }
    }, 600);
  }

  private async _setTheme(theme: ThemePreference) {
    this._theme = theme;
    await updateSettings({ theme });
    this._showSnackbar(t('saved'));
  }

  private async _setLang(lang: LanguagePreference) {
    this._lang = lang;
    await updateSettings({ lang });
    this._showSnackbar(t('saved'));
  }

  private _cycleOption<T>(current: T, options: T[]): T {
    const idx = options.indexOf(current);
    return options[(idx + 1) % options.length];
  }

  static styles = css`
    .title-row { display: flex; align-items: center; gap: 8px; }
    .back-btn {
      background: none; border: none; cursor: pointer; font-size: 18px;
      padding: 4px; color: var(--color-text-secondary); border-radius: 50%;
      width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
    }
    .back-btn:hover { background: var(--color-surface-hover); }
    .page-title { font-size: 18px; font-weight: 600; }

    .app-info {
      display: flex; flex-direction: column; align-items: center;
      padding: 32px 0 20px; gap: 8px;
    }
    .app-icon {
      width: 80px; height: 80px; border-radius: 20px;
      background: var(--color-primary); color: white;
      display: flex; align-items: center; justify-content: center;
      font-size: 36px; font-weight: 800;
    }
    .app-name { font-size: 20px; font-weight: 700; color: var(--color-text-primary); }
    .app-version { font-size: 13px; color: var(--color-text-muted); }

    .card {
      background: var(--color-surface); border: 1px solid var(--color-border);
      border-radius: var(--radius-md); padding: 16px; margin-bottom: 16px;
      box-shadow: var(--shadow-card);
    }
    .card-title {
      font-size: 14px; font-weight: 600; color: var(--color-text-primary);
      margin-bottom: 12px;
    }

    .field { margin-bottom: 12px; }
    .field label { display: block; font-size: 13px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 4px; }
    .field input {
      width: 100%; padding: 10px 12px; border: 1px solid var(--color-border);
      border-radius: var(--radius-sm); background: var(--color-surface);
      color: var(--color-text-primary); font-size: 14px; font-family: inherit;
      box-sizing: border-box; transition: border-color var(--transition-fast);
    }
    .field input:focus { border-color: var(--color-primary); outline: none; }
    .hint { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }

    .switch-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .switch-label { font-size: 14px; color: var(--color-text-primary); }
    .switch-desc { font-size: 12px; color: var(--color-text-muted); }
    .switch { position: relative; width: 44px; height: 24px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; inset: 0; background: var(--color-border);
      border-radius: 12px; cursor: pointer; transition: var(--transition-fast);
    }
    .slider::before {
      content: ''; position: absolute; width: 18px; height: 18px;
      left: 3px; bottom: 3px; background: white; border-radius: 50%;
      transition: var(--transition-fast);
    }
    input:checked + .slider { background: var(--color-primary); }
    input:checked + .slider::before { transform: translateX(20px); }

    .selector-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 0; border-bottom: 1px solid var(--color-divider);
      cursor: pointer;
    }
    .selector-row:last-child { border-bottom: none; }
    .selector-label { font-size: 14px; color: var(--color-text-primary); }
    .selector-value {
      font-size: 13px; color: var(--color-text-muted);
      display: flex; align-items: center; gap: 4px;
    }

    .snackbar {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      padding: 10px 20px; background: #333; color: white;
      border-radius: var(--radius-pill); font-size: 13px;
      z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: snackIn 0.3s ease;
    }
    @keyframes snackIn { from { opacity: 0; transform: translateX(-50%) translateY(10px); } }
  `;

  render() {
    return html`
      <app-scaffold>
        <div slot="appBar" class="title-row">
          <button class="back-btn" @click=${() => this._navigate('/')}>←</button>
          <span class="page-title">${t('settingsTitle')}</span>
        </div>

        <div class="app-info">
          <div class="app-icon">W</div>
          <div class="app-name">${t('appName')}</div>
          <div class="app-version">v0.1.0</div>
        </div>

        <!-- Server Settings -->
        <div class="card">
          <div class="card-title">Server</div>
          <div class="field">
            <label>${t('settingsServer')}</label>
            <input type="text" .value=${this._server}
              placeholder=${t('settingsServerHint')}
              @input=${(e: Event) => {
                this._server = (e.target as HTMLInputElement).value;
                this._debouncedSave('server', this._server);
              }}>
            <div class="hint">${t('settingsServerHint')}</div>
          </div>
          <div class="field">
            <label>${t('settingsEntrypoint')}</label>
            <input type="text" .value=${this._entrypoint}
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
            <label class="switch">
              <input type="checkbox" .checked=${this._insecure}
                @change=${(e: Event) => {
                  this._insecure = (e.target as HTMLInputElement).checked;
                  this._debouncedSave('insecure', this._insecure);
                }}>
              <span class="slider"></span>
            </label>
          </div>
        </div>

        <!-- Theme & Language -->
        <div class="card">
          <div class="card-title">${t('settingsTheme')} & ${t('settingsLanguage')}</div>
          <div class="selector-row" @click=${() => this._setLang(this._cycleOption(this._lang, LANG_OPTIONS.map(o => o.value)))}>
            <span class="selector-label">${t('settingsLanguage')}</span>
            <span class="selector-value">${t(LANG_OPTIONS.find(o => o.value === this._lang)?.labelKey ?? 'settingsLangEn')}</span>
          </div>
          <div class="selector-row" @click=${() => this._setTheme(this._cycleOption(this._theme, THEME_OPTIONS.map(o => o.value)))}>
            <span class="selector-label">${t('settingsTheme')}</span>
            <span class="selector-value">${t(THEME_OPTIONS.find(o => o.value === this._theme)?.labelKey ?? 'settingsThemeSystem')}</span>
          </div>
        </div>

        ${this._snackbar ? html`<div class="snackbar">${this._snackbar}</div>` : ''}
      </app-scaffold>
    `;
  }
}
