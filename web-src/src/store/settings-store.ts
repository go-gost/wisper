import { GoBackend } from '../api/backend';
import type { AppSettings, AppSettingsUpdate, ThemePreference, LanguagePreference } from '../api/types';
import { setLocale } from '../i18n/i18n';

// ─── Theme controller (moved from styles/theme.ts) ─────────────────────────

const THEME_KEY = 'wisper-theme';

export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  let resolved: 'light' | 'dark';

  if (pref === 'system') {
    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    resolved = pref;
  }

  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  localStorage.setItem(THEME_KEY, pref);
}

export function getStoredTheme(): ThemePreference {
  return (localStorage.getItem(THEME_KEY) as ThemePreference) || 'system';
}

// ─── State ───────────────────────────────────────────────────────────────────

let settings: AppSettings = {
  server: 'tunnel.gost.run',
  entrypoint: 'gost.run',
  insecure: false,
  lang: 'en',
  theme: 'system',
  stats_interval: 3,
  inspector_url: '',
};

const listeners = new Set<() => void>();
const backend = new GoBackend();

// ─── Public API ──────────────────────────────────────────────────────────────

export function getSettings(): AppSettings {
  return { ...settings };
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) {
    fn();
  }
}

/** Load settings from backend. Falls back to stored theme/locale if offline. */
export async function loadSettings(): Promise<void> {
  try {
    const cfg = await backend.getConfig();
    settings = {
      server: cfg.server || 'tunnel.gost.run',
      entrypoint: cfg.entrypoint || 'gost.run',
      insecure: cfg.insecure || false,
      lang: cfg.lang || 'en',
      theme: cfg.theme || getStoredTheme(),
      stats_interval: cfg.stats_interval || 3,
      inspector_url: cfg.inspector_url || '',
    };
  } catch {
    // Backend unavailable — use stored/local preferences.
    settings.theme = getStoredTheme();
    settings.lang = (localStorage.getItem('wisper-lang') as LanguagePreference) || 'en';
  }

  applyTheme(settings.theme);
  setLocale(settings.lang);
  notify();
}

/** Save and apply a partial settings update. */
export async function updateSettings(update: AppSettingsUpdate): Promise<void> {
  try {
    await backend.updateConfig(update);
  } catch {
    // Still apply locally even if backend save fails.
  }

  if (update.server !== undefined) settings.server = update.server;
  if (update.entrypoint !== undefined) settings.entrypoint = update.entrypoint;
  if (update.insecure !== undefined) settings.insecure = update.insecure;
  if (update.lang !== undefined) {
    settings.lang = update.lang as LanguagePreference;
    setLocale(settings.lang);
    localStorage.setItem('wisper-lang', settings.lang);
  }
  if (update.theme !== undefined) {
    settings.theme = update.theme as ThemePreference;
    applyTheme(settings.theme);
  }
  if (update.stats_interval !== undefined) {
    settings.stats_interval = update.stats_interval;
  }
  if (update.inspector_url !== undefined) {
    settings.inspector_url = update.inspector_url;
  }

  notify();
}

/** Apply theme from current settings. Called on app startup. */
export function initTheme(): void {
  applyTheme(settings.theme);
  setLocale(settings.lang);
}
