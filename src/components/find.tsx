import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { allEntries, basicIds, hitTitles, searchIndex, visibleIds, type FindEntry } from '../lib/panelSearch';
import { usePanelView } from '../state/panelView';
import { FindContext, useFindState, type FindState } from './findContext';
import { Segmented } from './fields';
import './panels.css';

/**
 * The top of a side panel: "Find a setting" and the Basic / All settings
 * switch. Its children are the panel's sections, which show or hide
 * themselves from the index (Section `find`, Group `find`, `<Find>`).
 */
export function FindPanel({ index, placeholder, children }: { index: readonly FindEntry[]; placeholder: string; children: ReactNode }) {
  const [query, setQuery] = useState('');
  const view = usePanelView((s) => s.view);
  const setView = usePanelView((s) => s.setView);
  const result = useMemo(() => searchIndex(index, query), [index, query]);
  const basicOf = useMemo(() => basicIds(index), [index]);
  const titleOf = useMemo(() => new Map([...allEntries(index)].map((e) => [e.id, e.title])), [index]);

  // The entries on the panel right now (they tell us as they mount), so a search only shows what this bin or setup has.
  const present = useRef(new Map<string, number>());
  const [presentVersion, setPresentVersion] = useState(0);
  const searchingNow = useRef(false);
  searchingNow.current = !!result;
  const mount = useCallback((id: string) => {
    const m = present.current;
    m.set(id, (m.get(id) ?? 0) + 1);
    // Only a search depends on it: no extra render otherwise.
    if (searchingNow.current) setPresentVersion((v) => v + 1);
    return () => {
      const n = (m.get(id) ?? 1) - 1;
      if (n > 0) m.set(id, n);
      else m.delete(id);
      if (searchingNow.current) setPresentVersion((v) => v + 1);
    };
  }, []);
  const visible = useMemo(
    () => (result ? visibleIds(index, result, new Set(present.current.keys())) : null),
    // `presentVersion`: the entries on the panel changed.
    [index, result, presentVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const state = useMemo<FindState>(
    () => ({ result, visible, basic: view === 'basic', basicOf, titleOf, showAll: () => setView('all'), mount }),
    [result, visible, view, basicOf, titleOf, setView, mount],
  );

  // Searching starts at the top; clearing it goes back to where the panel was scrolled.
  const bar = useRef<HTMLDivElement>(null);
  const scrolled = useRef<number | null>(null);
  const searching = !!result;
  const type = (text: string) => {
    // Before the panel shrinks to the matches (which would clamp the scroll).
    if (scrolled.current === null && text.trim()) scrolled.current = bar.current?.closest('.sidebar')?.scrollTop ?? 0;
    setQuery(text);
  };
  // The panels share one scrolling sidebar: each tab's panel starts at its top, not where the last one was left.
  useLayoutEffect(() => {
    const scroller = bar.current?.closest('.sidebar');
    if (scroller) scroller.scrollTop = 0;
  }, []);
  useLayoutEffect(() => {
    const scroller = bar.current?.closest('.sidebar');
    if (!scroller) return;
    if (searching) scroller.scrollTop = 0;
    else if (scrolled.current !== null) {
      scroller.scrollTop = scrolled.current;
      scrolled.current = null;
    }
  }, [searching]);

  // Nothing on the panel matches: say so, and where the matches would be.
  const empty = !!visible && ![...present.current.keys()].some((id) => visible.has(id));
  const elsewhere = empty && result ? hitTitles(index, result) : [];

  return (
    <FindContext.Provider value={state}>
      <div className="panel-find" ref={bar} role="search">
        <div className="input-wrap panel-find-input">
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="m13 13 4 4" />
          </svg>
          <input
            type="search"
            value={query}
            placeholder={placeholder}
            aria-label="Find a setting"
            title="Type a setting or what it’s for (magnets, lip, label, scoop…) to see only what matches. Esc clears it."
            spellCheck={false}
            onChange={(e) => type(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                setQuery('');
                e.stopPropagation();
              }
            }}
          />
          {query && (
            <button type="button" className="panel-find-clear" aria-label="Clear the search" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </div>
        <Segmented
          ariaLabel="Settings shown"
          value={view}
          options={[
            { value: 'basic', label: 'Basic', title: 'The settings most bins and drawers need, plus anything you have changed' },
            { value: 'all', label: 'All', title: 'Every setting' },
          ]}
          onChange={setView}
        />
      </div>
      {empty && (
        <div className="panel-find-empty">
          <p>No setting here matches “{query.trim()}”.</p>
          {elsewhere.map((h) => (
            <p key={h.title} className="muted small">
              {h.title}
              {h.when ? ` shows ${h.when}.` : ' isn’t shown here right now.'}
            </p>
          ))}
        </div>
      )}
      {children}
    </FindContext.Provider>
  );
}

/** "A, B and C". */
const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? ''));

/**
 * In the Basic view, what a section leaves out (the entries `ids` that aren't
 * set), with a switch to All settings. Nothing when everything shows.
 */
export function MoreInAll({ ids }: { ids: [id: string, set: boolean][] }) {
  const f = useFindState();
  if (!f || f.result || !f.basic) return null;
  const hidden = ids.filter(([id, set]) => !set && f.basicOf.get(id) === false).map(([id]) => f.titleOf.get(id) ?? id);
  if (!hidden.length) return null;
  return (
    <div className="more-in-all">
      More in{' '}
      <button type="button" className="link" onClick={f.showAll}>
        All settings
      </button>
      : {list(hidden)}.
    </div>
  );
}
