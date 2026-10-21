// First, so the geometry worker (and its WASM download) starts before the rest of the app runs.
import { geometry } from './worker/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App, { prefetchTabs } from './App';
import { ErrorBanner, ErrorBoundary } from './components/ErrorBoundary';
import { UpdateBanner } from './components/UpdateBanner';
import { registerServiceWorker } from './pwa/register';
import './styles.css';
import { projectOf, useStore } from './state/store';
import { planJob } from './lib/project';

// Handy for poking at things from the browser console during development.
if (import.meta.env.DEV) Object.assign(window, { __gridfit: { geometry, useStore, planJob, projectOf } });

// Once the first view is up (its first mesh drawn): the other tabs load in the background, then the
// service worker saves every file for offline use (production builds only). Neither competes with the
// WASM or with drawing; if the geometry never answers, they start anyway after a while.
const firstView = Promise.race([geometry.firstView, new Promise((r) => setTimeout(r, 20_000))]);
registerServiceWorker(firstView.then(prefetchTabs));
// Imported bins' meshes come back from this browser's storage (lib/imported/meshStore.ts), which loads on its own.
void import('./state/meshSync').then((m) => m.startMeshSync(firstView));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <ErrorBanner />
      <UpdateBanner />
    </ErrorBoundary>
  </StrictMode>,
);
