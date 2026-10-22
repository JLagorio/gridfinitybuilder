import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { gridfitServiceWorker } from './scripts/pwa.ts';
import { preloadSavedTab } from './scripts/preload.ts';

export default defineConfig({
  plugins: [
    react(),
    // The service worker for offline use is written from the build output (production builds only).
    gridfitServiceWorker(),
    // A returning visitor's saved tab (state/store.ts) gets its code-split panel preloaded (scripts/preload.ts).
    preloadSavedTab({ storageKey: 'gridfit-project', tabs: { bins: ['src/components/BinPanel.tsx'], print: ['src/components/PrintPanel.tsx'] } }),
  ],
  // manifold-3d ships its own WASM loader; let Vite serve it untouched.
  optimizeDeps: { exclude: ['manifold-3d'] },
  worker: { format: 'es' },
  server: { port: 5199 },
  build: {
    rolldownOptions: {
      output: {
        // Libraries in chunks of their own: they change less often than the app, so a deploy
        // doesn't make browsers download them again.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/ },
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
    // The biggest chunk is three.js (~560 kB, nearly all of it what WebGLRenderer needs); the first
    // screen's own code is ~460 kB in a few chunks (tests/bundle.test.ts keeps it there).
    chunkSizeWarningLimit: 600,
  },
  // Agent worktrees live under .claude/; never pick up their copies of the tests.
  // Geometry tests build real meshes; give them room on a busy machine.
  // Every attachment kind registered (the app loads them on demand, lib/wall/ready.ts).
  test: { exclude: ['**/node_modules/**', '.claude/**', 'dist/**'], testTimeout: 60_000, setupFiles: ['tests/setup.ts'] },
});
