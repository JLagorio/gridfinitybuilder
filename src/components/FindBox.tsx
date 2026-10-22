import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { allDrawers, useStore } from '../state/store';
import { searchInventory, type FindResult } from '../lib/inventory';
import { MOD, isMod, isTyping, keyLetter } from './shortcuts';
import { clearInteriorSelection, selectCompartment } from './interiorState';

/** Text with the matched ranges in <mark>. */
export function Marked({ text, marks }: { text: string; marks: [number, number][] }) {
  const out: (string | React.ReactElement)[] = [];
  let at = 0;
  marks.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(<mark key={i}>{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/** Briefly pulse the selected bin in the layout and 3D view (CSS in the inventory section of styles.css). */
export function flashSelection() {
  const b = document.body;
  b.classList.remove('find-flash');
  void b.offsetWidth;
  b.classList.add('find-flash');
  window.setTimeout(() => b.classList.remove('find-flash'), 1800);
}

/** Show a search result: its drawer, the Bins tab, the bin selected (and its compartment); a board's attachment selected on its Attachments tab. */
export function goToResult(r: Pick<FindResult, 'drawerId' | 'binId' | 'compKey' | 'attachmentId'>) {
  if (r.attachmentId) {
    useStore.getState().switchDrawer(r.drawerId);
    useStore.getState().setUI({ tab: 'bins', selectedAttachment: r.attachmentId });
    flashSelection();
    return;
  }
  useStore.getState().locateBin(r.drawerId, r.binId);
  if (r.binId && r.compKey) selectCompartment(r.binId, r.compKey);
  else clearInteriorSelection();
  if (r.binId) flashSelection();
}

const KIND: Record<FindResult['kind'], string> = { label: 'Label', contents: '', tool: 'Tool', drawer: 'Drawer', part: '' };

/** Top-bar search over every drawer: what's in the bins, labels, compartments, tools, drawer names. Ctrl/⌘ K or /. */
export function FindBox() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const ws = useStore(
    useShallow((s) => ({ drawers: s.drawers, activeDrawerId: s.activeDrawerId, drawer: s.drawer, baseplate: s.baseplate, bins: s.bins })),
  );
  const results = useMemo(
    () => (open && q.trim() ? searchInventory(allDrawers(ws), q, { activeDrawerId: ws.activeDrawerId, limit: 40 }) : []),
    [open, q, ws],
  );
  const binCount = useMemo(() => (open ? allDrawers(ws).reduce((t, d) => t + d.bins.length, 0) : 0), [open, ws]);
  // Parts on Skådis boards, searched too.
  const partCount = useMemo(() => (open ? allDrawers(ws).reduce((t, d) => t + (d.drawer.attachments?.length ?? 0), 0) : 0), [open, ws]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, results]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while a dialog covers the top bar (drawer map, contents list, shortcuts).
      if (document.querySelector('[aria-modal="true"]')) return;
      const k = keyLetter(e);
      const slash = e.key === '/' && !isMod(e) && !e.altKey && !isTyping(e.target);
      if ((isMod(e) && !e.shiftKey && !e.altKey && k === 'k') || slash) {
        e.preventDefault();
        e.stopPropagation();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const go = (r: FindResult | undefined) => {
    if (!r) return;
    goToResult(r);
    setOpen(false);
    input.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (results.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === 'Escape') {
      // First Esc clears the search, the next leaves the box.
      e.preventDefault();
      e.stopPropagation();
      if (q) setQ('');
      else input.current?.blur();
    }
  };

  const showList = open;

  return (
    <div className={`find-box ${open ? 'open' : ''}`} title={open ? undefined : `Find what's in your bins (${MOD} K or /)`}>
      <div
        className="find-input"
        onMouseDown={(e) => {
          // The whole box focuses the field (it's only a magnifier in narrow windows).
          if (e.target !== input.current) {
            e.preventDefault();
            input.current?.focus();
          }
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          type="search"
          value={q}
          placeholder="Find…"
          aria-label="Find what's in your bins, in every drawer"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
          spellCheck={false}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {!q && !open && (
          <span className="find-keys" aria-hidden>
            <kbd>{MOD}</kbd>
            <kbd>K</kbd>
          </span>
        )}
      </div>
      {showList && (
        // Mouse down here would blur the input (and close the list) before the click lands.
        <div className="find-results" onMouseDown={(e) => e.preventDefault()}>
          {!q.trim() ? (
            <p className="find-empty">
              Search what&apos;s in the bins, their labels, compartments, tool cutouts and drawer names, in all {ws.drawers.length} drawer
              {ws.drawers.length === 1 ? '' : 's'} ({binCount} bins{partCount ? `, ${partCount} parts on boards` : ''}). List a bin&apos;s contents in the Bins
              tab under &ldquo;What&apos;s in it&rdquo;.
            </p>
          ) : results.length ? (
            <ul id={listId} role="listbox" ref={list}>
              {results.map((r, i) => (
                <li
                  key={r.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'active' : ''}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => go(r)}
                >
                  <div className="find-path">
                    <span>{r.drawerName}</span>
                    {r.bin && (
                      <>
                        <span className="find-sep">›</span>
                        <span>{r.bin}</span>
                      </>
                    )}
                    {r.pos && <span className="find-pos">{r.pos}</span>}
                    {KIND[r.kind] && <span className="find-kind">{KIND[r.kind]}</span>}
                  </div>
                  <div className="find-text">
                    {r.comp && r.comp !== r.text && <span className="find-comp">{r.comp}: </span>}
                    <Marked text={r.text} marks={r.marks} />
                    {r.more > 0 && <small> +{r.more} more</small>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="find-empty">
              Nothing matches &ldquo;{q.trim()}&rdquo;. Every word has to match; try fewer.
            </p>
          )}
          {results.length > 0 && (
            <div className="find-foot">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> choose
              </span>
              <span>
                <kbd>Enter</kbd> show it
              </span>
              <span>
                <kbd>Esc</kbd> clear
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
