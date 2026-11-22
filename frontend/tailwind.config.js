/** @type {import('tailwindcss').Config} */
export default {
  // relative: globs resolve from this file, so the build works from any working directory
  content: { relative: true, files: ['./index.html', './src/**/*.{ts,tsx}'] },
  theme: {
    extend: {
      colors: {
        ink: { 950: '#04070f', 900: '#070c18', 850: '#0a1120', 800: '#0d1628', 700: '#142039', 600: '#1d2b4a' },
        water: { 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7' },
        slime: { 200: '#fef08a', 300: '#fde047', 400: '#facc15', 500: '#eab308' },
        stress: { green: '#2e9e4f', yellow: '#f2c230', orange: '#f08a24', red: '#d62f2f' },
      },
      fontFamily: {
        display: ['"Space Grotesk"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        sans: ['Inter', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 36px -6px rgba(56, 189, 248, 0.45)',
        'glow-gold': '0 0 36px -6px rgba(250, 204, 21, 0.45)',
        panel: '0 18px 50px -20px rgba(0, 0, 0, 0.75)',
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        aurora: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(4%, -3%, 0) scale(1.08)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
        float: 'float 5s ease-in-out infinite',
        'spin-slow': 'spin-slow 14s linear infinite',
        aurora: 'aurora 18s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
