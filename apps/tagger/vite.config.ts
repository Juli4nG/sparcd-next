import { readFile } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

const GATE = 'http://127.0.0.1:8787';
const LOCAL_CONFIG = new URL('./.local/config.json', import.meta.url);

/**
 * `/config.json` sits at the origin root, outside `base`. Serve the local one
 * when it exists (no-gate dev runs), else a real 404 meaning "gate at this origin".
 */
const originConfig: Plugin = {
  name: 'origin-config',
  configureServer(server) {
    server.middlewares.use('/config.json', (_req, res) => {
      readFile(LOCAL_CONFIG).then(
        (body) => res.setHeader('content-type', 'application/json').end(body),
        () => res.writeHead(404).end(),
      );
    });
  },
};

export default defineConfig({
  base: '/tag/',
  plugins: [originConfig, react()],
  server: {
    port: 5192,
    strictPort: true,
    proxy: { '/-/': GATE, '/sparcd-next-': GATE },
  },
  test: { environment: 'node' },
});
