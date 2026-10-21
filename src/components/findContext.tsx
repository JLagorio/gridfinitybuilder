import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
import type { FindResult } from '../lib/panelSearch';

/**
 * What a panel's sections and fields need to know to show or hide themselves:
 * the search (lib/panelSearch.ts) and the Basic / All view. Provided by
 * FindPanel (find.tsx); without it everything shows, so the fields work anywhere.
 *
 * Hidden entries stay mounted (`hidden`), so a search or the Basic view never
 * resets what's open or typed, and each one tells the panel it's there, so a
 * search only counts the fields this bin or setup actually has.
 */
export interface FindState {
  /** The search, or null when nothing is typed. */
  result: FindResult | null;
  /** While searching: the ids that show. */
  visible: ReadonlySet<string> | null;
  /** The Basic view is on. */
  basic: boolean;
  /** Whether each entry is in the Basic view, by id. */
  basicOf: ReadonlyMap<string, boolean>;
  /** Entry titles, by id. */
  titleOf: ReadonlyMap<string, string>;
  /** Switch to All settings. */
  showAll: () => void;
  /** An entry is on the panel; returns its removal. */
  mount: (id: string) => () => void;
}

export const FindContext = createContext<FindState | null>(null);

export interface FindVisibility {
  show: boolean;
  /** A search is on: groups that show open, so the match is in sight. */
  searching: boolean;
}

const ALWAYS: FindVisibility = { show: true, searching: false };

/**
 * Whether the entry `id` shows: while searching, when it (or something in it,
 * or a group it's in) matches; in the Basic view, when it's a basic entry or
 * `set` (something in it isn't the default); in All settings, always.
 */
export function useFind(id?: string, set = false): FindVisibility {
  const c = useContext(FindContext);
  const mount = c?.mount;
  useLayoutEffect(() => (id && mount ? mount(id) : undefined), [id, mount]);
  // Not in the index (a fold inside a field): shows with whatever it's in, and keeps its own state.
  if (!c || !id) return ALWAYS;
  if (c.visible) return { show: c.visible.has(id), searching: true };
  if (!c.basic) return ALWAYS;
  return { show: set || c.basicOf.get(id) !== false, searching: false };
}

/** Its children, hidden when the entry `id` doesn't show (see useFind). Without an id it always shows. */
export function Find({ id, set, children }: { id?: string; set?: boolean; children: ReactNode }) {
  const { show } = useFind(id, set);
  // `display: contents`, so the children lay out as if the wrapper weren't there.
  return (
    <div className="find-wrap" hidden={!show}>
      {children}
    </div>
  );
}

/** The panel's find state (null outside a FindPanel). */
export const useFindState = () => useContext(FindContext);
