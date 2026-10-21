import { create } from 'zustand';
import { cleanBins, history, projectOf, useStore } from './store';
import { saveTemplate } from './templates';
import { computeLayout } from '../lib/layout/drawer';
import { planJob, type PlacedBin } from '../lib/project';
import { usableBeds } from '../lib/bedfit';
import { newId } from '../lib/bins';
import { binsWithAbove, stacksOf } from '../lib/stacking';
import { uniqueTemplateName } from '../lib/templates';
import {
  MY_BINS_VERSION,
  cleanEntry,
  cleanLibrary,
  cleanName,
  entryFromBins,
  libraryData,
  mergeLibrary,
  planPlacement,
  readLibraryData,
  type LibraryEntry,
  type MergeReport,
  type PlaceNote,
} from '../lib/myBins';

/**
 * "My bins" (lib/myBins.ts), kept in the browser's localStorage under its own
 * key, apart from the project: a new project, opening a project file or a
 * share link, and undo never touch it, and it's there after a reload. Other
 * tabs see changes at once (the storage event).
 *
 * Storage is wrapped: a private window or blocked site data (reading throws)
 * keeps the library in memory for this tab, and a full one keeps the last
 * change in memory; `status` says which, so the panel can say so. A library
 * saved by a newer version is read as well as this one can but never written
 * over, so nothing it knows is lost.
 *
 * Placing a bin from the library is one undo step of the project.
 */

export const MY_BINS_KEY = 'gridfit-my-bins';

/** What the library needs of the browser's storage (localStorage, or a stand-in in tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * How the library is kept:
 * - saved: in the browser's storage;
 * - memory: the browser won't keep it (a private window, blocked site data): only until this tab closes;
 * - full: the browser's storage is full, so the last change is only in memory;
 * - newer: a newer version of Gridfit saved it; it's read-only here until a reload brings the update.
 */
export type LibraryStatus = 'saved' | 'memory' | 'full' | 'newer';

export interface MyBinsState {
  entries: LibraryEntry[];
  status: LibraryStatus;
  /** The last entry deleted and where it was, for Undo (this tab only). */
  deleted: { entry: LibraryEntry; index: number } | null;
}

let source: () => KeyValueStore | null | undefined = () => globalThis.localStorage;

/** The storage, or null when the browser won't give it (reading localStorage itself can throw). */
function storage(): KeyValueStore | null {
  try {
    return source() ?? null;
  } catch {
    return null;
  }
}

/** The stored text unreadable (damaged, or not a library): kept aside once, so saving over it doesn't lose it. */
function keepUnreadable(s: KeyValueStore, text: string) {
  try {
    if (!s.getItem(`${MY_BINS_KEY}-unreadable`)) s.setItem(`${MY_BINS_KEY}-unreadable`, text);
  } catch {
    // Nothing more to do.
  }
}

/** The library as stored, cleaned and brought up to date. Never throws. */
export function loadLibrary(s: KeyValueStore | null): { entries: LibraryEntry[]; status: LibraryStatus } {
  if (!s) return { entries: [], status: 'memory' };
  let text: string | null;
  try {
    text = s.getItem(MY_BINS_KEY);
  } catch {
    return { entries: [], status: 'memory' };
  }
  if (!text) return { entries: [], status: 'saved' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    keepUnreadable(s, text);
    return { entries: [], status: 'saved' };
  }
  const r = readLibraryData(data);
  if ('error' in r) {
    keepUnreadable(s, text);
    return { entries: [], status: 'saved' };
  }
  return { entries: cleanLibrary(r.entries, cleanBins), status: r.version > MY_BINS_VERSION ? 'newer' : 'saved' };
}

const isQuota = (e: unknown) => {
  const name = (e as { name?: string } | null)?.name ?? '';
  return /quota/i.test(name) || name === 'NS_ERROR_DOM_QUOTA_REACHED' || (e as { code?: number } | null)?.code === 22;
};

/** Write the library. Never throws: says how it's kept now. */
export function storeLibrary(s: KeyValueStore | null, entries: LibraryEntry[]): LibraryStatus {
  if (!s) return 'memory';
  try {
    s.setItem(MY_BINS_KEY, JSON.stringify(libraryData(entries)));
    return 'saved';
  } catch (e) {
    return isQuota(e) ? 'full' : 'memory';
  }
}

export const useMyBins = create<MyBinsState>(() => ({ ...loadLibrary(storage()), deleted: null }));

const state = () => useMyBins.getState();

/** What's stored, or what this tab has when reading fails now (storage blocked since). */
function readOrKeep(s: KeyValueStore | null): { entries: LibraryEntry[]; status: LibraryStatus } {
  const r = loadLibrary(s);
  return r.status === 'memory' ? { entries: state().entries, status: 'memory' } : r;
}

