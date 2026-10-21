/**
 * "My bins": a library of whole bins of your own, kept in the browser rather
 * than in the project, so every project has them (state/myBins.ts keeps them,
 * the Bins panel shows them: components/MyBinsSection.tsx).
 *
 * An entry is one bin, or a few saved together (a set, stacks included), with
 * everything a placed bin carries except where it is: its size in cells, every
 * option (inside, compartments, pockets, labels, inserts, lid, …) and, when
 * wanted, what's in it. A bin's place (x, y), its stretch over the drawer's
 * margin and its id belong to a drawer, so they aren't kept.
 *
 * Templates (templates.ts) are different: they copy settings onto bins that
 * are already there, and each bin keeps its own size.
 *
 * Sizes count cells of the grid the entry was saved from (`half`: 21 mm
 * cells). Placing one in a drawer converts them, finds a free spot, and holds
 * it to the printer and the drawer like any new bin (planPlacement).
 *
 * Pure: no storage, no store.
 */
import { binCellsAt, type PlacedBin } from './project';
import { canPlace, newId, rectsOverlap, withBlocked, type CellRect } from './bins';
import { MAX_BIN_UNITS, clipFits, findSpot, groupBounds, type ClipBin } from './binLayout';
import { shrinkToBed, type Beds } from './bedfit';
import { DEFAULT_BIN, MIN_HEIGHT_UNITS, binInnerSize, binLabel, binSize, binTotalHeight, sanitizeBin, type BinOptions } from './geometry/bin';
import { binBodyHeight } from './geometry/variants';
import { GRID, HEIGHT_UNIT } from './geometry/spec';
import { MAX_CELLS } from './geometry/placement';
import { activeContainer } from './geometry/containers';
import { cutoutArea, pocketBox } from './geometry/cutouts';
import { labelCaption } from './geometry/labelContents';
import { cellSizes, type GridLayout } from './layout/drawer';
import { alignStacks, stackPlaces, stacksOf } from './stacking';
import { carryContents, contentLines } from './inventory';
import { fitLayout } from './dividers';
import { cleanTools, type Tool } from './tools';
import { templateSummary, uniqueTemplateName } from './templates';

/** Version of the stored library and of exported files. Older ones are read and brought up to date (cleanEntry). */
export const MY_BINS_VERSION = 1;
export const MY_BINS_KIND = 'my-bins';
/** Most entries kept, and most bins in one entry, so a file can't flood the browser's storage. */
export const MAX_ENTRIES = 500;
export const MAX_ENTRY_BINS = 64;
export const NAME_MAX = 80;

const EPS = 1e-6;

/** One bin of an entry: a placed bin without its place, relative to the entry's front-left corner. */
export interface LibraryBin extends Omit<PlacedBin, 'id' | 'x' | 'y' | 'stretch' | 'on'> {
  /** Cells from the entry's front-left corner (cells of the entry's grid). */
  dx: number;
  dy: number;
  /** Stacked on another bin of the entry: its index (stacking.ts). */
  on?: number;
}

export interface LibraryEntry {
  id: string;
  name: string;
  /** Saved from a half-grid drawer: sizes count 21 mm cells. */
  half?: true;
  bins: LibraryBin[];
  /** The tools its pockets were cut from (tools.ts), so a project it goes into gets them in its tool library. */
  tools?: Tool[];
  /** When it was saved or last changed (ms since 1970); the newer copy wins when importing. 0 = unknown. */
  saved: number;
}

/** The stored library, and an exported .json file. */
export interface LibraryData {
  app: 'gridfit';
  kind: typeof MY_BINS_KIND;
  version: number;
  bins: LibraryEntry[];
}

/** The store's cleanup for a loaded project's bins (store.ts cleanBins), passed in so this module stays pure. */
export type BinCleaner = (bins: unknown) => PlacedBin[];

// ---------------------------------------------------------------------------
// Reading: files and storage, any version
// ---------------------------------------------------------------------------

export function libraryData(entries: LibraryEntry[]): LibraryData {
  return { app: 'gridfit', kind: MY_BINS_KIND, version: MY_BINS_VERSION, bins: entries };
}

/**
 * The entries in a stored library or a file, before cleaning, and the version
 * that wrote them. Version 0 is a bare list (of entries, or of templates).
 * A newer version is read too (the caller decides what to do with it).
 */
