import type { Config } from 'tailwindcss';
import preset from '../../packages/auth-ui/tailwind.preset';

export default {
  presets: [preset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/auth-ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Behind the big photo, dark in either theme, so the letterbox never shows as light edges.
        frame: '#1c1a14',
        frameInk: '#f4ecd8',
      },
    },
  },
} satisfies Config;