/** Read the library again (another tab changed it). */
export function reloadMyBins() {
  useMyBins.setState(readOrKeep(storage()));
}

/** Use another storage (tests; null = none) and read the library from it. */
export function setLibraryStorage(s: KeyValueStore | null | (() => KeyValueStore | null)) {
  source = typeof s === 'function' ? s : () => s;
  useMyBins.setState({ ...loadLibrary(storage()), deleted: null });
}

// Other tabs: the storage event fires there for every write here (and on clearing site data: key null).
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === MY_BINS_KEY || e.key === null) reloadMyBins();
  });
}

/** What's in the library right now: as stored (another tab may have changed it), or this tab's when the browser isn't keeping it. */
function latest(): { entries: LibraryEntry[]; status: LibraryStatus } {
  const cur = state();
  const s = storage();
  if (!s || cur.status === 'memory' || cur.status === 'full') return { entries: cur.entries, status: s ? cur.status : 'memory' };
  return readOrKeep(s);
}

type Change = 'done' | 'unchanged' | 'refused';

/** Change the library and save it. `fn` returns the new entries, or null for no change. Refused when a newer version saved it. */
function change(fn: (entries: LibraryEntry[]) => LibraryEntry[] | null, extra: Partial<MyBinsState> = {}): Change {
  const cur = latest();
  if (cur.status === 'newer') {
    useMyBins.setState(cur);
    return 'refused';
  }
  const next = fn(cur.entries);
  if (!next) {
    useMyBins.setState({ ...cur, ...extra });
    return 'unchanged';
  }
  useMyBins.setState({ entries: next, status: storeLibrary(storage(), next), ...extra });
  return 'done';
}

/** Read-only here: a newer version saved the library. */
export const libraryLocked = () => state().status === 'newer';

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export interface SaveRequest {
  /** The entry's name (one entry only; '' = from its label or contents). */
  name?: string;
  /** Keep what's in the bins (default: yes). */
  contents?: boolean;
  /** Several bins: one entry each (default: one entry for them all, as arranged). */
  separately?: boolean;
}

/** Bins of the active drawer to save: each entry's bins, with the bins stacked on them. */
function groupsToSave(binIds: readonly string[], separately: boolean): PlacedBin[][] {
  const all = useStore.getState().bins;
  const picked = all.filter((b) => binIds.includes(b.id));
  if (!picked.length) return [];
  if (!separately) return [binsWithAbove(all, picked)];
  const st = stacksOf(all);
  // A bin stacked on another picked bin goes with that one.
  const below = (p: PlacedBin, b: PlacedBin) => p !== b && st.root.get(p.id) === st.root.get(b.id) && st.level.get(p.id)! < st.level.get(b.id)!;
  return picked.filter((b) => !picked.some((p) => below(p, b))).map((b) => binsWithAbove(all, [b]));
}

/** The name an entry for these bins would get. */
export function suggestedName(binIds: readonly string[], separately = false): string {
  const s = useStore.getState();
  const [group] = groupsToSave(binIds, separately);
  return group ? (entryFromBins(group, { half: !!s.drawer.halfGrid, contents: true })?.name ?? '') : '';
}

/**
 * Save bins of the active drawer to My bins (stacked bins go with the bins
 * they stand on). Returns the new entries; none when refused (newer library).
 */
