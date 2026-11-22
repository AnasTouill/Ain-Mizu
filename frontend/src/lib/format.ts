import type { Lang } from '../types';
import { LOCALES } from './months';

const cache = new Map<string, Intl.NumberFormat>();

export function fmtNumber(value: number | null | undefined, lang: Lang, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  const key = `${lang}|${digits}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALES[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits });
    cache.set(key, f);
  }
  return f.format(value);
}

export const fmtPct = (v: number | null | undefined, lang: Lang, digits = 0) =>
  v === null || v === undefined ? '–' : `${fmtNumber(v, lang, digits)} %`;

export const fmtKm = (meters: number, lang: Lang) => `${fmtNumber(meters / 1000, lang, 1)} km`;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
