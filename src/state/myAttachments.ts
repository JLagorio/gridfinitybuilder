import { create } from 'zustand';
import { history, projectOf, useStore } from './store';
import { oneStep } from './oneStep';
import { planJob } from '../lib/project';
import { newId } from '../lib/bins';
import { sanitizeSkadis } from '../lib/geometry/skadis';
import { uniqueTemplateName } from '../lib/templates';
import { adoptMeshes, attachmentMeshHashes, meshesFor } from '../lib/imported/meshStore';
import '../lib/wall/kinds/all';
import { placeAttachments } from '../lib/wall/place';
import { tilesForSpace } from '../lib/geometry/skadisTiles';
import { skadisAreas } from '../lib/enclosures';
import type { WallBoard, WallPlacement } from '../lib/wall/plan';
import {
  DEFAULT_CTX,
  MY_ATTACHMENTS_VERSION,
  attachmentsShareUrl,
  cleanLibrary,
  cleanName,
  entryFromAttachments,
  entryKnown,
  entryView,
  libraryData,
  mergeLibrary,
  placedOf,
  planOnBoard,
  readLibraryData,
  type AttachmentEntry,
  type MergeReport,
} from '../lib/myAttachments';

/**
 * "My attachments" (lib/myAttachments.ts), kept in the browser's localStorage
 * under its own key, apart from the project, like My bins (state/myBins.ts):
 * a new project, opening a project file or a share link, and undo never touch
 * it, and it's there after a reload. Other tabs see changes at once.
 *
 * Storage is wrapped: a private window or blocked site data keeps the library
 * in memory for this tab, a full one keeps the last change in memory, and
 * `status` says which. A library saved by a newer version is read as well as
 * this one can but never written over.
 *
 * Putting an entry on a board is one undo step of the project. Loaded with
 * the Attachments tab (and with a link to some).
 */

export const MY_ATTACHMENTS_KEY = 'gridfit-my-attachments';

/** What the library needs of the browser's storage (localStorage, or a stand-in in tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** How the library is kept (as My bins: state/myBins.ts LibraryStatus). */
export type LibraryStatus = 'saved' | 'memory' | 'full' | 'newer';

export interface MyAttachmentsState {
  entries: AttachmentEntry[];
  status: LibraryStatus;
  /** The last entry deleted and where it was, for Undo (this tab only). */
  deleted: { entry: AttachmentEntry; index: number } | null;
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
    if (!s.getItem(`${MY_ATTACHMENTS_KEY}-unreadable`)) s.setItem(`${MY_ATTACHMENTS_KEY}-unreadable`, text);
  } catch {
    // Nothing more to do.
  }
}

/** The library as stored, cleaned and brought up to date. Never throws. */
export function loadLibrary(s: KeyValueStore | null): { entries: AttachmentEntry[]; status: LibraryStatus } {
  if (!s) return { entries: [], status: 'memory' };
  let text: string | null;
  try {
    text = s.getItem(MY_ATTACHMENTS_KEY);
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
  return { entries: cleanLibrary(r.entries), status: r.version > MY_ATTACHMENTS_VERSION ? 'newer' : 'saved' };
}

const isQuota = (e: unknown) => {
  const name = (e as { name?: string } | null)?.name ?? '';
  return /quota/i.test(name) || name === 'NS_ERROR_DOM_QUOTA_REACHED' || (e as { code?: number } | null)?.code === 22;
};

/** Write the library. Never throws: says how it's kept now. */
export function storeLibrary(s: KeyValueStore | null, entries: AttachmentEntry[]): LibraryStatus {
  if (!s) return 'memory';
  try {
    s.setItem(MY_ATTACHMENTS_KEY, JSON.stringify(libraryData(entries)));
    return 'saved';
  } catch (e) {
    return isQuota(e) ? 'full' : 'memory';
  }
}

export const useMyAttachments = create<MyAttachmentsState>(() => ({ ...loadLibrary(storage()), deleted: null }));

const state = () => useMyAttachments.getState();

/** What's stored, or what this tab has when reading fails now (storage blocked since). */
function readOrKeep(s: KeyValueStore | null): { entries: AttachmentEntry[]; status: LibraryStatus } {
  const r = loadLibrary(s);
  return r.status === 'memory' ? { entries: state().entries, status: 'memory' } : r;
}

/** Read the library again (another tab changed it). */
export function reloadMyAttachments() {
  useMyAttachments.setState(readOrKeep(storage()));
}

/** Use another storage (tests; null = none) and read the library from it. */
export function setLibraryStorage(s: KeyValueStore | null | (() => KeyValueStore | null)) {
  source = typeof s === 'function' ? s : () => s;
  useMyAttachments.setState({ ...loadLibrary(storage()), deleted: null });
}

// Other tabs: the storage event fires there for every write here (and on clearing site data: key null).
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === MY_ATTACHMENTS_KEY || e.key === null) reloadMyAttachments();
  });
}

