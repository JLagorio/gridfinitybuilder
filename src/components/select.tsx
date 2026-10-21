/**
 * The side panels' pick lists, drawn by hand instead of the browser's own so
 * they look and behave the same everywhere (fields.tsx Select wraps
 * SelectButton in a Field):
 *
 * - SelectButton: a button showing the current option that opens the list
 *   (the WAI-ARIA APG "select-only combobox"). Focus stays on the button.
 * - combobox.tsx: a text box that filters a long list as you type, by label,
 *   group and keywords (APG combobox with list autocomplete). It shares the
 *   list and its placement from here, and loads with the panels that use it.
 *
 * The list opens in a fixed layer on top of everything (a portal), so a
 * scrolling side panel doesn't clip it. It opens below the field, or above
 * when there's more room there, stays inside the screen (above a phone's
 * keyboard), follows the field when the panel scrolls and closes when the
 * field scrolls out of sight. Rows are finger-sized on touch screens.
 * Grouping, filtering and keys: lib/pickList.ts.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { TYPEAHEAD_MS, firstEnabled, groupOptions, moveActive, selectKey, typeahead, type PickGroup, type PickOption } from '../lib/pickList';
import './select.css';

/** Space between the field and its list, and kept clear at the screen's edges (px). */
const GAP = 4;
const EDGE = 8;
/** Tallest and widest the list gets (px). */
const MAX_H = 400;
const MAX_W = 480;

/** The part of the page on screen: the visual viewport, which on a phone ends at the keyboard. */
function onScreen() {
  const v = window.visualViewport;
  return v
    ? { top: v.offsetTop, left: v.offsetLeft, bottom: v.offsetTop + v.height, right: v.offsetLeft + v.width }
    : { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
}

/** Whether a field can be seen: laid out, and its middle not scrolled out of a scrolling panel or off the page. */
function inSight(el: Element, r: DOMRect): boolean {
  if (!r.width && !r.height) return false;
  const mid = (r.top + r.bottom) / 2;
  let top = 0;
  let bottom = window.innerHeight;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).overflowY === 'visible') continue;
    const pr = p.getBoundingClientRect();
    top = Math.max(top, pr.top);
    bottom = Math.min(bottom, pr.bottom);
  }
  return mid >= top && mid <= bottom;
}

