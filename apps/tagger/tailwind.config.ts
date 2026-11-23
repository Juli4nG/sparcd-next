import type { Config } from 'tailwindcss';

const token = (name: string) => `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/auth-ui/src/**/*.{ts,tsx}'],
  theme: {
    borderRadius: { none: '0', DEFAULT: '0', full: '9999px' },
    extend: {
      colors: {
        ...Object.fromEntries(
          ['paper', 'paperHover', 'panel', 'panelHover', 'ink', 'inkSoft', 'inkMute', 'rule', 'ruleSoft', 'accent', 'accentSoft', 'warn', 'ok', 'mark'].map(
            (name) => [name, token(name)],
          ),
        ),
        // Behind the big photo, dark in either theme, so the letterbox never shows as light edges.
        frame: '#1c1a14',
        frameInk: '#f4ecd8',
      },
      fontFamily: {
        display: ['Newsreader', 'Georgia', 'serif'],
        body: ['"Inter Tight"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
} satisfies Config;
