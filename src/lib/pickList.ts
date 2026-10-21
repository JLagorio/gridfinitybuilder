/**
 * The logic behind the side panels' pick lists (components/select.tsx: Select
 * and the type-to-filter Combobox), kept free of the DOM so it can be tested:
 * grouping, filtering, moving through the options and typeahead, and what each
 * key does.
 */

export interface PickOption<T extends string = string> {
  value: T;
  label: string;
  /** Options with the same group are listed together under it, groups in the order they first appear. */
  group?: string;
  disabled?: boolean;
  /** A second line under the label, in the list. */
  hint?: string;
  /** Other words it's found by when typing ("556" for 5.56 NATO), besides its label and group. */
  keywords?: string[];
}

export interface PickGroup<O> {
  /** '' for options without a group. */
  name: string;
  options: O[];
}

/**
 * Text as matched: lower case, accents dropped, and only letters and digits, so
 * "5.56 NATO" is "556nato" and ".300 BLK" is "300blk".
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Whether an option matches what was typed: the whole text, or else every
 * word of it, is in its label, its group or one of its keywords (each folded,
 * so case, spaces and punctuation don't matter). Nothing typed matches all.
 */
export function optionMatches(o: PickOption, query: string): boolean {
  const all = fold(query);
  if (!all) return true;
  const fields = [o.label, o.group ?? '', ...(o.keywords ?? [])].map(fold).filter(Boolean);
  if (fields.some((f) => f.includes(all))) return true;
  const words = query.split(/\s+/).map(fold).filter(Boolean);
  return words.length > 1 && words.every((w) => fields.some((f) => f.includes(w)));
}

/** The options that match what was typed, in their order. */
export function filterOptions<O extends PickOption>(options: readonly O[], query: string): O[] {
  return fold(query) ? options.filter((o) => optionMatches(o, query)) : [...options];
}

/** Options by group, in the order the groups first appear (ungrouped ones where the first of them is). */
export function groupOptions<O extends PickOption>(options: readonly O[]): PickGroup<O>[] {
  const groups = new Map<string, O[]>();
  for (const o of options) {
    const g = o.group ?? '';
    const list = groups.get(g);
    if (list) list.push(o);
    else groups.set(g, [o]);
  }
  return [...groups].map(([name, list]) => ({ name, options: list }));
}

/** How far PageUp / PageDown move. */
export const PAGE = 10;

export type Move = 'first' | 'last' | 'next' | 'prev' | 'pageDown' | 'pageUp';

/** The first option that can be picked at or after `from` (or before it, going `back`); -1 when none. */
function enabledFrom(options: readonly PickOption[], from: number, back: boolean): number {
  for (let i = from; i >= 0 && i < options.length; i += back ? -1 : 1) if (!options[i].disabled) return i;
  return -1;
}

/**
 * The option a move lands on, from `at` (-1: none yet). It stops at the ends
 * (no wrapping) and skips disabled options; it stays put when there's nowhere to go.
 */
export function moveActive(options: readonly PickOption[], at: number, move: Move): number {
  const n = options.length;
  if (!n) return -1;
  let target: number;
  let back = false;
  switch (move) {
    case 'first':
      target = 0;
      break;
    case 'last':
      target = n - 1;
      back = true;
      break;
    case 'next':
      target = at < 0 ? 0 : at + 1;
      break;
    case 'prev':
      target = at < 0 ? n - 1 : at - 1;
      back = true;
      break;
    case 'pageDown':
      target = Math.min(n - 1, at < 0 ? PAGE - 1 : at + PAGE);
      break;
    case 'pageUp':
      target = Math.max(0, at < 0 ? 0 : at - PAGE);
      back = true;
      break;
  }
  const i = enabledFrom(options, target, back);
  if (i >= 0) return i;
  // Page moves that ran into disabled options at the end: the nearest one the other way.
  const j = move === 'pageDown' || move === 'pageUp' ? enabledFrom(options, target, !back) : -1;
  return j >= 0 ? j : at;
}

/** The first option that can be picked (-1: none). */
export const firstEnabled = (options: readonly PickOption[]) => enabledFrom(options, 0, false);

