import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const gate = { target: 'http://127.0.0.1:8787', changeOrigin: false };

export default defineConfig({
  base: '/upload/',
  plugins: [react()],
  optimizeDeps: { include: ['exifr'] },
  server: {
    proxy: { '/-': gate, '/sparcd-next-': gate },
  },
});