/** What's in the library right now: as stored (another tab may have changed it), or this tab's when the browser isn't keeping it. */
function latest(): { entries: AttachmentEntry[]; status: LibraryStatus } {
  const cur = state();
  const s = storage();
  if (!s || cur.status === 'memory' || cur.status === 'full') return { entries: cur.entries, status: s ? cur.status : 'memory' };
  return readOrKeep(s);
}

type Change = 'done' | 'unchanged' | 'refused';

/** Change the library and save it. `fn` returns the new entries, or null for no change. Refused when a newer version saved it. */
function change(fn: (entries: AttachmentEntry[]) => AttachmentEntry[] | null, extra: Partial<MyAttachmentsState> = {}): Change {
  const cur = latest();
  if (cur.status === 'newer') {
    useMyAttachments.setState(cur);
    return 'refused';
  }
  const next = fn(cur.entries);
  if (!next) {
    useMyAttachments.setState({ ...cur, ...extra });
    return 'unchanged';
  }
  useMyAttachments.setState({ entries: next, status: storeLibrary(storage(), next), ...extra });
  return 'done';
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export interface SaveRequest {
  /** The entry's name ('' = the part's name, or the first one's and how many more). */
  name?: string;
  /** Keep what's in them (default: yes). */
  contents?: boolean;
}

/** The active board's attachments of `ids`, in the board's order. */
const picked = (ids: readonly string[]) => (useStore.getState().drawer.attachments ?? []).filter((a) => ids.includes(a.id));

/** The name an entry for these parts would get. */
export function suggestedName(ids: readonly string[], board: Pick<WallBoard, 'ctx'>): string {
  return entryFromAttachments(picked(ids), { pitch: board.ctx.pitch, contents: true })?.name ?? '';
}

/**
 * Save attachments of the active board to My attachments: one entry, a set when there are several, as they're
 * arranged on `board`. Returns it; null when there's nothing to save or it's refused (a newer library).
 */
export function saveToMyAttachments(ids: readonly string[], board: Pick<WallBoard, 'ctx'>, o: SaveRequest = {}): AttachmentEntry | null {
  // An older project's part is where it's planned (PlacedAttachment.snap).
  const at = 'slots' in board && picked(ids).some((a) => a.snap) ? placeAttachments(picked(ids), board as WallBoard).placed : [];
  const list = picked(ids).map((a) => {
    const p = at.find((q) => q.id === a.id);
    return p ? { ...a, x: p.x, y: p.y } : a;
  });
  if (!list.length) return null;
  let made: AttachmentEntry | null = null;
  change((entries) => {
    made = entryFromAttachments(list, { name: o.name, pitch: board.ctx.pitch, contents: o.contents !== false, taken: entries.map((e) => e.name) });
    return made ? [...entries, made] : null;
  });
  return made && state().entries.some((e) => e.id === made!.id) ? made : null;
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export function renameMyAttachment(id: string, name: string) {
  const n = cleanName(name);
  if (!n) return;
  change((es) => (es.some((e) => e.id === id && e.name !== n) ? es.map((e) => (e.id === id ? { ...e, name: n, updated: Date.now() } : e)) : null));
}

/** A copy right after it ("Name copy"). Returns its id. */
export function duplicateMyAttachment(id: string): string | null {
  let made: string | null = null;
  change((es) => {
    const i = es.findIndex((e) => e.id === id);
    if (i < 0) return null;
    const now = Date.now();
    const copy: AttachmentEntry = {
      ...structuredClone(es[i]),
      id: newId(),
      name: uniqueTemplateName(
        cleanName(`${es[i].name} copy`),
        es.map((e) => e.name),
      ),
      created: now,
      updated: now,
    };
    made = copy.id;
    return [...es.slice(0, i + 1), copy, ...es.slice(i + 1)];
  });
  return made;
}

/** Delete an entry; undoDeleteMyAttachment puts it back. */
export function deleteMyAttachment(id: string): boolean {
  const cur = latest().entries;
  const index = cur.findIndex((e) => e.id === id);
  if (index < 0) return false;
  return change((es) => es.filter((e) => e.id !== id), { deleted: { entry: cur[index], index } }) === 'done';
}

export function undoDeleteMyAttachment(): boolean {
  const d = state().deleted;
  if (!d) return false;
  return change((es) => (es.some((e) => e.id === d.entry.id) ? null : [...es.slice(0, d.index), d.entry, ...es.slice(d.index)]), { deleted: null }) === 'done';
}

/** Entries from a link or a file added to the library (lib/myAttachments.ts mergeLibrary); null when refused (a newer library). */
export function addToMyAttachments(incoming: AttachmentEntry[]): MergeReport | null {
  let report: MergeReport = { added: 0, updated: 0, same: 0, older: 0 };
  const res = change((es) => {
    const m = mergeLibrary(es, incoming);
    report = m.report;
    return m.report.added || m.report.updated ? m.entries : null;
  });
  return res === 'refused' ? null : report;
}

// ---------------------------------------------------------------------------
// Putting on a board
// ---------------------------------------------------------------------------

export type PlaceResult =
  | { ok: true; ids: string[]; /** On a free spot where it fits (else on top of other parts, red where it doesn't fit). */ clear: boolean; name: string }
  | { ok: false; error: string };

/** The attachments on the active board, selected, the Attachments tab open: one undo step (`step`), or part of the caller's. */
function putOn(list: ReturnType<typeof placedOf>[], step: boolean) {
  const s = useStore.getState();
  const ids = list.map((a) => a.id);
  if (step) history.checkpoint();
  useStore.setState({
    drawer: { ...s.drawer, attachments: [...(s.drawer.attachments ?? []), ...list] },
    ui: { ...s.ui, tab: 'bins', selectedAttachment: ids[0] ?? null, selectedAttachments: ids },
  });
  if (step) history.checkpoint();
}

/** Put an entry (from the library, or a link) on the active board `board`, with `placed` its parts as planned now (lib/myAttachments.ts planOnBoard). */
export function placeEntry(entry: AttachmentEntry, board: WallBoard, placed?: readonly WallPlacement[], step = true): PlaceResult {
  const plan = planOnBoard(entry, board, placed ?? placeAttachments(useStore.getState().drawer.attachments ?? [], board).placed);
  if ('error' in plan) return { ok: false, error: plan.error };
  putOn(plan.list, step);
  return { ok: true, ids: plan.list.map((a) => a.id), clear: plan.clear, name: entry.name };
}

/** Put a library entry on the active board. */
export function placeMyAttachment(id: string, board: WallBoard, placed?: readonly WallPlacement[]): PlaceResult {
  const entry = state().entries.find((e) => e.id === id);
  if (!entry) return { ok: false, error: 'That isn’t in My attachments any more.' };
  return placeEntry(entry, board, placed);
}

/** The active drawer as attachments see it, when it's a Skådis board that plans. */
export function activeBoard(): { board: WallBoard; placed: WallPlacement[] } | null {
  const s = useStore.getState();
  if (s.drawer.enclosure !== 'skadis') return null;
  return planJob(projectOf(s)).drawers[0]?.enclosure?.wall ?? null;
}

/** Whether these entries all go on free spots of the active board, one after another. */
function fitsAll(entries: readonly AttachmentEntry[]): boolean {
  const at = activeBoard();
  if (!at) return false;
  const taken = [...at.placed];
  for (const e of entries) {
    const r = planOnBoard(e, at.board, taken);
    if ('error' in r || !r.clear) return false;
    taken.push(...placeAttachments(r.list, at.board).placed);
  }
  return true;
}

/**
 * Put entries (from a link) on the active board, else on a new board, with tiles enough for them (as a starter board
 * gets: lib/wall/templates.ts). One after another, each at the first free spot; the new parts selected. One undo step.
 */
export function putOnBoard(
  entries: readonly AttachmentEntry[],
  o: { newBoard?: boolean } = {},
): { ok: true; ids: string[]; clear: boolean; board: string } | { ok: false; error: string } {
  if (!entries.length) return { ok: false, error: 'There’s nothing to put on a board.' };
  if (!entries.every(entryKnown))
    return { ok: false, error: 'Some of it was made with a newer version of Gridfit: reload the page to update, then open the link again.' };
  return oneStep(() => {
    if (o.newBoard || !activeBoard()) {
      useStore.getState().addDrawer(entries.length === 1 ? entries[0].name : 'Shared parts', { skadis: true });
      const s = useStore.getState();
      const base = sanitizeSkadis(s.drawer.skadis);
      const views = entries.map((e) => entryView(e, { ...DEFAULT_CTX, pitch: base.pitch }).box);
      // The smallest that takes them all on free spots: just their size, else a lattice step or more round them.
      for (const steps of [0, 1, 2, 4, 8, 16]) {
        const m = steps * base.pitch;
        const width = Math.max(...views.map((b) => b.x1 - b.x0)) + m;
        const height = views.reduce((t, b) => t + b.y1 - b.y0 + m / 2, m / 2);
        const tiles = base.layout === 'tiles' ? { tiles: tilesForSpace(base, skadisAreas(s.setup), width, height, 'cover') } : {};
        s.setDrawer({ skadis: { ...base, width, height, ...tiles } });
        if (fitsAll(entries)) break;
      }
    }
    const ids: string[] = [];
    let clear = true;
    for (const e of entries) {
      const at = activeBoard();
      const r = at ? placeEntry(e, at.board, at.placed, false) : null;
      if (!r?.ok) continue;
      ids.push(...r.ids);
      clear &&= r.clear;
    }
    const s = useStore.getState();
    useStore.setState({ ui: { ...s.ui, tab: 'bins', selectedAttachment: ids[0] ?? null, selectedAttachments: ids } });
    return { ok: true as const, ids, clear, board: s.drawers.find((d) => d.id === s.activeDrawerId)?.name ?? '' };
  });
}

// ---------------------------------------------------------------------------
// Moving between browsers: files and links
// ---------------------------------------------------------------------------

/** Every imported mesh the library's parts use (wall/kinds/model.ts), so they're kept while it does. */
export function libraryMeshHashes(): string[] {
  return [...new Set(attachmentMeshHashes(latest().entries.flatMap((e) => e.items)))];
}

/** The library as a .json file's text, with the meshes of its imported models (as project files carry them). */
export async function myAttachmentsFileText(): Promise<string> {
  const entries = latest().entries;
  const hashes = libraryMeshHashes();
  const meshes = hashes.length ? await meshesFor(hashes) : undefined;
  return JSON.stringify({ ...libraryData(entries), ...(meshes ? { meshes } : {}), exported: new Date().toISOString() }, null, 2);
}

export interface ImportReport extends MergeReport {
  /** Entries in the file with nothing usable in them. */
  invalid: number;
}

/** Add the parts in a My attachments file that aren't here yet (lib/myAttachments.ts mergeLibrary). */
export function importMyAttachments(text: string): ImportReport | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'This file isn’t a My attachments file (it isn’t JSON).' };
  }
  const r = readLibraryData(data);
  if ('error' in r) return r;
  if (r.version > MY_ATTACHMENTS_VERSION) return { error: 'This file comes from a newer version of Gridfit. Reload the page to update, then import it again.' };
  // Imported models' meshes first, as for a project file.
  adoptMeshes((data as { meshes?: unknown }).meshes);
  const incoming = cleanLibrary(r.entries);
  const report = addToMyAttachments(incoming);
  if (!report) return { error: 'My attachments was saved by a newer version of Gridfit. Reload the page to update before importing.' };
  return { ...report, invalid: r.entries.length - incoming.length };
}

/** A link to an entry (lib/myAttachments.ts attachmentsShareUrl), from `base` (this page). */
export function myAttachmentLink(id: string, base: string): { url: string; models: number } | { error: string } {
  const entry = state().entries.find((e) => e.id === id);
  if (!entry) return { error: 'That isn’t in My attachments any more.' };
  return attachmentsShareUrl([entry], base);
}
