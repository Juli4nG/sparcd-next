const token = (name: string) => `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

// The Tailwind theme of docs/next/LOOK.md. fontSize sits outside `extend` so it replaces
// Tailwind's stock sizes, and each size sets only font-size, leaving line height alone.
export default {
  darkMode: 'class' as const,
  theme: {
    borderRadius: { none: '0', DEFAULT: '0', full: '9999px' },
    fontSize: {
      kicker: '11px',
      chip: '12px',
      small: '14px',
      detail: '18px',
      body: '20px',
      lead: '22px',
      heading: '28px',
      title: '36px',
      hero: '44px',
    },
    extend: {
      colors: Object.fromEntries(
        ['paper', 'paperHover', 'panel', 'panelHover', 'ink', 'inkSoft', 'inkMute', 'rule', 'ruleSoft', 'accent', 'accentSoft', 'warn', 'ok', 'mark'].map(
          (name) => [name, token(name)],
        ),
      ),
      fontFamily: {
        display: ['Newsreader', 'Georgia', 'serif'],
        body: ['"Inter Tight"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
};
