import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const gate = { target: 'http://127.0.0.1:8787', changeOrigin: false };
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: '/upload/',
  plugins: [react()],
  optimizeDeps: { include: ['exifr'] },
  resolve: {
    alias: {
      '@sparcd/bucket': local('./standin/bucket/index.ts'),
      '@sparcd/camtrap': local('../../packages/camtrap/src/index.ts'),
    },
  },
  server: {
    port: 5320,
    proxy: { '/-': gate, '/sparcd-next-': gate },
  },
});
