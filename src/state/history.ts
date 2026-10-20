import type { StoreApi } from 'zustand';

/** The tracked part of the state at one point in time (values are shared, never copied). */
export type Snapshot = Record<string, unknown>;

export interface HistoryOptions<S> {
  /** Keys that make up the undoable document. Re-read on every change, so new fields are picked up. */
  keys: (s: S) => readonly string[];
  /**
   * Whether two snapshots hold the same document. Defaults to comparing every
   * key by reference, which is enough for immutable state.
   */
  equal?: (a: Snapshot, b: Snapshot) => boolean;
  /** Patch applied right after a snapshot is restored (e.g. to drop a stale selection). */
  afterRestore?: (s: S) => Partial<S> | null | undefined;
  /** Steps kept (default 100). */
  limit?: number;
  /** Changes closer together than this are one step: a slider drag, typing (default 400 ms). */
  groupMs?: number;
  now?: () => number;
}

export interface History {
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Forget every step. */
  clear(): void;
  /** Make the next change a new step even if it comes right away. */
  checkpoint(): void;
  /** Apply changes without recording them. */
  silently(fn: () => void): void;
  /** Change notifications, for useSyncExternalStore. */
  subscribe(fn: () => void): () => void;
  getVersion(): number;
}

export function shallowEqual(a: Snapshot, b: Snapshot): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is(a[k], b[k]));
}

/**
 * Undo/redo for a zustand store. It watches the store rather than wrapping
 * `set`, so every action (and plain `setState`) is covered without changes,
 * and only the keys `keys()` names are recorded or restored. Snapshots hold
 * references, which is cheap because the state is immutable.
 */
export function trackHistory<S extends object>(api: StoreApi<S>, o: HistoryOptions<S>): History {
  const limit = o.limit ?? 100;
  const groupMs = o.groupMs ?? 400;
  const now = o.now ?? (() => Date.now());
  const equal = o.equal ?? shallowEqual;
  let past: Snapshot[] = [];
  let future: Snapshot[] = [];
  let lastChange = -Infinity;
  let muted = 0;
  let version = 0;
  const listeners = new Set<() => void>();

  const snap = (s: S): Snapshot => {
    const out: Snapshot = {};
    for (const k of o.keys(s)) out[k] = (s as Record<string, unknown>)[k];
    return out;
  };
  const emit = () => {
    version++;
    for (const l of listeners) l();
  };

  api.subscribe((state, prev) => {
    if (muted || !prev) return;
    const before = snap(prev);
    if (equal(before, snap(state))) return;
    const t = now();
    // Within a burst, the step's "before" is the state ahead of the first change.
    if (!(past.length && t - lastChange < groupMs)) {
      past.push(before);
      if (past.length > limit) past = past.slice(past.length - limit);
    }
    lastChange = t;
    if (future.length) future = [];
    emit();
  });

  const restore = (to: Snapshot) => {
    muted++;
    try {
      api.setState(to as Partial<S>);
      const fix = o.afterRestore?.(api.getState());
      if (fix) api.setState(fix);
    } finally {
      muted--;
    }
    lastChange = -Infinity;
    emit();
  };

  return {
    undo() {
      const to = past.pop();
      if (!to) return false;
      future.push(snap(api.getState()));
      restore(to);
      return true;
    },
    redo() {
      const to = future.pop();
      if (!to) return false;
      past.push(snap(api.getState()));
      restore(to);
      return true;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      past = [];
      future = [];
      lastChange = -Infinity;
      emit();
    },
    checkpoint() {
      lastChange = -Infinity;
    },
    silently(fn) {
      muted++;
      try {
        fn();
      } finally {
        muted--;
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getVersion: () => version,
  };
}