export function readLibraryData(data: unknown): { version: number; entries: unknown[] } | { error: string } {
  if (Array.isArray(data)) return { version: 0, entries: data };
  if (!data || typeof data !== 'object') return { error: 'This isn’t a My bins file.' };
  const d = data as Record<string, unknown>;
  if (d.kind === MY_BINS_KIND && Array.isArray(d.bins)) {
    const v = Number(d.version);
    return { version: Number.isFinite(v) && v >= 0 ? v : 0, entries: d.bins };
  }
  if (d.app === 'gridfit' && (Array.isArray(d.drawers) || d.drawer)) return { error: 'This is a Gridfit project file: open it with Open project… (Print plates tab).' };
  return { error: 'This isn’t a My bins file.' };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
}

/**
 * An entry's bins, cleaned exactly like a loaded project's (`clean` is the
 * store's cleanup: options sanitized, with defaults for anything added since,
 * contents cleaned, stack links made consistent). Floor bins that would
 * overlap an earlier one are left out, with what stands on them.
 */
function cleanEntryBins(list: unknown[], clean: BinCleaner): LibraryBin[] {
  const raw = list.slice(0, MAX_ENTRY_BINS).filter((b): b is Record<string, unknown> => isObject(b) && isObject(b.opts));
  const asPlaced = raw.map((b, i) => {
    const { dx, dy, on, stretch: _s, id: _id, ...rest } = b;
    const at = (v: unknown, old: unknown) => Number(v ?? old) || 0;
    return { ...rest, id: `#${i}`, x: at(dx, b.x), y: at(dy, b.y), ...(Number.isInteger(on) && on !== i ? { on: `#${on}` } : {}) };
  });
  const placed = clean(asPlaced);
  const st = stacksOf(placed);
  const floor: PlacedBin[] = [];
  const gone = new Set<string>();
  for (const b of placed) {
    if (st.level.get(b.id)) continue;
    const r = { x: b.x, y: b.y, w: b.opts.unitsX, d: b.opts.unitsY };
    if (floor.some((f) => rectsOverlap({ x: f.x, y: f.y, w: f.opts.unitsX, d: f.opts.unitsY }, r))) gone.add(b.id);
    else floor.push(b);
  }
  const kept = placed.filter((b) => !gone.has(st.root.get(b.id) ?? b.id));
  if (!kept.length) return [];
  const x0 = Math.min(...kept.map((b) => b.x));
  const y0 = Math.min(...kept.map((b) => b.y));
  const index = new Map(kept.map((b, i) => [b.id, i]));
  return kept.map(({ id: _id, x, y, on, stretch: _st, ...rest }) => ({ ...rest, dx: x - x0, dy: y - y0, ...(on && index.has(on) ? { on: index.get(on)! } : {}) }));
}

/**
 * One entry from storage or a file, brought up to date, or null when there's
 * nothing usable in it. Version 0 entries (and templates) hold one bin's
 * options (`opts`) instead of a list of bins.
 */
export function cleanEntry(v: unknown, clean: BinCleaner): LibraryEntry | null {
  if (!isObject(v)) return null;
  const list = Array.isArray(v.bins) ? v.bins : isObject(v.opts) ? [{ dx: 0, dy: 0, opts: v.opts, contents: v.contents, compContents: v.compContents }] : null;
  if (!list) return null;
  const bins = cleanEntryBins(list, clean);
  if (!bins.length) return null;
  const half = v.half === true;
  const used = new Set(bins.flatMap((b) => (b.opts.cutouts ?? []).map((c) => c.toolId)));
  const tools = cleanTools(v.tools).filter((t) => used.has(t.id));
  const saved = Number(v.saved);
  return {
    id: typeof v.id === 'string' && v.id.trim() ? v.id.trim().slice(0, 40) : newId(),
    name: cleanName(v.name) || defaultEntryName(bins, half),
    ...(half ? { half: true as const } : {}),
    bins,
    ...(tools.length ? { tools } : {}),
    saved: Number.isFinite(saved) && saved > 0 ? saved : 0,
  };
}

