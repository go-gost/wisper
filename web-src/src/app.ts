import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { createRouter } from './router/routes';
import { loadSettings } from './store/settings-store';
import { refresh as refreshTunnels } from './store/tunnel-store';
import { refresh as refreshEntrypoints } from './store/entrypoint-store';
import { startPolling, stopPolling } from './store/stats-store';

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
}
