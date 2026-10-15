import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
// tests/openplan.test.ts runs our exporter through OpenPlan3D's real importer. It needs a sibling
// checkout with node_modules (override with OPENPLAN3D_DIR); without one the project is skipped.
const OPENPLAN = process.env.OPENPLAN3D_DIR ?? resolve(here, '../../openplan/openPlan3D-cloud');
const hasOpenPlan = existsSync(resolve(OPENPLAN, 'src/lib/utils/roomplanImport.ts')) && existsSync(resolve(OPENPLAN, 'node_modules'));
const openplanPlugins = hasOpenPlan ? [(await import(resolve(OPENPLAN, 'tooling/catalog-assets.mjs'))).catalogAssets()] : [];

// Offline: writes dist/sw.js from src/sw/sw.js with every built file (the app, its lazy chunks and the
// icons) and a version that changes whenever any of them does. Registered in src/main.ts.
const PUBLIC_SKIP = new Set(['og.png', 'robots.txt']);
function offlinePlugin(): Plugin {
  return {
    name: 'oc3d-offline',
    apply: 'build',
    generateBundle(_options, bundle) {
      const template = readFileSync(resolve(here, 'src/sw/sw.js'), 'utf8');
      const hash = createHash('sha256').update(template);
      const files = Object.keys(bundle).filter((f) => f !== 'index.html' && !f.endsWith('.map')).sort();
      for (const f of files) hash.update(f);
      const html = bundle['index.html'];
      if (html && html.type === 'asset') hash.update(String(html.source));
      const pub = resolve(here, 'public');
      const publicFiles = readdirSync(pub).filter((f) => !f.startsWith('.') && !PUBLIC_SKIP.has(f)).sort();
      for (const f of publicFiles) hash.update(f).update(readFileSync(resolve(pub, f)));
      const urls = ['/', ...publicFiles.map((f) => `/${f}`), ...files.map((f) => `/${f}`)];
      const source = template
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__PRECACHE__', JSON.stringify(urls));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    }
  };
}

export default defineConfig({
  plugins: [svelte(), offlinePlugin()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // three.js and the catalog change on their own schedules: separate chunks keep their long cache.
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (/\/src\/lib\/catalog\/[^/]+\.json$/.test(id)) return 'catalog';
        }
      }
    }
  },
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/**/*.test.ts'], exclude: ['tests/openplan.test.ts'] } },
      ...(hasOpenPlan
        ? [{
            root: OPENPLAN,
            plugins: openplanPlugins,
            resolve: { alias: { $lib: resolve(OPENPLAN, 'src/lib'), '$app/paths': resolve(OPENPLAN, 'tests/fixtures/app-paths.ts') } },
            test: {
              name: 'openplan',
              environment: 'node',
              setupFiles: [resolve(OPENPLAN, 'tests/fixtures/indexeddb.ts')],
              include: [resolve(here, 'tests/openplan.test.ts')]
            }
          }]
        : [])
    ]
  }
});
