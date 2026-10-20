import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { geometry } from './worker/client';
import { projectOf, useStore } from './state/store';
import { planJob } from './lib/project';

// Handy for poking at things from the browser console during development.
if (import.meta.env.DEV) Object.assign(window, { __gridfit: { geometry, useStore, planJob, projectOf } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
