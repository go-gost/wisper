import { LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { createRouter } from './router/routes';
import { loadSettings, subscribe, getSettings } from './store/settings-store';
import { refresh as refreshTunnels } from './store/tunnel-store';
import { refresh as refreshEntrypoints } from './store/entrypoint-store';
import { startPolling, stopPolling, updatePollingInterval } from './store/stats-store';
import { initExternalLinkInterceptor } from './utils/open-external';

/**
 * WisperApp — root application component.
 *
 * Theme CSS custom properties are provided by `styles/theme.css` (imported
 * in main.ts). Vite injects them into the document <head> as a <style> tag,
 * so they live in the light DOM and cascade into all Shadow DOM components
 * via `var()` references.
 */
@customElement('wisper-app')
export class WisperApp extends LitElement {
  private router;

  constructor() {
    super();
    this.router = createRouter(this);
    // Open external links in the system browser (Android bridge, desktop
    // Tauri shell, or default <a> behavior in a plain browser).
    initExternalLinkInterceptor();
  }

  async firstUpdated() {
    // Initialize settings (theme, locale, server config) from backend.
    try {
      await loadSettings();
    } catch {
      // Keep going with local defaults if the backend is unreachable (e.g.
      // while the device switches networks): the app must not stall on load.
    }

    // Load initial data. A stalled fetch must not prevent polling from
    // starting, or the UI stays on a spinner forever.
    try {
      await Promise.all([refreshTunnels(), refreshEntrypoints()]);
    } catch {
      // Keep going; the stores already swallow per-request errors.
    }

    // Begin live stats polling.
    startPolling();

    // Re-pull once connectivity comes back after a network switch: the initial
    // fetch may have timed out while the device was offline, leaving the list
    // empty until the next manual refresh.
    const onOnline = () => {
      void refreshTunnels();
      void refreshEntrypoints();
    };
    window.addEventListener('online', onOnline);

    // React to polling interval changes from settings.
    subscribe(() => {
      const s = getSettings();
      updatePollingInterval(s.stats_interval);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    stopPolling();
  }

  render() {
    return this.router.outlet();
  }
}