/**
 * Typeahead: the option `typed` jumps to, searching from the active one `at`.
 * Labels (and keywords) are compared from their start, folded. One letter, or
 * the same letter again and again, steps through the options starting with it;
 * longer text stays on the active option while it still matches. -1: no match.
 */
export function typeahead(options: readonly PickOption[], at: number, typed: string): number {
  const n = options.length;
  let text = fold(typed);
  if (!n || !text) return -1;
  const same = [...text].every((c) => c === text[0]);
  if (same) text = text[0];
  const starts = (o: PickOption) => !o.disabled && [o.label, ...(o.keywords ?? [])].some((w) => fold(w).startsWith(text));
  const start = same || at < 0 ? at + 1 : at;
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n;
    if (starts(options[i])) return i;
  }
  return -1;
}

/** Typed letters older than this start a new typeahead search. */
export const TYPEAHEAD_MS = 500;

export interface KeyPress {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export type SelectAction =
  | { type: 'open' }
  | { type: 'move'; move: Move }
  /** Pick the active option and close. */
  | { type: 'pick' }
  /** Pick the active option and close, and let the focus move on (Tab). */
  | { type: 'pickAndLeave' }
  | { type: 'close' }
  | { type: 'type'; char: string };

const printable = (e: KeyPress) => e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey;

/**
 * What a key does to a select-only combobox (WAI-ARIA APG): Enter, Space and
 * the arrows open it; arrows, Home / End and PageUp / PageDown move; Enter,
 * Space or Alt+Up pick; Tab picks and moves on; Escape closes; letters jump
 * (opening it). `typing`: a typeahead is under way, so Space is part of it.
 */
export function selectKey(e: KeyPress, open: boolean, typing = false): SelectAction | null {
  const { key } = e;
  if (key === ' ' && typing) return { type: 'type', char: ' ' };
  if (!open) {
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') return { type: 'open' };
    if (key === 'Home') return { type: 'move', move: 'first' };
    if (key === 'End') return { type: 'move', move: 'last' };
    return printable(e) ? { type: 'type', char: key } : null;
  }
  switch (key) {
    case 'ArrowDown':
      return e.altKey ? null : { type: 'move', move: 'next' };
    case 'ArrowUp':
      return e.altKey ? { type: 'pick' } : { type: 'move', move: 'prev' };
    case 'Home':
      return { type: 'move', move: 'first' };
    case 'End':
      return { type: 'move', move: 'last' };
    case 'PageDown':
      return { type: 'move', move: 'pageDown' };
    case 'PageUp':
      return { type: 'move', move: 'pageUp' };
    case 'Enter':
    case ' ':
      return { type: 'pick' };
    case 'Tab':
      return { type: 'pickAndLeave' };
    case 'Escape':
      return { type: 'close' };
  }
  return printable(e) ? { type: 'type', char: key } : null;
}

export type ComboAction =
  /** Open, on the current value. */
  | { type: 'open' }
  | { type: 'move'; move: Move }
  | { type: 'pick' }
  | { type: 'pickAndLeave' }
  /** Close and put the current value's label back. */
  | { type: 'revert' };

/**
 * What a key does to the editable, type-to-filter combobox (APG list
 * autocomplete). Letters, Home / End and the rest are the text box's own.
 * `navigated`: the active option was reached with the arrow keys, so Tab takes it.
 */
export function comboKey(e: KeyPress, open: boolean, navigated: boolean): ComboAction | null {
  switch (e.key) {
    case 'ArrowDown':
      return open ? (e.altKey ? null : { type: 'move', move: 'next' }) : { type: 'open' };
    case 'ArrowUp':
      return open ? (e.altKey ? { type: 'revert' } : { type: 'move', move: 'prev' }) : e.altKey ? null : { type: 'open' };
    case 'PageDown':
      return open ? { type: 'move', move: 'pageDown' } : null;
    case 'PageUp':
      return open ? { type: 'move', move: 'pageUp' } : null;
    case 'Enter':
      return open ? { type: 'pick' } : null;
    case 'Tab':
      return open && navigated ? { type: 'pickAndLeave' } : null;
    case 'Escape':
      return { type: 'revert' };
  }
  return null;
}
