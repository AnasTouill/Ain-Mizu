export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Linear mix of two hex colours (t = 0 -> a, 1 -> b). */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

/** Darken (amount < 0) or lighten (amount > 0) a hex colour. */
export function shade(hex: string, amount: number): string {
  return amount < 0 ? mix(hex, '#000000', -amount) : mix(hex, '#ffffff', amount);
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Chart palette for the light (washi) theme: readable on cream, matching the Ain-Mizu brand. */
export const CHART = {
  water: '#1f8096', // observed / planned water (logo teal)
  forecast: '#b7791f', // forecasts, sun, ET0 (ochre)
  sun: '#d99a1e',
  rain: '#6d5bb5', // rain, off-peak tariff (indigo-violet)
  ref: '#7c6bb0', // forecast boundary line
  muted: '#8a8f86', // normals, baselines, comparison plans
  ink: '#3a413c', // labels, tank level
  terracotta: '#c0622f', // energy draw, grid
  danger: '#b42318',
} as const;

/** Recharts tooltip box for the light theme. */
export const CHART_TIP = {
  background: 'rgba(255, 253, 249, 0.97)',
  border: '1px solid rgba(31, 36, 33, 0.12)',
  borderRadius: 10,
  fontSize: 12,
  color: '#1F2421',
  boxShadow: '0 12px 30px -14px rgba(31, 36, 33, 0.45)',
} as const;
