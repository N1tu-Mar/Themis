import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f172a',
        surface: '#ffffff',
        muted: '#64748b',
        line: '#e2e8f0',
      },
    },
  },
  plugins: [],
} satisfies Config;