export function saveToMyBins(binIds: readonly string[], o: SaveRequest = {}): LibraryEntry[] {
  const s = useStore.getState();
  const groups = groupsToSave(binIds, !!o.separately);
  if (!groups.length) return [];
  const made: LibraryEntry[] = [];
  const res = change((entries) => {
    const taken = entries.map((e) => e.name);
    for (const g of groups) {
      const raw = entryFromBins(g, {
        name: groups.length === 1 ? o.name : undefined,
        half: !!s.drawer.halfGrid,
        contents: o.contents !== false,
        tools: s.tools,
        taken,
      });
      // Stored the way it will be read back.
      const e = raw && cleanEntry(raw, cleanBins);
      if (!e) continue;
      taken.push(e.name);
      made.push(e);
    }
    return made.length ? [...entries, ...made] : null;
  });
  return res === 'done' ? made : [];
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export function renameMyBin(id: string, name: string) {
  const n = cleanName(name);
  if (!n) return;
  change((es) => (es.some((e) => e.id === id && e.name !== n) ? es.map((e) => (e.id === id ? { ...e, name: n, saved: Date.now() } : e)) : null));
}

/** A copy right after it ("Name copy"). Returns its id. */
export function duplicateMyBin(id: string): string | null {
  let made: string | null = null;
  change((es) => {
    const i = es.findIndex((e) => e.id === id);
    if (i < 0) return null;
    const copy: LibraryEntry = { ...structuredClone(es[i]), id: newId(), name: uniqueTemplateName(`${es[i].name} copy`, es.map((e) => e.name)), saved: Date.now() };
    made = copy.id;
    return [...es.slice(0, i + 1), copy, ...es.slice(i + 1)];
  });
  return made;
}

/** Delete an entry; undoDeleteMyBin puts it back. */
export function deleteMyBin(id: string): boolean {
  const cur = latest().entries;
  const index = cur.findIndex((e) => e.id === id);
  if (index < 0) return false;
  return change((es) => es.filter((e) => e.id !== id), { deleted: { entry: cur[index], index } }) === 'done';
}

export function undoDeleteMyBin(): boolean {
  const d = state().deleted;
  if (!d) return false;
  return (
    change((es) => (es.some((e) => e.id === d.entry.id) ? null : [...es.slice(0, d.index), d.entry, ...es.slice(d.index)]), { deleted: null }) === 'done'
  );
}

/** A one-bin entry's settings as a template of the project (templates apply settings to bins already there). Returns the template id. */
export function myBinAsTemplate(id: string): string | null {
  const e = state().entries.find((x) => x.id === id);
  if (!e || e.bins.length !== 1) return null;
  return saveTemplate(e.name, e.bins[0].opts);
}

// ---------------------------------------------------------------------------
// Placing
// ---------------------------------------------------------------------------

export type PlaceResult =
  | { ok: true; ids: string[]; at: [number, number]; notes: PlaceNote[]; name: string; /** Tools added to the project's tool library. */ tools: number }
  | { ok: false; error: string };

/**
 * Put an entry in the active drawer, as one undo step: at `at` when it fits
 * there, else the first free spot (lib/myBins.ts planPlacement). The new bins
 * are selected; the tools their pockets came from join the project's tool
 * library. `room`: the drawer's room above the baseplate (planJob's), when the
 * caller has it.
 */
export function placeMyBin(id: string, o: { at?: [number, number] | null; room?: number } = {}): PlaceResult {
  const entry = state().entries.find((e) => e.id === id);
  if (!entry) return { ok: false, error: 'That bin isn’t in My bins any more.' };
  const s = useStore.getState();
  const layout = computeLayout(s.drawer);
  const room = o.room ?? planJob(projectOf(s)).drawers[0]?.room ?? Infinity;
  const plan = planPlacement(entry, { layout, bins: s.bins, bed: usableBeds(s.setup), room, wall: s.drawer.enclosure === 'wall' }, o.at);
  if ('error' in plan) return { ok: false, error: plan.error };
  const used = new Set(plan.bins.flatMap((b) => (b.opts.cutouts ?? []).map((c) => c.toolId)));
  const tools = (entry.tools ?? []).filter((t) => used.has(t.id) && !s.tools.some((x) => x.id === t.id)).map((t) => structuredClone(t));
  const ids = plan.bins.map((b) => b.id);
  history.checkpoint();
  useStore.setState({
    bins: [...s.bins, ...plan.bins],
    ...(tools.length ? { tools: [...s.tools, ...tools] } : {}),
    // The drawer grid, with the new bins selected.
    ui: { ...s.ui, binPane: 'drawer', selectedBinId: ids[0] ?? null, selectedBinIds: ids },
  });
  history.checkpoint();
  return { ok: true, ids, at: plan.at, notes: plan.notes, name: entry.name, tools: tools.length };
}

// ---------------------------------------------------------------------------
// Moving between browsers
// ---------------------------------------------------------------------------

/** The library as a .json file's text. */
export function myBinsFileText(): string {
  return JSON.stringify({ ...libraryData(latest().entries), exported: new Date().toISOString() }, null, 2);
}

export interface ImportReport extends MergeReport {
  /** Entries in the file with nothing usable in them. */
  invalid: number;
}

/** Add the bins in a My bins file that aren't here yet (lib/myBins.ts mergeLibrary). */
export function importMyBins(text: string): ImportReport | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'This file isn’t a My bins file (it isn’t JSON).' };
  }
  const r = readLibraryData(data);
  if ('error' in r) return r;
  if (r.version > MY_BINS_VERSION) return { error: 'This file comes from a newer version of Gridfit. Reload the page to update, then import it again.' };
  const incoming = cleanLibrary(r.entries, cleanBins);
  let report: ImportReport = { added: 0, updated: 0, same: 0, older: 0, invalid: r.entries.length - incoming.length };
  const res = change((es) => {
    const m = mergeLibrary(es, incoming);
    report = { ...m.report, invalid: report.invalid };
    return m.report.added || m.report.updated ? m.entries : null;
  });
  if (res === 'refused') return { error: 'My bins was saved by a newer version of Gridfit. Reload the page to update before importing.' };
  return report;
}
