import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function serviceWorkerVersion(): Plugin {
  return {
    name: 'service-worker-version',
    apply: 'build',
    async writeBundle(options, bundle) {
      const build = createHash('sha256').update(Object.keys(bundle).sort().join()).digest('hex');
      const file = join(options.dir ?? 'dist/ui', 'sw.js');
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.replace('__BUILD__', build.slice(0, 12)));
    },
  };
}

export default defineConfig({
  root: 'ui',
  plugins: [react(), serviceWorkerVersion()],
  build: { outDir: '../dist/ui', emptyOutDir: true },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.ts.net'],
    proxy: { '^/api/': 'http://localhost:3000' },
  },
});