/** A whole library from storage or a file: every usable entry, ids made unique. */
export function cleanLibrary(list: unknown[], clean: BinCleaner): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  const ids = new Set<string>();
  for (const v of list) {
    if (out.length >= MAX_ENTRIES) break;
    const e = cleanEntry(v, clean);
    if (!e) continue;
    if (ids.has(e.id)) e.id = newId();
    ids.add(e.id);
    out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

/** What a bin is called, from its label or what's in it ('' when neither says). */
function binWords(b: Pick<LibraryBin, 'opts' | 'contents' | 'compContents'>): string {
  return (
    labelCaption(b).trim() ||
    contentLines(b.contents)[0] ||
    Object.values(b.compContents ?? {}).flatMap((t) => contentLines(t))[0] ||
    ''
  );
}

/** A name for bins about to be saved: the label, else what's in it, else the size and inside ("2×1×3u 3 compartments"). */
export function defaultEntryName(bins: Pick<LibraryBin, 'opts' | 'contents' | 'compContents' | 'on'>[], half = false): string {
  const named = bins.map(binWords).filter(Boolean);
  const first = bins.find((b) => b.on === undefined) ?? bins[0];
  if (!first) return 'Bin';
  const base = bins.length === 1 ? named[0] || binLabel(sanitizeBin({ ...DEFAULT_BIN, ...first.opts }), half ? { half: true } : undefined) : named.length ? `${named[0]} + ${bins.length - 1} more` : `Set of ${bins.length} bins`;
  return cleanName(base) || 'Bin';
}

export interface EntryOptions {
  /** Its name ('' or missing: defaultEntryName). */
  name?: string;
  /** The bins are on a half grid. */
  half: boolean;
  /** Keep what's in them (contents, per compartment too). */
  contents: boolean;
  /** The project's tool library: the tools the bins' pockets came from go with them. */
  tools?: readonly Tool[];
  /** Names already in the library (the new name is made unique). */
  taken?: readonly string[];
  now?: number;
}

/**
 * Placed bins as a library entry: kept together as they're arranged, a stack
 * as a stack (a bin stacked on a bin left out stands on the floor). Every
 * field of a placed bin is kept except its id, place and stretch.
 */
export function entryFromBins(bins: readonly PlacedBin[], o: EntryOptions): LibraryEntry | null {
  if (!bins.length) return null;
  const g = groupBounds([...bins]);
  const index = new Map(bins.map((b, i) => [b.id, i]));
  const list: LibraryBin[] = bins.map((b) => {
    const { id: _id, x, y, stretch: _st, on, contents, compContents, ...rest } = b;
    return {
      ...structuredClone(rest),
      dx: x - g.x,
      dy: y - g.y,
      ...(o.contents && contents ? { contents } : {}),
      ...(o.contents && compContents ? { compContents: { ...compContents } } : {}),
      ...(on && index.has(on) ? { on: index.get(on)! } : {}),
    };
  });
  const used = new Set(list.flatMap((b) => (b.opts.cutouts ?? []).map((c) => c.toolId)));
  const tools = (o.tools ?? []).filter((t) => used.has(t.id)).map((t) => structuredClone(t));
  return {
    id: newId(),
    name: uniqueTemplateName(cleanName(o.name) || defaultEntryName(list, o.half), [...(o.taken ?? [])]),
    ...(o.half ? { half: true as const } : {}),
    bins: list,
    ...(tools.length ? { tools } : {}),
    saved: o.now ?? Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Showing
// ---------------------------------------------------------------------------

/** "2 × 3 u · 6u · lip · 3 compartments", or "3 bins · 4 × 2 u" for a set. */
export function entrySummary(e: Pick<LibraryEntry, 'bins' | 'half'>): string {
  const u = (n: number) => (e.half ? n / 2 : n);
  const grid = e.half ? ' · half grid' : '';
  if (e.bins.length === 1) {
    const o = sanitizeBin({ ...DEFAULT_BIN, ...e.bins[0].opts });
    const c = activeContainer(o);
    return `${u(o.unitsX)} × ${u(o.unitsY)} u · ${c ? `${c.def.label.toLowerCase()} · ${o.heightUnits}u` : templateSummary(o)}${grid}`;
  }
  const g = groupBounds(e.bins.map((b) => ({ x: b.dx, y: b.dy, opts: b.opts })));
  const stacked = e.bins.some((b) => b.on !== undefined) ? ' · stacked' : '';
  return `${e.bins.length} bins · ${u(g.w)} × ${u(g.d)} u${stacked}${grid}`;
}

/** What's in it, on one line ('' when nothing is noted). */
export function entryContents(e: Pick<LibraryEntry, 'bins'>): string {
  return e.bins
    .flatMap((b) => [...contentLines(b.contents), ...Object.values(b.compContents ?? {}).flatMap((t) => contentLines(t))])
    .join(', ');
}

/** Does the entry match a search? Every word has to be in its name, summary, contents or label text. */
export function entryMatches(e: LibraryEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [e.name, entrySummary(e), entryContents(e), ...e.bins.map((b) => b.opts.labelText ?? '')].join('\n').toLowerCase();
  return words.every((w) => hay.includes(w));
}

// ---------------------------------------------------------------------------
// Importing: merge, de-duplicated
// ---------------------------------------------------------------------------

/** Plain data with object keys sorted, so the same bin always reads the same. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (!isObject(v)) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = canonical(v[k]);
  return out;
}

/** What makes two entries the same bins (not their name, id or date). */
export function entryFingerprint(e: Pick<LibraryEntry, 'bins' | 'half'>): string {
  return JSON.stringify(canonical({ half: !!e.half, bins: e.bins }));
}

export interface MergeReport {
  /** New to the library. */
  added: number;
  /** Same id, the incoming copy newer: it replaced the one here. */
  updated: number;
  /** In the library already (same id, or the same bins under another name). */
  same: number;
  /** Same id, the copy here newer: kept. */
  older: number;
}

/**
 * Entries from a file joined to the library. Same id: the newer copy stays.
 * The same bins under another id are there already. New names that clash get
 * a number.
 */
export function mergeLibrary(current: LibraryEntry[], incoming: LibraryEntry[]): { entries: LibraryEntry[]; report: MergeReport } {
  const report: MergeReport = { added: 0, updated: 0, same: 0, older: 0 };
  let out = [...current];
  for (const inc of incoming) {
    const fp = entryFingerprint(inc);
    const at = out.findIndex((e) => e.id === inc.id);
    if (at >= 0) {
      const cur = out[at];
      if (entryFingerprint(cur) === fp && cur.name === inc.name) report.same++;
      else if (inc.saved > cur.saved) {
        out = out.map((e, i) => (i === at ? inc : e));
        report.updated++;
      } else report.older++;
      continue;
    }
    if (out.some((e) => entryFingerprint(e) === fp)) {
      report.same++;
      continue;
    }
    if (out.length >= MAX_ENTRIES) break;
    out.push({ ...inc, name: uniqueTemplateName(inc.name, out.map((e) => e.name)) });
    report.added++;
  }
  return { entries: out, report };
}

// ---------------------------------------------------------------------------
// Placing in a drawer
// ---------------------------------------------------------------------------

/**
 * The entry's bins in the cells of a drawer: ×2 onto a half grid, halved onto
 * a full one (rounded down, at least one cell, like switching a drawer's half
 * grid off), and no bigger than bins get there. `rounded[i]`: bin i changed size.
 */
export function binsInCells(e: Pick<LibraryEntry, 'bins' | 'half'>, half: boolean): { bins: LibraryBin[]; rounded: boolean[] } {
  const from = e.half ? 2 : 1;
  const to = half ? 2 : 1;
  const max = half ? MAX_CELLS : MAX_BIN_UNITS;
  const rounded: boolean[] = [];
  const bins = e.bins.map((b) => {
    const conv = (n: number) => (from === to ? n : to > from ? n * 2 : Math.floor(n / 2));
    const size = (n: number) => Math.min(max, Math.max(1, conv(n)));
    const unitsX = size(b.opts.unitsX);
    const unitsY = size(b.opts.unitsY);
    rounded.push(unitsX * from !== b.opts.unitsX * to || unitsY * from !== b.opts.unitsY * to);
    const same = unitsX === b.opts.unitsX && unitsY === b.opts.unitsY;
    return { ...b, dx: conv(b.dx), dy: conv(b.dy), opts: same ? b.opts : sanitizeBin({ ...b.opts, unitsX, unitsY }) };
  });
  return { bins, rounded };
}

/** Where a drawer takes the entry. */
export interface PlaceTarget {
  layout: GridLayout;
  /** The drawer's bins. */
  bins: readonly PlacedBin[];
  /** What the printers take (bedfit.ts usableBeds). */
  bed: Beds;
  /** Room above the baseplate floor, mm (planJob's DrawerJob.room); missing or Infinity when the drawer's height isn't set. */
  room?: number;
  /** A wall grid: bins don't stack on it. */
  wall?: boolean;
}

export type PlaceNoteKind = 'units' | 'unstacked' | 'bed' | 'pockets' | 'walls' | 'lowered' | 'tall';

export interface PlaceNote {
  kind: PlaceNoteKind;
  /** What changed, in a sentence. */
  text: string;
}

export interface Placement {
  /** The new bins, with fresh ids, at their place in the drawer (stacks linked). */
  bins: PlacedBin[];
  /** Where the entry's front-left corner went, cells. */
  at: [number, number];
  /** What had to change to fit, each kind at most once. */
  notes: PlaceNote[];
}

/** Every cell under the rect is a full grid cell (not a narrower edge cell). */
function onFullCells(layout: GridLayout, r: CellRect): boolean {
  const full = (xs: number[], i: number, n: number, p: number) => cellSizes(xs, i, n, p).every((v) => Math.abs(v - p) < 1e-4);
  return full(layout.xs, r.x, r.w, layout.pitchX) && full(layout.ys, r.y, r.d, layout.pitchY);
}

/** The bin's floor bin in the entry (the bin itself on the floor). */
function rootIndex(bins: readonly LibraryBin[], i: number): number {
  let cur = i;
  for (let k = 0; k < bins.length; k++) {
    const on = bins[cur].on;
    if (on === undefined || !bins[on] || on === cur) break;
    cur = on;
  }
  return cur;
}

/** Outside the grid every cell is a full pitch (layout/drawer.ts cellSizes): where a probe has full cells. */
const FAR = -1000;

interface Prepared {
  bins: LibraryBin[];
  /** The saved bin each came from (for its size as saved). */
  src: LibraryBin[];
  notes: Map<PlaceNoteKind, string>;
}

/** The entry ready for a drawer: in its cells, without stacks on a wall grid, cut down to what the printer takes. */
function prepare(e: LibraryEntry, t: PlaceTarget): Prepared {
  const notes = new Map<PlaceNoteKind, string>();
  const half = !!t.layout.halfGrid;
  const conv = binsInCells(e, half);
  let bins = conv.bins;
  let src = [...e.bins];
  if (conv.rounded.some(Boolean)) {
    notes.set('units', e.half && !half ? 'This drawer has a full grid, so its half-unit sizes were rounded down to whole units.' : 'It was made smaller: bins are at most 12 × 12 u.');
  }
  if (t.wall && bins.some((b) => b.on !== undefined)) {
    const keep = bins.map((b, i) => (b.on === undefined ? i : -1)).filter((i) => i >= 0);
    bins = keep.map((i) => ({ ...bins[i], on: undefined }));
    src = keep.map((i) => src[i]);
    notes.set('unstacked', 'Bins don’t stack on a wall grid, so only the bottom ones were placed.');
  }
  // What the printer takes, on full cells (the spot found later may only need it smaller).
  bins = bins.map((b) => {
    const probe: PlacedBin = { id: '#probe', x: FAR, y: FAR, opts: b.opts };
    const fit = shrinkToBed(t.layout, probe, t.bed);
    if (fit === probe) return b;
    notes.set('bed', 'It was made smaller to fit the printer.');
    // A stacked bin keeps its floor bin's footprint; only its height can change.
    const opts = b.on === undefined ? fit.opts : sanitizeBin({ ...b.opts, heightMode: fit.opts.heightMode, heightUnits: fit.opts.heightUnits });
    return { ...b, opts };
  });
  // Stacked bins take their floor bin's footprint.
  bins = bins.map((b, i) => {
    const r = bins[rootIndex(bins, i)];
    if (r === b || (r.dx === b.dx && r.dy === b.dy && r.opts.unitsX === b.opts.unitsX && r.opts.unitsY === b.opts.unitsY)) return b;
    return { ...b, dx: r.dx, dy: r.dy, opts: sanitizeBin({ ...b.opts, unitsX: r.opts.unitsX, unitsY: r.opts.unitsY }) };
  });
  return { bins, src, notes };
}

/** The floor bins' cells relative to the entry's corner, as they'd go into this drawer: for the preview while dragging it onto the grid. */
export function placementFootprint(e: LibraryEntry, t: PlaceTarget): CellRect[] {
  return prepare(e, t)
    .bins.filter((b) => b.on === undefined)
    .map((b) => ({ x: b.dx, y: b.dy, w: b.opts.unitsX, d: b.opts.unitsY }));
}

/** Height in 7 mm units of a bin, rounded down (whichever way its height is given). */
const unitsBelow = (o: BinOptions) => (o.heightMode && o.heightMode !== 'units' ? Math.floor(binBodyHeight(o) / HEIGHT_UNIT + EPS) : o.heightUnits);

const inMm = (o: BinOptions) => !!o.heightMode && o.heightMode !== 'units';

/** Bins whose height is theirs to lower (a container's parts need its height). Sized in mm: once it's whole units no taller than now. */
const lowerable = (b: PlacedBin) => !activeContainer(b.opts) && (inMm(b.opts) ? unitsBelow(b.opts) >= MIN_HEIGHT_UNITS : b.opts.heightUnits > MIN_HEIGHT_UNITS);

function lowerOne(o: BinOptions): BinOptions {
  return sanitizeBin({ ...o, heightMode: 'units', heightUnits: Math.max(MIN_HEIGHT_UNITS, inMm(o) ? unitsBelow(o) : o.heightUnits - 1) });
}

/** Every column no taller than the room above the baseplate floor: the tallest bins come down a unit at a time. */
function fitRoom(layout: GridLayout, bins: PlacedBin[], room: number, notes: Map<PlaceNoteKind, string>): PlacedBin[] {
  if (!(room < Infinity)) return bins;
  let out = bins;
  const lowered = new Set<string>();
  for (let guard = 0; guard < 400; guard++) {
    const places = stackPlaces(layout, out);
    const over = [...stacksOf(out).columns.values()].filter((col) => places.get(col[col.length - 1].id)!.top > room + EPS);
    if (!over.length) break;
    const cand = over
      .flat()
      .filter(lowerable)
      .sort((a, b) => binTotalHeight(b.opts) - binTotalHeight(a.opts))[0];
    if (!cand) {
      notes.set('tall', 'It’s taller than this drawer, and can’t be made lower here.');
      break;
    }
    out = out.map((b) => (b.id === cand.id ? { ...b, opts: lowerOne(b.opts) } : b));
    lowered.add(cand.id);
  }
  if (lowered.size) {
    const one = out.find((b) => lowered.has(b.id))!;
    notes.set('lowered', lowered.size === 1 && out.length === 1 ? `It was lowered to ${one.opts.heightUnits}u to fit the drawer.` : 'It was made lower to fit the drawer.');
  }
  return out;
}

/** Saved on full cells of its own grid: its body size then, mm. */
function savedSize(b: LibraryBin, half: boolean) {
  const p = half ? GRID / 2 : GRID;
  return binSize(b.opts, { x: Array(b.opts.unitsX).fill(p), y: Array(b.opts.unitsY).fill(p), ...(half ? { half: true } : {}) });
}

/**
 * A bin that came out another size than it was saved (rounded to whole units,
 * cut down for the printer, on narrower edge cells): fixed-size walls and tool
 * pockets that no longer fit are left out (like copying a layout, or a template).
 */
function fitInside(b: PlacedBin, was: { w: number; d: number }, layout: GridLayout, notes: Map<PlaceNoteKind, string>): PlacedBin {
  const cells = binCellsAt(layout, b);
  const now = binSize(b.opts, cells);
  if (Math.abs(now.w - was.w) < 0.05 && Math.abs(now.d - was.d) < 0.05) return b;
  let opts = b.opts;
  if (opts.cutouts?.length) {
    const area = cutoutArea(now.w, now.d, opts.lip, opts.lipStyle);
    const keep = opts.cutouts.filter((c) => {
      const r = pocketBox(c);
      return r.x0 >= area.x0 - 0.01 && r.y0 >= area.y0 - 0.01 && r.x1 <= area.x1 + 0.01 && r.y1 <= area.y1 + 0.01;
    });
    if (keep.length < opts.cutouts.length) {
      const n = opts.cutouts.length - keep.length;
      notes.set('pockets', `${n} tool pocket${n === 1 ? '' : 's'} didn’t fit its new size and ${n === 1 ? 'was' : 'were'} left out.`);
      opts = { ...opts, cutouts: keep };
    }
  }
  if (opts.layout) {
    const fit = fitLayout(opts.layout, binInnerSize(opts, cells));
    if (fit.dropped.length) {
      const n = fit.dropped.length;
      notes.set('walls', `${n} fixed-size wall${n === 1 ? '' : 's'} didn’t fit its new size and ${n === 1 ? 'was' : 'were'} left out.`);
      opts = { ...opts, layout: fit.layout };
    }
  }
  return opts === b.opts ? b : carryContents(b, sanitizeBin(opts));
}

/**
 * Where an entry goes in a drawer, and the bins it becomes there, or why it
 * can't go in. Like pasting: at `prefer` when it fits there, else the first
 * free spot from the front-left corner, row by row, on full cells when there
 * is one (narrower edge cells would make it smaller). Like any new bin it is
 * cut down to what the printer takes (bedfit.ts), and lowered to fit the
 * drawer's height; stacked bins keep their floor bin's footprint.
 */
export function planPlacement(e: LibraryEntry, t: PlaceTarget, prefer?: [number, number] | null): Placement | { error: string } {
  const { bins, src, notes } = prepare(e, t);
  const { nx, ny } = t.layout;
  const taken = withBlocked([...t.bins], t.layout.mask);
  const clip: ClipBin[] = bins.map(({ dx, dy, opts }) => ({ dx, dy, opts }));
  const floor = bins.filter((b) => b.on === undefined);
  const fits = (x: number, y: number) => clipFits(taken, clip, x, y, nx, ny);
  const full = (x: number, y: number) => floor.every((b) => onFullCells(t.layout, { x: x + b.dx, y: y + b.dy, w: b.opts.unitsX, d: b.opts.unitsY }));
  let at: [number, number] | null = prefer && fits(prefer[0], prefer[1]) ? [prefer[0], prefer[1]] : null;
  for (let y = 0; !at && y < ny; y++) for (let x = 0; !at && x < nx; x++) if (fits(x, y) && full(x, y)) at = [x, y];
  at ??= findSpot(taken, clip, nx, ny);
  if (!at) {
    const g = groupBounds(floor.map((b) => ({ x: b.dx, y: b.dy, opts: b.opts })));
    const u = (n: number) => (t.layout.halfGrid ? n / 2 : n);
    return { error: `No free ${u(g.w)} × ${u(g.d)} u spot in this drawer.` };
  }
  const [x0, y0] = at;
  const ids = bins.map(() => newId());
  let placed: PlacedBin[] = bins.map((b, i) => {
    const { dx, dy, on, ...rest } = b;
    return { ...structuredClone(rest), id: ids[i], x: x0 + dx, y: y0 + dy, ...(on !== undefined && ids[on] ? { on: ids[on] } : {}) };
  });
  // Narrower edge cells may need it smaller still (never bigger: it stays in the spot it found).
  placed = placed.map((b) => {
    if (b.on) return b;
    const fit = shrinkToBed(t.layout, b, t.bed);
    if (fit !== b) notes.set('bed', 'It was made smaller to fit the printer.');
    return fit;
  });
  placed = alignStacks(placed);
  placed = placed.map((b, i) => fitInside(b, savedSize(src[i], !!e.half), t.layout, notes));
  placed = fitRoom(t.layout, placed, t.room ?? Infinity, notes);
  // Nothing it found overlaps (the checks above only ever made bins smaller).
  if (!placed.every((b) => b.on || canPlace(taken, { x: b.x, y: b.y, w: b.opts.unitsX, d: b.opts.unitsY }, nx, ny))) return { error: 'It doesn’t fit in this drawer.' };
  return { bins: placed, at, notes: [...notes].map(([kind, text]) => ({ kind, text })) };
}
