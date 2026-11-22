import defaultColors from 'tailwindcss/colors';

/**
 * Ain-Mizu light theme (Japanese minimalism x Tunisian agriculture).
 *
 * The app was written for a dark UI (`bg-ink-*` surfaces, `text-white` / `text-slate-*` text,
 * pale `*-200/300` accents). Instead of rewriting every component, the tokens are remapped here:
 *   - `ink`   -> washi-paper / limestone surfaces (cream, sand)
 *   - `white` -> sumi ink (#1F2421), so `text-white` headings and `bg-white/5` tints stay correct
 *   - `slate` -> warm greys, inverted (100 = darkest text, 900 = lightest surface)
 *   - status palettes (emerald, red, amber...) are mirrored (300 <-> 700) so pale "on dark" text
 *     becomes a readable deep shade on cream, while 500 (buttons, fills) stays the same
 *   - `water` -> Ain-Mizu teal (from the logo), `slime` -> Tunisian terracotta, `olive` -> sage
 * Every colour is a CSS variable (see index.css) so opacity modifiers like `bg-white/10` keep working.
 */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const scale = (name, keys) => Object.fromEntries(keys.map((k) => [k, v(`${name}-${k}`)]));

/** mirror a Tailwind palette: 50<->950, 100<->900, 200<->800, 300<->700, 400<->600 */
const mirror = (p) => ({
  50: p[950], 100: p[900], 200: p[800], 300: p[700], 400: p[600],
  500: p[500], 600: p[400], 700: p[300], 800: p[200], 900: p[100], 950: p[50],
});
const mirrored = Object.fromEntries(
  ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose']
    .map((n) => [n, mirror(defaultColors[n])]),
);

/** @type {import('tailwindcss').Config} */
export default {
  // relative: globs resolve from this file, so the build works from any working directory
  content: { relative: true, files: ['./index.html', './src/**/*.{ts,tsx}'] },
  theme: {
    extend: {
      colors: {
        ...mirrored,
        white: v('white'),
        black: v('black'),
        paper: v('paper'),
        ink: scale('ink', [950, 900, 850, 800, 700, 600]),
        slate: scale('slate', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        water: scale('water', [100, 200, 300, 400, 500, 600]),
        slime: scale('slime', [100, 200, 300, 400, 500]),
        olive: scale('olive', [300, 400, 500, 600]),
        stress: { green: '#2e9e4f', yellow: '#f2c230', orange: '#f08a24', red: '#d62f2f' },
      },
      fontFamily: {
        display: ['"Zen Kaku Gothic New"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        serif: ['"Shippori Mincho"', '"Noto Naskh Arabic"', 'Georgia', 'serif'],
        sans: ['Inter', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 8px 24px -10px rgba(26, 122, 142, 0.55)',
        'glow-gold': '0 8px 24px -10px rgba(192, 98, 47, 0.55)',
        panel: '0 1px 2px rgba(31, 36, 33, 0.04), 0 12px 32px -18px rgba(31, 36, 33, 0.22)',
        lift: '0 2px 4px rgba(31, 36, 33, 0.05), 0 20px 40px -22px rgba(31, 36, 33, 0.35)',
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        aurora: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(4%, -3%, 0) scale(1.08)' },
        },
        'fade-up': { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
        float: 'float 5s ease-in-out infinite',
        'spin-slow': 'spin-slow 14s linear infinite',
        aurora: 'aurora 18s ease-in-out infinite',
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};