/** Scroll the list so the option `el` shows (`center`: in the middle, as the list opens). */
function reveal(list: HTMLElement, el: HTMLElement, center: boolean) {
  // The first option of a group brings its heading along.
  const prev = el.previousElementSibling as HTMLElement | null;
  const top = (prev?.classList.contains('pick-group-label') ? prev : el).offsetTop;
  const bottom = el.offsetTop + el.offsetHeight;
  if (center) list.scrollTop = el.offsetTop - (list.clientHeight - el.offsetHeight) / 2;
  else if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

/** Where the list goes: in the dialog the field is in (so it stays part of it for screen readers), else the page. */
export const layerFor = (el: Element | null) => (el?.closest('[aria-modal="true"]') as HTMLElement | null) ?? document.body;

/**
 * The open list's placement and dismissal: placed against `anchor` on open and
 * on every render (filtering changes its height), again on scroll and resize;
 * closed by a press outside `anchor` and the list, or when the field goes out of sight.
 */
export function usePopup(open: boolean, id: string, anchor: RefObject<HTMLElement | null>, pop: RefObject<HTMLElement | null>, close: () => void) {
  const side = useRef<'below' | 'above'>('below');
  const was = useRef(false);
  const closeRef = useRef(close);
  closeRef.current = close;
  const place = useRef((rethink: boolean) => {
    const a = anchor.current;
    const p = pop.current;
    if (!a || !p) return;
    const r = a.getBoundingClientRect();
    if (!inSight(a, r)) {
      closeRef.current();
      return;
    }
    const v = onScreen();
    const below = v.bottom - r.bottom - GAP - EDGE;
    const above = r.top - v.top - GAP - EDGE;
    const want = Math.min(MAX_H, p.scrollHeight + p.offsetHeight - p.clientHeight);
    // The side is chosen as it opens and when the screen changes, not while typing filters the list.
    if (rethink) side.current = below >= want || below >= above ? 'below' : 'above';
    const h = Math.max(0, Math.min(want, side.current === 'below' ? below : above));
    const s = p.style;
    s.maxHeight = `${h}px`;
    s.top = `${side.current === 'below' ? r.bottom + GAP : r.top - GAP - h}px`;
    s.minWidth = `${Math.min(r.width, v.right - v.left - 2 * EDGE)}px`;
    s.maxWidth = `${Math.min(Math.max(r.width, MAX_W), v.right - v.left - 2 * EDGE)}px`;
    s.left = `${Math.max(v.left + EDGE, Math.min(r.left, v.right - EDGE - p.offsetWidth))}px`;
    p.dataset.side = side.current;
  }).current;

  useLayoutEffect(() => {
    if (open) place(!was.current);
    was.current = open;
  });

  useEffect(() => {
    if (!open) return;
    const scrolled = (e: Event) => {
      // The list's own scrolling (and the text box's) moves nothing.
      if (e.target instanceof Node && (pop.current?.contains(e.target) || anchor.current?.contains(e.target))) return;
      place(false);
    };
    const resized = () => place(true);
    const pressed = (e: PointerEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || anchor.current?.contains(t)) return;
      // The field's own label opens it again with its click.
      if (t instanceof Element && (t.closest('label') as HTMLLabelElement | null)?.htmlFor === id) return;
      closeRef.current();
    };
    const vv = window.visualViewport;
    document.addEventListener('scroll', scrolled, true);
    document.addEventListener('pointerdown', pressed, true);
    window.addEventListener('resize', resized);
    vv?.addEventListener('resize', resized);
    vv?.addEventListener('scroll', scrolled);
    // Hidden by a search or the Basic view, or moved by what's above it growing.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place(false));
    if (anchor.current) ro?.observe(anchor.current);
    return () => {
      document.removeEventListener('scroll', scrolled, true);
      document.removeEventListener('pointerdown', pressed, true);
      window.removeEventListener('resize', resized);
      vv?.removeEventListener('resize', resized);
      vv?.removeEventListener('scroll', scrolled);
      ro?.disconnect();
    };
  }, [open, id, anchor, pop, place]);
}

/** Keeps the active option in view as it moves (centred as the list opens); `list` changes when filtering does. */
export function useReveal(open: boolean, pop: RefObject<HTMLElement | null>, activeId: string | undefined, list?: unknown) {
  const shown = useRef(false);
  useLayoutEffect(() => {
    const el = activeId ? document.getElementById(activeId) : null;
    if (open && pop.current && el) reveal(pop.current, el, !shown.current);
    shown.current = open;
  }, [open, pop, activeId, list]);
}

export function Chevron() {
  return (
    <svg className="pick-chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 4.5 3 3 3-3" />
    </svg>
  );
}

export const optionId = (listId: string, i: number) => `${listId}-${i}`;

/** The list itself: groups with their headings, the current value ticked, the active one highlighted. */
export function OptionList<T extends string>({
  id,
  labelId,
  groups,
  value,
  active,
  onPick,
  onHover,
}: {
  id: string;
  labelId: string;
  groups: PickGroup<PickOption<T>>[];
  value: T;
  active: number;
  onPick: (i: number) => void;
  onHover: (i: number) => void;
}) {
  let i = 0;
  const row = (o: PickOption<T>) => {
    const k = i++;
    const on = o.value === value;
    return (
      <div
        key={o.value}
        id={optionId(id, k)}
        role="option"
        aria-selected={on}
        aria-disabled={o.disabled || undefined}
        className={`pick-option${k === active ? ' active' : ''}`}
        onClick={() => !o.disabled && onPick(k)}
        onPointerMove={(e) => e.pointerType === 'mouse' && !o.disabled && k !== active && onHover(k)}
      >
        <span className="pick-option-text">
          <span>{o.label}</span>
          {o.hint && <small>{o.hint}</small>}
        </span>
        {on && (
          <svg className="pick-check" viewBox="0 0 12 12" width="12" height="12" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m2.5 6.2 2.4 2.4 4.6-5" />
          </svg>
        )}
      </div>
    );
  };
  return (
    <div role="listbox" id={id} aria-labelledby={labelId} className="pick-listbox">
      {groups.map((g, gi) => {
        if (!g.name) return g.options.map(row);
        const head = `${id}-g${gi}`;
        return (
          <div key={`g:${g.name}`} role="group" aria-labelledby={head} className="pick-group">
            <div id={head} role="presentation" className="pick-group-label">
              {g.name}
            </div>
            {g.options.map(row)}
          </div>
        );
      })}
    </div>
  );
}

