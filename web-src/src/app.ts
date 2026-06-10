import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { createRouter } from './router/routes';
import { loadSettings } from './store/settings-store';
import { refresh as refreshTunnels } from './store/tunnel-store';
import { refresh as refreshEntrypoints } from './store/entrypoint-store';
import { startPolling, stopPolling } from './store/stats-store';

/**
 * WisperApp — root application component.
 * Initializes settings, data, stats polling, the router, and global theme styles.
 *
 * Theme CSS custom properties are injected into the document <head>
 * (light DOM) so they cascade into all Shadow DOM components.
 */
@customElement('wisper-app')
export class WisperApp extends LitElement {
  private router;

  constructor() {
    super();
    this.router = createRouter(this);
    this._injectThemeStyles();
  }

  async firstUpdated() {
    // Initialize settings (theme, locale, server config) from backend.
    await loadSettings();

    // Load initial data.
    await Promise.all([refreshTunnels(), refreshEntrypoints()]);

    // Begin live stats polling.
    startPolling();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    stopPolling();
  }

  render() {
    return this.router.outlet();
  }

  /**
   * Inject CSS custom properties into the document <head> so they
   * cascade through all Shadow DOM boundaries. Without this, :root
   * and body styles defined inside a component's static styles are
   * silently scoped away by Shadow DOM encapsulation.
   */
  private _injectThemeStyles() {
    const id = 'wisper-theme-styles';
    if (document.getElementById(id)) return;

    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      :root {
        --color-bg: #ffffff;
        --color-text-primary: #000000;
        --color-surface: #f5f5f5;
        --color-surface-hover: #eeeeee;
        --color-text-secondary: #757575;
        --color-text-muted: #9e9e9e;
        --color-border: #bdbdbd;
        --color-divider: #e0e0e0;
        --color-primary: #3f51b5;
        --color-primary-hover: #303f9f;
        --color-primary-text: #ffffff;
        --color-running: #00c853;
        --color-stopped: #757575;
        --color-error: #e53935;
        --color-error-bg: #ffebee;
        --color-fav: #f44336;
        --color-fav-off: #bdbdbd;
        --color-nav-bg: #eceff1;
        --color-nav-active-bg: #cfd8dc;
        --color-input-bg: #ffffff;
        --color-input-border: #bdbdbd;
        --color-appbar-bg: #ffffff;
        --color-appbar-shadow: 0 1px 0 var(--color-divider);
        --color-overlay: rgba(0, 0, 0, 0.4);
        --color-surface-variant: #e8eaf6;
        --color-on-surface-variant: #3f51b5;
        --color-toast-bg: #e0e0e0;
        --color-toast-fg: #333333;
        --max-content-width: 1200px;
        --radius-sm: 6px;
        --radius-md: 12px;
        --radius-lg: 16px;
        --radius-pill: 24px;
        --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.12);
        --shadow-card-hover: 0 2px 8px rgba(0, 0, 0, 0.15);
        --transition-fast: 0.2s ease;
        --transition-normal: 0.25s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: var(--color-text-primary);
        background: var(--color-bg);
      }

      :root.dark {
        --color-bg: #212121;
        --color-text-primary: #ffffff;
        --color-surface: #424242;
        --color-surface-hover: #4f4f4f;
        --color-text-secondary: #a0a0a0;
        --color-text-muted: #808080;
        --color-border: #616161;
        --color-divider: #424242;
        --color-primary: #4caf50;
        --color-primary-hover: #43a047;
        --color-primary-text: #ffffff;
        --color-error-bg: #3e1015;
        --color-nav-bg: #424242;
        --color-nav-active-bg: #757575;
        --color-input-bg: #333333;
        --color-input-border: #616161;
        --color-appbar-bg: #212121;
        --color-appbar-shadow: 0 1px 0 var(--color-divider);
        --color-overlay: rgba(0, 0, 0, 0.6);
        --color-surface-variant: #1b2631;
        --color-on-surface-variant: #4caf50;
        --color-toast-bg: #616161;
        --color-toast-fg: #ffffff;
        --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.3);
        --shadow-card-hover: 0 2px 8px rgba(0, 0, 0, 0.5);
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 0;
        min-height: 100vh;
      }

      a {
        color: var(--color-primary);
        text-decoration: none;
      }
    `;
    document.head.appendChild(style);
  }
}
