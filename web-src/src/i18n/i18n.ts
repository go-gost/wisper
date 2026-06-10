import type { LanguagePreference } from '../api/types';
import en from './en';
import zh from './zh';

const locales: Record<string, Record<string, string>> = { en, zh };

let currentLocale = 'en';
const listeners = new Set<(locale: string) => void>();

export function t(key: string, params?: Record<string, string | number>): string {
  let value = locales[currentLocale]?.[key] ?? locales['en']?.[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(`{${k}}`, String(v));
    }
  }

  return value;
}

export function setLocale(locale: LanguagePreference): void {
  currentLocale = locale;
  document.documentElement.lang = locale;
  for (const fn of listeners) {
    fn(locale);
  }
}

export function getLocale(): string {
  return currentLocale;
}

/** Subscribe to locale changes. Returns an unsubscribe function. */
export function onLocaleChange(fn: (locale: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