export interface PickProps<T extends string> {
  /** The control's id (the Field label's `htmlFor`). */
  id: string;
  /** The Field label's id, which names the control and its list. */
  labelId: string;
  value: T;
  options: readonly PickOption<T>[];
  onChange: (v: T) => void;
}

/**
 * Select-only combobox. Enter, Space or the arrows open it; arrows, Home /
 * End and PageUp / PageDown move; typing jumps to an option; Enter or Space
 * picks, Tab picks and moves on, Escape closes. A click opens it, a click on
 * an option picks it, a click anywhere else closes it.
 */
export function SelectButton<T extends string>({ id, labelId, value, options, onChange }: PickProps<T>) {
  const groups = groupOptions(options);
  const flat = groups.flatMap((g) => g.options);
  const selected = flat.findIndex((o) => o.value === value);
  const current = flat[selected];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: -Infinity });
  /** Enter / Space were handled on keydown: the click the browser may still send isn't another toggle. */
  const keyed = useRef(false);
  /** The press that picked was a finger: don't focus the button after (no focus ring on a phone). */
  const finger = useRef(false);
  const listId = `${id}-list`;

  const show = (at: number) => {
    setActive(at >= 0 ? at : firstEnabled(flat));
    setLayer(layerFor(button.current));
    setOpen(true);
  };
  const hide = (focus: boolean) => {
    setOpen(false);
    if (focus && document.activeElement !== button.current) button.current?.focus({ preventScroll: true });
  };
  const pick = (i: number) => {
    const o = flat[i];
    if (o && !o.disabled && o.value !== value) onChange(o.value);
  };
  usePopup(open, id, button, pop, () => setOpen(false));
  const activeId = open && active >= 0 && active < flat.length ? optionId(listId, active) : undefined;
  useReveal(open, pop, activeId);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const now = performance.now();
    const typing = !!typed.current.text && now - typed.current.at < TYPEAHEAD_MS;
    const act = selectKey(e, open, typing);
    if (!act) return;
    if (act.type !== 'pickAndLeave') e.preventDefault();
    if (e.key === 'Enter' || e.key === ' ') keyed.current = true;
    switch (act.type) {
      case 'open':
        show(selected);
        break;
      case 'move':
        if (open) setActive(moveActive(flat, active, act.move));
        else show(moveActive(flat, selected, act.move));
        break;
      case 'pick':
        pick(active);
        hide(true);
        break;
      case 'pickAndLeave':
        pick(active);
        setOpen(false);
        break;
      case 'close':
        // Not the dialog or the app's "clear the selection" too.
        e.stopPropagation();
        hide(true);
        break;
      case 'type': {
        const t = typed.current;
        t.text = typing ? t.text + act.char : act.char;
        t.at = now;
        const i = typeahead(flat, open ? active : selected, t.text);
        if (!open) show(i >= 0 ? i : selected);
        else if (i >= 0) setActive(i);
        break;
      }
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        id={id}
        className="pick-trigger"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeId}
        onClick={() => {
          if (keyed.current) return;
          if (open) hide(false);
          else show(selected);
        }}
        onKeyDown={onKeyDown}
        onPointerDown={() => (keyed.current = false)}
        onKeyUp={(e) => {
          // Firefox clicks a button on Space's keyup.
          if (e.key === ' ') e.preventDefault();
          setTimeout(() => (keyed.current = false));
        }}
        onBlur={() => open && setOpen(false)}
      >
        <span className="pick-value">{current?.label ?? ''}</span>
        <Chevron />
      </button>
      {open &&
        layer &&
        createPortal(
          <div
            ref={pop}
            className="pick-pop"
            // Pressing in the list mustn't take the focus from the button.
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => (finger.current = e.pointerType !== 'mouse')}
          >
            <OptionList
              id={listId}
              labelId={labelId}
              groups={groups}
              value={value}
              active={active}
              onHover={setActive}
              onPick={(i) => {
                pick(i);
                hide(!finger.current);
              }}
            />
          </div>,
          layer,
        )}
    </>
  );
}
