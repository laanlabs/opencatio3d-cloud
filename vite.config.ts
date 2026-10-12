import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

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
    include: ['tests/**/*.test.ts']
  }
});
