import type { Lang } from '../types';

export const LOCALES: Record<Lang, string> = { fr: 'fr-FR', en: 'en-GB', ar: 'ar-TN' };

export function monthIndex(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return y * 12 + (m - 1);
}

export function addMonths(month: string, k: number): string {
  const idx = monthIndex(month) + k;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  for (let i = monthIndex(first); i <= monthIndex(last); i++) out.push(addMonths(first, i - monthIndex(first)));
  return out;
}

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(lang: Lang, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALES[lang], { timeZone: 'UTC', ...opts });
    cache.set(key, f);
  }
  return f;
}

/** '2026-08' -> 'août 2026' / 'Aug 2026' / 'أوت 2026' */
let override: { key: string; label: (lang: Lang) => string } | null = null;
/** Real pipeline: the forecast month key stands for next week; show that instead of a month name. */
export function setMonthOverride(key: string, label: (lang: Lang) => string) {
  override = { key, label };
}

export function formatMonth(month: string, lang: Lang, style: 'short' | 'long' = 'short'): string {
  if (!month) return '';
  if (override && month === override.key) return override.label(lang);
  const [y, m] = month.split('-').map(Number);
  return fmt(lang, { month: style, year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, 15)));
}

export function formatMonthOnly(month: string, lang: Lang): string {
  const [y, m] = month.split('-').map(Number);
  return fmt(lang, { month: 'short' }).format(new Date(Date.UTC(y, m - 1, 15)));
}

export function formatDate(date: string, lang: Lang): string {
  const [y, m, d] = date.split('-').map(Number);
  return fmt(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(d).padStart(2, '0')}`;
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
