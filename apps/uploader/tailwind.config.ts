import type { Config } from 'tailwindcss';
import preset from '../../packages/auth-ui/tailwind.preset';

export default {
  presets: [preset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/auth-ui/src/**/*.{ts,tsx}'],
} satisfies Config;
