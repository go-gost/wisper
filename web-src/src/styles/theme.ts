import type { ThemePreference } from '../api/types';

// Theme CSS custom properties are injected into document <head> by app.ts.
// This module exports only the theme controller utilities.

// ─── Theme controller ───────────────────────────────────────────────────────

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
