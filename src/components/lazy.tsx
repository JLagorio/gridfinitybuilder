import { Suspense, lazy, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * Code splitting: what the first screen doesn't show (the other tabs, the
 * compartment and cutout editors, dialogs) loads on first use, so the first
 * download stays small. See README, Development.
 */

/** A loader that starts once and shares its promise (prefetching and rendering use the same one). A failed load starts again next time. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () =>
    (p ??= load().catch((e) => {
      p = null;
      throw e;
    }));
}

/** React.lazy for a named export of a module (the component keeps its own props). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M>(load: () => Promise<M>, name: K): LazyExoticComponent<M[K]> {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

/** Load modules in the background; failures are left for the render that needs them to show. */
export function prefetch(...loads: (() => Promise<unknown>)[]): Promise<void> {
  return Promise.allSettled(loads.map((l) => l())).then(() => undefined);
}

/** A light stand-in while a part loads. */
export function Loading() {
  return (
    <div className="lazy-loading" role="status">
      <span className="spinner" /> Loading…
    </div>
  );
}

/**
 * A part that loads on first use: a light stand-in while it does, and its own
 * error boundary, so a file that fails to load says "Reload to update" in its
 * place instead of blanking the app.
 */
export function LazyPart({ scope, children }: { scope: string; children: ReactNode }) {
  return (
    <ErrorBoundary scope={scope} compact>
      <Suspense fallback={<Loading />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

/** The same for a dialog: the stand-in and the error sit on a backdrop where the dialog will be (a click beside it closes it). */
export function LazyDialog({ scope, onClose, children }: { scope: string; onClose: () => void; children: ReactNode }) {
  const backdrop = (inner: ReactNode) => (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal lazy-dialog">{inner}</div>
    </div>
  );
  return (
    <ErrorBoundary scope={scope} compact wrap={backdrop}>
      <Suspense fallback={backdrop(<Loading />)}>{children}</Suspense>
    </ErrorBoundary>
  );
}
