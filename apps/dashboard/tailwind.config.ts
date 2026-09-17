import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B1220',
        paper: '#F7F7F4',
        line: '#DFE1DA',
        muted: '#6B7280',
        trust: {
          DEFAULT: '#1F6F5C',
          soft: '#EAF3F0',
        },
        flag: {
          DEFAULT: '#9A5B12',
          soft: '#FBF1E3',
        },
        alert: {
          DEFAULT: '#9F1D35',
          soft: '#FBEAEC',
        },
      },
      fontFamily: {
        sans: ['var(--font-plex-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
