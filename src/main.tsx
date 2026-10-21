import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBanner, ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';
import { geometry } from './worker/client';
import { projectOf, useStore } from './state/store';
import { planJob } from './lib/project';

// Handy for poking at things from the browser console during development.
if (import.meta.env.DEV) Object.assign(window, { __gridfit: { geometry, useStore, planJob, projectOf } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <ErrorBanner />
    </ErrorBoundary>
  </StrictMode>,
);
