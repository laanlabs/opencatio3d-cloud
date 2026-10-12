import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
// tests/openplan.test.ts runs our exporter through OpenPlan3D's real importer. It needs a sibling
// checkout with node_modules (override with OPENPLAN3D_DIR); without one the project is skipped.
const OPENPLAN = process.env.OPENPLAN3D_DIR ?? resolve(here, '../../openplan/openPlan3D-cloud');
const hasOpenPlan = existsSync(resolve(OPENPLAN, 'src/lib/utils/roomplanImport.ts')) && existsSync(resolve(OPENPLAN, 'node_modules'));
const openplanPlugins = hasOpenPlan ? [(await import(resolve(OPENPLAN, 'tooling/catalog-assets.mjs'))).catalogAssets()] : [];

export default defineConfig({
  plugins: [svelte()],
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
