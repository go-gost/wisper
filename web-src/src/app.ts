import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { createRouter } from './router/routes';
import { themeStyles } from './styles/theme';
import { loadSettings } from './store/settings-store';
import { refresh as refreshTunnels } from './store/tunnel-store';
import { refresh as refreshEntrypoints } from './store/entrypoint-store';
import { startPolling, stopPolling } from './store/stats-store';

/**
 * WisperApp — root application component.
 * Initializes settings, data, stats polling, and the router.
 */
@customElement('wisper-app')
export class WisperApp extends LitElement {
  static styles = themeStyles;

  private router = createRouter();

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
}
