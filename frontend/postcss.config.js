import { fileURLToPath } from 'node:url';

// Absolute path to the Tailwind config (works whatever the working directory is, including non-ASCII paths).
const config = fileURLToPath(new URL('./tailwind.config.js', import.meta.url));

export default {
  plugins: {
    tailwindcss: { config },
    autoprefixer: {},
  },
};
