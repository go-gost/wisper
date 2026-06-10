import { css } from 'lit';
import type { ThemePreference } from '../api/types';

// ─── CSS custom properties ───────────────────────────────────────────────────

export const themeStyles = css`
  :root {
    /* Colors — Light */
    --color-bg: #fafafa;
    --color-surface: #ffffff;
    --color-surface-hover: #f0f0f0;
    --color-text-primary: #1a1a1a;
    --color-text-secondary: #666666;
    --color-text-muted: #999999;
    --color-border: #e0e0e0;
    --color-divider: #eeeeee;

    /* Brand */
    --color-primary: #3f51b5;
    --color-primary-hover: #303f9f;
    --color-primary-text: #ffffff;

    /* Status */
    --color-running: #4caf50;
    --color-stopped: #9e9e9e;
    --color-error: #f44336;
    --color-error-bg: #ffebee;

    /* Sizing */
    --max-content-width: 800px;
    --radius-sm: 6px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --radius-pill: 24px;

    /* Shadows */
    --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.08);
    --shadow-card-hover: 0 2px 8px rgba(0, 0, 0, 0.12);

    /* Transitions */
    --transition-fast: 150ms ease;
    --transition-normal: 250ms ease;

    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 15px;
    line-height: 1.5;
    color: var(--color-text-primary);
    background: var(--color-bg);
  }

  /* Dark theme */
  :root.dark {
    --color-bg: #121212;
    --color-surface: #1e1e1e;
    --color-surface-hover: #2c2c2c;
    --color-text-primary: #e0e0e0;
    --color-text-secondary: #a0a0a0;
    --color-text-muted: #707070;
    --color-border: #333333;
    --color-divider: #2a2a2a;

    --color-primary: #7986cb;
    --color-primary-hover: #5c6bc0;
    --color-primary-text: #ffffff;

    --color-error-bg: #3e1015;

    --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.3);
    --shadow-card-hover: 0 2px 8px rgba(0, 0, 0, 0.5);
  }

  /* Reset */
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
