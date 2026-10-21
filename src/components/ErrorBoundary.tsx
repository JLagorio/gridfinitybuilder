import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { CHUNK_ERROR_MESSAGE, isChunkError } from '../pwa/chunks';

const STORAGE_KEY = 'gridfit-project';

/** Download whatever the browser has saved, so nothing is lost while recovering. */
function downloadSavedProject() {
  let text: string | null = null;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
  if (!text) {
    alert('No saved project found in this browser.');
    return;
  }
  // The saved entry wraps the project as { state, version }; Open project accepts the state.
  let body = text;
  try {
    const parsed = JSON.parse(text) as { state?: Record<string, unknown> };
    if (parsed.state) body = JSON.stringify({ app: 'gridfit', ...parsed.state }, null, 2);
  } catch {
    /* keep the raw text */
  }
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'gridfit-backup.gridfit.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Reset only view state (tab, spread pieces, panes) and reload; the project stays. */
function resetViewAndReload() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text) {
      const saved = JSON.parse(text) as { state?: { ui?: Record<string, unknown> } };
      if (saved.state?.ui) {
        saved.state.ui = { units: saved.state.ui.units, inchPrecision: saved.state.ui.inchPrecision };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      }
    }
  } catch {
    /* fall through to a plain reload */
  }
  location.reload();
}

function clearAndReload() {
  if (!confirm('Delete the project saved in this browser and start over? Download a backup first if you want to keep it.')) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  location.reload();
}

interface Props {
  children: ReactNode;
  /** What failed, for the message ("Gridfit", "The 3D view"). */
  scope?: string;
  /** A small in-place panel instead of a full-page screen. */
  compact?: boolean;
  /** Puts the message in a frame (a dialog's backdrop, lazy.tsx). */
  wrap?: (message: ReactNode) => ReactNode;
}

/**
 * Shows what went wrong instead of a blank page when rendering throws, with
 * ways out that keep the project: retry, reset the view, back it up.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Gridfit] ${this.props.scope ?? 'Gridfit'} crashed:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const scope = this.props.scope ?? 'Gridfit';
    const wrap = this.props.wrap ?? ((m: ReactNode) => m);
    // A part of the app that loads on first use (pwa/chunks.ts) didn't arrive: trying again can't help, a reload can.
    if (isChunkError(error)) {
      return wrap(
        <div className={this.props.compact ? 'crash crash-compact crash-update' : 'crash crash-update'} role="alert">
          <b>{scope} couldn’t load.</b>
          <p>{CHUNK_ERROR_MESSAGE}</p>
          <button className="primary" onClick={() => location.reload()}>
            Reload to update
          </button>
        </div>,
      );
    }
    if (this.props.compact) {
      return wrap(
        <div className="crash crash-compact" role="alert">
          <b>{scope} hit an error.</b>
          <code>{error.message}</code>
          <button className="primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>,
      );
    }
    return (
      <div className="crash" role="alert">
        <h2>{scope} hit an error</h2>
        <p>Your project is still saved in this browser. Try again, or reset the view (tab, spread pieces) and reload.</p>
        <pre>{`${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(1, 8).join('\n')}`}</pre>
        <div className="button-row">
          <button className="primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button onClick={resetViewAndReload}>Reset view and reload</button>
          <button onClick={downloadSavedProject}>Download a backup</button>
          <button className="danger" onClick={clearAndReload}>
            Start over
          </button>
        </div>
      </div>
    );
  }
}

/** Uncaught errors outside React rendering (event handlers, promises), shown on screen. */
export function ErrorBanner() {
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    const add = (msg: string) => setErrors((e) => (e.includes(msg) ? e : [...e.slice(-2), msg]));
    const onError = (e: ErrorEvent) => add(isChunkError(e.error ?? e.message) ? CHUNK_ERROR_MESSAGE : e.message || String(e.error));
    const onRejection = (e: PromiseRejectionEvent) =>
      add(isChunkError(e.reason) ? CHUNK_ERROR_MESSAGE : e.reason instanceof Error ? e.reason.message : String(e.reason));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  if (!errors.length) return null;
  const last = errors[errors.length - 1];
  return (
    <div className="error-banner" role="alert">
      <span>
        <b>Something went wrong:</b> {last}
      </span>
      {last === CHUNK_ERROR_MESSAGE && (
        <button className="primary" onClick={() => location.reload()}>
          Reload
        </button>
      )}
      <button className="link" onClick={() => setErrors([])}>
        Dismiss
      </button>
    </div>
  );
}
