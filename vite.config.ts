import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // manifold-3d ships its own WASM loader; let Vite serve it untouched.
  optimizeDeps: { exclude: ['manifold-3d'] },
  worker: { format: 'es' },
  server: { port: 5199 },
  // three.js alone is ~600 kB; that's expected for a 3D app.
  build: { chunkSizeWarningLimit: 1500 },
  // Agent worktrees live under .claude/; never pick up their copies of the tests.
  // Geometry tests build real meshes; give them room on a busy machine.
  test: { exclude: ['**/node_modules/**', '.claude/**', 'dist/**'], testTimeout: 60_000 },
});
