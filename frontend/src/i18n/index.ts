import { useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Lang } from '../types';
import { ar } from './ar';
import { en, type TKey } from './en';
import { fr } from './fr';

export type { TKey };

const DICTS: Record<Lang, Record<TKey, string>> = { en, fr, ar };

export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  let s: string = DICTS[lang]?.[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** `const t = useT(); t('nav.dashboard')` - re-renders when the language changes. */
export function useT() {
  const lang = useAppStore((s) => s.lang);
  return useCallback((key: TKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
}

export const useLang = (): Lang => useAppStore((s) => s.lang);

export const LANGS: { id: Lang; label: string; native: string }[] = [
  { id: 'fr', label: 'FR', native: 'Français' },
  { id: 'en', label: 'EN', native: 'English' },
  { id: 'ar', label: 'AR', native: 'العربية' },
];
