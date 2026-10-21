/**
 * What's in every bin, and where it is.
 *
 * - Contents: free text per bin (`PlacedBin.contents`, one item per line) and
 *   per compartment (`PlacedBin.compContents`, keyed by compartment key). They
 *   live next to `opts`, never in it, so they're not part of any mesh key and
 *   editing them never rebuilds geometry.
 * - Search across every drawer: contents, bin and compartment label text, tool
 *   cutout names and drawer names; case- and accent-insensitive, every word
 *   must match, with a little typo tolerance.
 * - A printable top-view drawer map (SVG, mm units, optionally tiled 1:1 over
 *   several pages) and a CSV inventory.
 *
 * Everything here is pure (no store, no DOM).
 */
import { BASE_TOP, GRID, WALL } from './geometry/spec';
import { binInnerSize, binLabel, binLayout, binSize, type BinCells, type BinOptions } from './geometry/bin';
import { labelLines } from './geometry/labels';
import { labelPlainText } from './geometry/labelIcons';
import { labelCaptionText } from './geometry/labelContents';
import { placedOutline } from './geometry/cutouts';
import { compartmentAt, resolveLayout, uniformLayout, type Compartment, type DividerLayout, type Rect } from './dividers';
import { cellEdge, computeLayout } from './layout/drawer';
import { formatLength, type InchPrecision, type Units } from './units';
import { binCellsAt, type NamedDrawer, type PlacedBin } from './project';

// ---------------------------------------------------------------------------
// Contents
// ---------------------------------------------------------------------------

export const CONTENTS_MAX_CHARS = 4000;
export const CONTENTS_MAX_LINES = 200;
const MAX_COMP_KEYS = 256;

/**
 * Clean contents text from user input or a file: no control characters (new
 * lines stay), no trailing spaces, no blank lines at the start or end, at most
 * CONTENTS_MAX_LINES lines and CONTENTS_MAX_CHARS characters. '' = nothing.
 */
export function sanitizeContents(v: unknown): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
  const lines = t.split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return [...lines.slice(0, CONTENTS_MAX_LINES).join('\n')].slice(0, CONTENTS_MAX_CHARS).join('');
}

/** The items in contents text: trimmed, non-blank lines, list bullets dropped. */
export function contentLines(text: string | undefined | null): string[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.trim().replace(/^[-*•·–]\s+/, '').trim())
    .filter(Boolean);
}

/** Per-compartment contents from saved data; undefined when there are none. */
export function cleanCompContents(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
    if (n >= MAX_COMP_KEYS) break;
    const text = sanitizeContents(t);
    if (!k || k.length > 500 || !text) continue;
    out[k] = text;
    n++;
  }
  return n ? out : undefined;
}

/** A saved bin's contents fields, only those that are set (so bins without contents load unchanged). */
export function cleanBinContents(b: unknown): Pick<PlacedBin, 'contents' | 'compContents'> {
  const r = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const out: Pick<PlacedBin, 'contents' | 'compContents'> = {};
  const contents = sanitizeContents(r.contents);
  if (contents) out.contents = contents;
  const comp = cleanCompContents(r.compContents);
  if (comp) out.compContents = comp;
  return out;
}

/** The bin with new contents (the field is left out when empty). */
export function withContents(b: PlacedBin, text: string): PlacedBin {
  const out = { ...b };
  const clean = sanitizeContents(text);
  if (clean) out.contents = clean;
  else delete out.contents;
  return out;
}

/** The bin with new contents for one compartment. */
export function withCompContents(b: PlacedBin, key: string, text: string): PlacedBin {
  const comp = { ...b.compContents };
  const clean = sanitizeContents(text);
  if (clean) comp[key] = clean;
  else delete comp[key];
  const out: PlacedBin = { ...b, compContents: comp };
  if (!Object.keys(comp).length) delete out.compContents;
  return out;
}

/** The divider layout a bin's compartments come from: its own, or the divX × divY split. */
function layoutOf(o: BinOptions): DividerLayout {
  return o.layout ?? uniformLayout(o.divX, o.divY);
}

function joinTexts(texts: string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const t of texts) {
    for (const l of t.split('\n')) {
      const k = l.trim().toLowerCase();
      if (k && seen.has(k)) continue;
      if (k) seen.add(k);
      lines.push(l);
    }
  }
  return sanitizeContents(lines.join('\n'));
}

/**
 * Keep per-compartment contents with their compartments when the bin's walls
 * change to `next`: keys that still exist keep theirs; a compartment that's
 * gone hands its contents to the new compartment covering its spot (merged
 * compartments get both lists); whatever has nowhere to go (and everything,
 * once the bin has fewer than two compartments) joins the bin's own contents,
 * so nothing is lost. Returns the bin with `next` as its options.
 */
export function carryContents(b: PlacedBin, next: BinOptions): PlacedBin {
  const out: PlacedBin = { ...b, opts: next };
  const comp = b.compContents;
  if (!comp || !Object.keys(comp).length || next === b.opts) return out;
  const s0 = binInnerSize(b.opts);
  const s1 = binInnerSize(next);
  const r1 = resolveLayout(layoutOf(next), s1.w, s1.d);
  const live = new Set(r1.compartments.map((c) => c.key));
  const many = r1.compartments.length > 1;
  if (many && Object.keys(comp).every((k) => live.has(k))) return out;
  const r0 = resolveLayout(layoutOf(b.opts), s0.w, s0.d);
  const moved: Record<string, string[]> = {};
  const spill: string[] = [];
  for (const [k, t] of Object.entries(comp)) {
    if (!many) spill.push(t);
    else if (live.has(k)) (moved[k] ??= []).unshift(t);
  }
  if (many) {
    for (const [k, t] of Object.entries(comp)) {
      if (live.has(k)) continue;
      const oc = r0.compartments.find((c) => c.key === k);
      // The old compartment's middle, scaled into the new cavity (the bin may have been resized too).
      const nc = oc && compartmentAt(r1, (oc.point[0] * s1.w) / (s0.w || 1), (oc.point[1] * s1.d) / (s0.d || 1));
      if (nc) (moved[nc.key] ??= []).push(t);
      else spill.push(t);
    }
  }
  const nextComp: Record<string, string> = {};
  for (const [k, texts] of Object.entries(moved)) {
    const t = joinTexts(texts);
    if (t) nextComp[k] = t;
  }
  if (Object.keys(nextComp).length) out.compContents = nextComp;
  else delete out.compContents;
  if (spill.length) {
    const t = joinTexts([b.contents ?? '', ...spill]);
    if (t) out.contents = t;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inventory entries
// ---------------------------------------------------------------------------

/** Spreadsheet-style column name: 0 → A, 25 → Z, 26 → AA. */
export function columnName(i: number): string {
  let n = Math.max(0, Math.floor(i));
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Grid reference of a cell: column letter from the left, row number from the front ("B3"). */
export function cellName(x: number, y: number): string {
  return `${columnName(x)}${Math.max(0, Math.floor(y)) + 1}`;
}

export interface CompEntry {
  key: string;
  /** Where it is in the bin: "front left", "back", "middle 2". */
  name: string;
  /** Its own label text ('' when it uses the bin's), lines joined with " / ". */
  label: string;
  contents: string[];
}

export interface BinEntry {
  drawerId: string;
  drawerName: string;
  bin: PlacedBin;
  /** Footprint, "2×1". */
  size: string;
  /** "2×1×3u 4 compartments". */
  desc: string;
  /** Grid reference of the bin's front-left cell, "B3". */
  pos: string;
  /** Bin label text, lines joined with " / " ('' = none). */
  label: string;
  /** The bin's own items, plus any left over from compartments it no longer has. */
  contents: string[];
  /** Its compartments (reading order: back to front, left to right), when it has two or more. */
  comps: CompEntry[];
  /** Names of its tool cutouts. */
  tools: string[];
}

// Label text as printed: icons by name (labelIcons.ts).
const oneLine = (text: string | undefined | null) => labelPlainText(labelLines(text)).split('\n').filter(Boolean).join(' / ');

/** Back to front, then left to right: the order you read the map in. */
const readingOrder = (a: Compartment, b: Compartment) => b.bounds.y1 - a.bounds.y1 || a.bounds.x0 - b.bounds.x0;

/** Names compartments by where they sit in the bin; repeated names are numbered in reading order. */
function placeNames(comps: Compartment[], W: number, D: number): string[] {
  const third = (lo: number, hi: number, size: number, a: string, b: string) => {
    if (!(size > 0) || (hi - lo) / size > 0.7) return '';
    const m = (lo + hi) / 2 / size;
    return m < 0.4 ? a : m > 0.6 ? b : 'middle';
  };
  const raw = comps.map((c) => {
    const row = third(c.bounds.y0, c.bounds.y1, D, 'front', 'back');
    const col = third(c.bounds.x0, c.bounds.x1, W, 'left', 'right');
    if (row === 'middle' && col === 'middle') return 'center';
    return [row, col].filter(Boolean).join(' ') || 'whole bin';
  });
  const count = new Map<string, number>();
  for (const n of raw) count.set(n, (count.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  return raw.map((n) => {
    if ((count.get(n) ?? 0) < 2) return n;
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return `${n} ${k}`;
  });
}

/** One bin's inventory. `cells`: its partial edge cells, as for binLayout. */
export function binEntry(d: Pick<NamedDrawer, 'id' | 'name'>, b: PlacedBin, cells?: Partial<BinCells> | null): BinEntry {
  const o = b.opts;
  const own = b.compContents ?? {};
  const contents = contentLines(b.contents);
  const comps: CompEntry[] = [];
  const used = new Set<string>();
  if (o.interior === 'compartments') {
    const r = binLayout(o, cells);
    if (r.compartments.length > 1) {
      const sorted = [...r.compartments].sort(readingOrder);
      const names = placeNames(sorted, r.innerW, r.innerD);
      sorted.forEach((c, i) => {
        used.add(c.key);
        comps.push({ key: c.key, name: names[i], label: oneLine(o.layout?.comps?.[c.key]?.labelText), contents: contentLines(own[c.key]) });
      });
    }
  }
  // Contents of compartments the bin doesn't have (any more) stay with the bin.
  for (const [k, t] of Object.entries(own)) if (!used.has(k)) contents.push(...contentLines(t));
  const tools = o.interior === 'cutouts' ? (o.cutouts ?? []).map((c) => c.name.trim()).filter(Boolean) : [];
  return {
    drawerId: d.id,
    drawerName: d.name,
    bin: b,
    size: `${o.unitsX}×${o.unitsY}`,
    desc: binLabel(o),
    pos: cellName(b.x, b.y),
    label: oneLine(labelCaptionText(b)),
    contents,
    comps,
    tools,
  };
}

/** Bins front row first, left to right. */
export function byPosition(bins: PlacedBin[]): PlacedBin[] {
  return [...bins].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Every bin of every drawer, drawer by drawer, front row first. */
export function binEntries(drawers: NamedDrawer[]): BinEntry[] {
  const out: BinEntry[] = [];
  for (const d of drawers) {
    const layout = computeLayout(d.drawer);
    for (const b of byPosition(d.bins)) out.push(binEntry(d, b, binCellsAt(layout, b)));
  }
  return out;
}

/** True when the bin has anything to show: label text, contents or named tools. */
export function hasInventory(e: BinEntry): boolean {
  return !!e.label || e.contents.length > 0 || e.tools.length > 0 || e.comps.some((c) => c.label || c.contents.length);
}

/** "2×1 “Screws”". */
export function binTitle(e: Pick<BinEntry, 'size' | 'label'>): string {
  return e.label ? `${e.size} “${e.label}”` : e.size;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type FindKind = 'label' | 'contents' | 'tool' | 'drawer';

export interface FindResult {
  /** Unique per drawer / bin / compartment. */
  key: string;
  kind: FindKind;
  drawerId: string;
  drawerName: string;
  binId?: string;
  compKey?: string;
  /** "2×1 “Screws”". */
  bin?: string;
  /** Grid reference, "B3". */
  pos?: string;
  /** Compartment: its label, else where it is ("front left"). */
  comp?: string;
  /** The best matching line. */
  text: string;
  /** Matched character ranges in `text` ([start, end)), for highlighting. */
  marks: [number, number][];
  /** Further matching lines in the same bin (or compartment). */
  more: number;
  score: number;
}

interface Folded {
  text: string;
  /** Original index of each folded character (plus the original length at the end). */
  map: number[];
}

/** Lower case, accents dropped, × read as x; keeps a map back to the original string. */
function fold(s: string): Folded {
  let text = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = ch === '×' ? 'x' : ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < f.length; k++) map.push(i);
    text += f;
    i += ch.length;
  }
  map.push(s.length);
  return { text, map };
}

const ALNUM = /[\p{L}\p{N}]/u;
const DIGIT = /\p{N}/u;
const isAlnum = (c: string | undefined) => !!c && ALNUM.test(c);
const isDigit = (c: string | undefined) => !!c && DIGIT.test(c);

/** A word starts here: after a non-letter, or where letters turn into digits (M|3) and back. */
function wordStart(t: string, i: number): boolean {
  return i === 0 || !isAlnum(t[i - 1]) || isDigit(t[i - 1]) !== isDigit(t[i]);
}

function wordEnd(t: string, j: number): boolean {
  return j >= t.length || !isAlnum(t[j]) || isDigit(t[j - 1]) !== isDigit(t[j]);
}

/** Optimal string alignment distance (one swap of neighbours counts as one edit). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

interface TokenMatch {
  score: number;
  start: number;
  end: number;
}

/**
 * How well one query word matches folded text: 4 = a whole word, 3 = the start
 * of a word, 2 = inside a word (2+ letters), 1.5 / 1.2 = one typo off a word or
 * its start (4+ letters).
 */
function matchToken(f: Folded, tok: string): TokenMatch | null {
  let best: TokenMatch | null = null;
  for (let i = f.text.indexOf(tok); i >= 0; i = f.text.indexOf(tok, i + 1)) {
    const ws = wordStart(f.text, i);
    const s = ws && wordEnd(f.text, i + tok.length) ? 4 : ws ? 3 : tok.length >= 2 ? 2 : 0;
    if (s > (best?.score ?? 0)) best = { score: s, start: i, end: i + tok.length };
    if (s === 4) break;
  }
  if (best || tok.length < 4) return best;
  for (const m of f.text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const w = m[0];
    const at = m.index ?? 0;
    if (Math.abs(w.length - tok.length) <= 1 && editDistance(tok, w) <= 1) return { score: 1.5, start: at, end: at + w.length };
    if (tok.length >= 5 && w.length > tok.length && editDistance(tok, w.slice(0, tok.length)) <= 1) {
      best ??= { score: 1.2, start: at, end: at + tok.length };
    }
  }
  return best;
}

/** Query words, folded and deduplicated. */
export function queryTokens(q: string): string[] {
  return [...new Set(fold(q).text.split(/\s+/).filter(Boolean))];
}

const KIND_WEIGHT: Record<FindKind, number> = { label: 1.2, contents: 1, tool: 1, drawer: 0.9 };
const KIND_ORDER: Record<FindKind, number> = { label: 0, contents: 1, tool: 2, drawer: 3 };

interface Candidate {
  kind: FindKind;
  drawer: NamedDrawer;
  order: number;
  entry?: BinEntry;
  comp?: CompEntry;
  text: string;
  /** Other text the bin is known by: words found only here count, at a lower score. */
  ctx: string[];
}

function mergeRanges(r: [number, number][]): [number, number][] {
  const s = [...r].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}

function candidates(drawers: NamedDrawer[]): Candidate[] {
  const out: Candidate[] = [];
  let order = 0;
  const entries = binEntries(drawers);
  for (const d of drawers) {
    out.push({ kind: 'drawer', drawer: d, order: order++, text: d.name, ctx: [] });
    for (const e of entries) {
      if (e.drawerId !== d.id) continue;
      const base = { drawer: d, entry: e };
      if (e.label) out.push({ ...base, kind: 'label', order: order++, text: e.label, ctx: [d.name] });
      for (const line of e.contents) out.push({ ...base, kind: 'contents', order: order++, text: line, ctx: [d.name, e.label] });
      for (const t of e.tools) out.push({ ...base, kind: 'tool', order: order++, text: t, ctx: [d.name, e.label] });
      for (const c of e.comps) {
        const cb = { ...base, comp: c };
        if (c.label) out.push({ ...cb, kind: 'label', order: order++, text: c.label, ctx: [d.name, e.label] });
        for (const line of c.contents) out.push({ ...cb, kind: 'contents', order: order++, text: line, ctx: [d.name, e.label, c.label || e.label] });
      }
    }
  }
  return out;
}

/**
 * Search every drawer. Every query word must match: in the line itself, or
 * (at a lower score) in what it belongs to (drawer name, bin label), as long as
 * at least one word matches the line. Results are grouped per bin (or
 * compartment), best first; ties go to the active drawer, then workspace order.
 */
export function searchInventory(
  drawers: NamedDrawer[],
  query: string,
  o: { activeDrawerId?: string; limit?: number } = {},
): FindResult[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const whole = tokens.join(' ');
  const hits: (FindResult & { order: number; kindOrder: number })[] = [];
  for (const c of candidates(drawers)) {
    const f = fold(c.text);
    const ctx = c.ctx.filter(Boolean).map(fold);
    let total = 0;
    let own = 0;
    const marks: [number, number][] = [];
    let ok = true;
    for (const tok of tokens) {
      const m = matchToken(f, tok);
      if (m) {
        total += m.score;
        own++;
        marks.push([f.map[m.start], f.map[m.end]]);
      } else if (ctx.some((x) => matchToken(x, tok))) total += 0.75;
      else {
        ok = false;
        break;
      }
    }
    if (!ok || !own) continue;
    const exact = f.text.trim().replace(/\s+/g, ' ') === whole ? 1 : 0;
    const score =
      (total / tokens.length) * KIND_WEIGHT[c.kind] + exact - Math.min(c.text.length, 80) / 1000 + (c.drawer.id === o.activeDrawerId ? 0.01 : 0);
    const e = c.entry;
    hits.push({
      key: [c.drawer.id, e?.bin.id ?? '', c.comp?.key ?? ''].join('|'),
      kind: c.kind,
      drawerId: c.drawer.id,
      drawerName: c.drawer.name,
      binId: e?.bin.id,
      compKey: c.comp?.key,
      bin: e ? binTitle(e) : undefined,
      pos: e?.pos,
      comp: c.comp ? c.comp.label || c.comp.name : undefined,
      text: c.text,
      marks: mergeRanges(marks),
      more: 0,
      score: Math.round(score * 1000) / 1000,
      order: c.order,
      kindOrder: KIND_ORDER[c.kind],
    });
  }
  hits.sort((a, b) => b.score - a.score || a.kindOrder - b.kindOrder || a.order - b.order);
  const byKey = new Map<string, FindResult>();
  const out: FindResult[] = [];
  for (const h of hits) {
    const seen = byKey.get(h.key);
    if (seen) {
      seen.more++;
      continue;
    }
    const { order: _o, kindOrder: _k, ...r } = h;
    void _o;
    void _k;
    byKey.set(h.key, r);
    out.push(r);
  }
  return out.slice(0, o.limit ?? 50);
}

// ---------------------------------------------------------------------------
// CSV inventory
// ---------------------------------------------------------------------------

/** One cell; quoted when needed. Text a spreadsheet would run as a formula gets a leading apostrophe. */
function csvCell(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header plus one row per item (a bin with nothing in it still gets a row). */
export function inventoryRows(drawers: NamedDrawer[]): string[][] {
  const rows = [['Drawer', 'Position', 'Bin', 'Label', 'Compartment', 'Item']];
  for (const e of binEntries(drawers)) {
    const base = [e.drawerName, e.pos, e.desc, e.label];
    const before = rows.length;
    for (const item of e.contents) rows.push([...base, '', item]);
    for (const c of e.comps) {
      const where = c.label ? `${c.name} (${c.label})` : c.name;
      for (const item of c.contents) rows.push([...base, where, item]);
    }
    for (const t of e.tools) rows.push([...base, 'Tool pocket', t]);
    if (rows.length === before) rows.push([...base, '', '']);
  }
  return rows;
}

export function inventoryCsv(drawers: NamedDrawer[]): string {
  return inventoryRows(drawers)
    .map((r) => r.map(csvCell).join(','))
    .join('\r\n')
    .concat('\r\n');
}

// ---------------------------------------------------------------------------
// Drawer map (SVG)
// ---------------------------------------------------------------------------

export interface MapOptions {
  units?: Units;
  precision?: InchPrecision;
}

/** A drawer's map: SVG markup in mm, origin at the top-left corner, back of the drawer at the top. */
export interface DrawerMap {
  id: string;
  name: string;
  /** Size in mm. */
  w: number;
  h: number;
  /** SVG children (everything inside the <svg> element). */
  body: string;
}

const FONT = 'Helvetica, Arial, sans-serif';
const LINE_H = 1.22;
/** Text size (mm) that's still comfortable to read on a printed map. */
const FLAT_READABLE = 3;

/** Helvetica / Arial advance widths (1/1000 em), so text can be fitted without a DOM to measure it in. */
const GLYPH_W: Record<string, number> = (() => {
  const w: Record<string, number> = {};
  const set = (chars: string, v: number) => {
    for (const c of chars) w[c] = v;
  };
  set('abdeghnopqu0123456789#$?_', 556);
  set('ckszvxy', 500);
  set('fjt/:;.,!', 278);
  set('il|', 222);
  set('r-()[]{}`', 333);
  set('mM', 833);
  set('w', 722);
  set('ABEKPSVXY&', 667);
  set('CDHNRUw', 722);
  set('FTZ', 611);
  set('GOQ', 778);
  set('L', 556);
  set('I ', 278);
  set('J', 500);
  set('W', 944);
  set('%', 889);
  set('@', 1015);
  set('+=<>×~', 584);
  set('"', 355);
  set("'", 191);
  set('*', 389);
  set('…', 1000);
  return w;
})();

/** Width of a line of text at a font size (same units), with a little slack for other sans-serif fonts. */
export function textWidth(s: string, size: number, bold = false): number {
  let t = 0;
  for (const ch of s) {
    let v = GLYPH_W[ch];
    if (v === undefined) {
      const base = ch.normalize('NFD')[0];
      v = GLYPH_W[base] ?? (ch.charCodeAt(0) < 0x2e80 ? 600 : 1000);
    }
    t += v;
  }
  return (t / 1000) * size * (bold ? 1.08 : 1) * 1.04;
}
const INK = '#1d2025';
const SOFT = '#6b7380';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n2 = (v: number) => String(Math.round(v * 100) / 100);

interface TextLine {
  text: string;
  bold?: boolean;
  dim?: boolean;
  /** Relative size (titles are a little bigger). */
  scale?: number;
}

interface PlacedLine extends TextLine {
  size: number;
}

/**
 * Greedy word wrap so each line measures at most `max` (`measure` defaults to
 * counting characters); words too long for a line are broken with a hyphen.
 */
export function wrapText(text: string, max: number, measure: (s: string) => number = (s) => [...s].length): string[] {
  if (measure(text) <= max) return [text];
  const out: string[] = [];
  let cur = '';
  for (let w of text.split(/\s+/).filter(Boolean)) {
    while (measure(w) > max) {
      if (cur) out.push(cur);
      cur = '';
      const chars = [...w];
      let k = 1;
      while (k < chars.length - 1 && measure(`${chars.slice(0, k + 1).join('')}-`) <= max) k++;
      out.push(`${chars.slice(0, k).join('')}-`);
      w = chars.slice(k).join('');
    }
    if (!cur) cur = w;
    else if (measure(`${cur} ${w}`) <= max) cur += ` ${w}`;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Lines fitted into a w × h box at the largest size from `max` down to `min`
 * where everything fits. Long lines wrap, unless keeping them whole costs
 * little in size (a list reads better one item per line). If nothing fits at
 * `min`, as many lines as fit are kept and the last is cut off with "…".
 */
export function fitLines(lines: TextLine[], w: number, h: number, max = 6, min = 1.6): { lines: PlacedLine[]; fits: boolean } {
  if (!lines.length || w <= 0 || h <= 0) return { lines: [], fits: true };
  const sized = (s: number) => lines.map((l) => ({ ...l, size: s * (l.scale ?? 1) }));
  const wrapped = (s: number) =>
    sized(s).flatMap((l) => wrapText(l.text, w, (t) => textWidth(t, l.size, l.bold)).map((text) => ({ ...l, text })));
  const height = (ls: PlacedLine[]) => ls.reduce((t, l) => t + l.size * LINE_H, 0);
  const flatFits = (s: number) => {
    const ls = sized(s);
    return height(ls) <= h + 1e-9 && ls.every((l) => textWidth(l.text, l.size, l.bold) <= w + 1e-9);
  };
  const top = Math.min(max, h / LINE_H);
  // Lists (3+ lines) stay one item per line while that's still easy to read (3 mm ≈ 8.5 pt).
  const keepFlat = (wrapAt: number) => Math.min(wrapAt * 0.8, lines.length >= 3 ? FLAT_READABLE : Infinity);
  let wrapAt = 0;
  let flatAt = 0;
  for (let s = top; s >= min - 1e-9 && !flatAt; s *= 0.94) {
    if (!wrapAt && height(wrapped(s)) <= h + 1e-9) wrapAt = s;
    if (flatFits(s)) flatAt = s;
    if (wrapAt && s < keepFlat(wrapAt)) break;
  }
  if (flatAt && flatAt >= keepFlat(wrapAt)) return { lines: sized(flatAt), fits: true };
  if (wrapAt) return { lines: wrapped(wrapAt), fits: true };
  // Smallest size: as many lines as fit, the last one marked as cut off.
  const s = Math.max(Math.min(min, top), 0.8);
  const all = wrapped(s);
  const kept: PlacedLine[] = [];
  let used = 0;
  for (const l of all) {
    if (used + l.size * LINE_H > h + 1e-9) break;
    kept.push(l);
    used += l.size * LINE_H;
  }
  if (kept.length && kept.length < all.length) {
    const last = kept[kept.length - 1];
    let text = last.text;
    while (text.length > 1 && textWidth(`${text}…`, last.size, last.bold) > w) text = text.slice(0, -1);
    kept[kept.length - 1] = { ...last, text: `${text.trimEnd()}…` };
  }
  return { lines: kept, fits: false };
}

/** SVG text for lines fitted into a box; short blocks are centered, longer ones read from the top left. */
function textBlock(lines: TextLine[], x: number, y: number, w: number, h: number, max = 6, min = 1.6): string {
  const { lines: ls, fits } = fitLines(lines, w, h, max, min);
  if (!ls.length) return '';
  const total = ls.reduce((t, l) => t + l.size * LINE_H, 0);
  const center = fits && ls.length <= 3;
  let cy = center ? y + (h - total) / 2 : y;
  const out: string[] = [];
  for (const l of ls) {
    const base = cy + l.size * (LINE_H - 1) * 0.5 + l.size * 0.8;
    cy += l.size * LINE_H;
    const attrs = [
      `x="${n2(center ? x + w / 2 : x)}"`,
      `y="${n2(base)}"`,
      `font-size="${n2(l.size)}"`,
      center ? 'text-anchor="middle"' : '',
      l.bold ? 'font-weight="700"' : '',
      `fill="${l.dim ? SOFT : INK}"`,
    ].filter(Boolean);
    out.push(`<text ${attrs.join(' ')}>${esc(l.text)}</text>`);
  }
  return out.join('');
}

const box = (x: number, y: number, w: number, h: number, extra: string) =>
  `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(Math.max(0, w))}" height="${n2(Math.max(0, h))}" ${extra}/>`;

/** Largest rectangle of a compartment, in cavity mm. */
function mainRect(c: Compartment): Rect {
  return [...c.rects].sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0] ?? c.bounds;
}

/**
 * Top view of a drawer: the baseplate grid with column letters (from the left)
 * and row numbers (from the front), every bin outlined where it sits with its
 * compartments or tool outlines, and its label text and contents written in
 * it (sized to fit). Drawn in mm, so it prints at actual size.
 */
export function drawerMap(d: NamedDrawer, o: MapOptions = {}): DrawerMap {
  const units = o.units ?? 'mm';
  const fmt = (mm: number) => formatLength(mm, units, { precision: o.precision });
  const L = computeLayout(d.drawer);
  const M = 8;
  const HEAD = 17;
  const GUT = 7;
  const TOP = 5;
  const FOOT = 12;
  const ox = M + GUT;
  const oy = M + HEAD + TOP;
  const W = Math.max(ox + L.plateW + M, 120);
  const H = oy + L.plateD + FOOT + M;
  const X = (x: number) => ox + x;
  const Y = (y: number) => oy + L.plateD - y;
  const s: string[] = [];

  s.push(box(0, 0, W, H, 'fill="#ffffff"'));
  // Header: name, size, and a scale bar to check an actual-size print against.
  const nBins = d.bins.length;
  const titleSize = Math.min(6.5, (6.5 * (W - 2 * M - 60)) / Math.max(1, textWidth(d.name, 6.5, true)));
  s.push(`<text x="${M}" y="${M + 6}" font-size="${n2(Math.max(3, titleSize))}" font-weight="700" fill="${INK}">${esc(d.name)}</text>`);
  const sizeText =
    d.drawer.mode === 'drawer'
      ? `Drawer ${fmt(d.drawer.width)} × ${fmt(d.drawer.depth)} · baseplate ${fmt(L.plateW)} × ${fmt(L.plateD)}`
      : `Baseplate ${fmt(L.plateW)} × ${fmt(L.plateD)}`;
  const sub = `${sizeText} · ${L.nx} × ${L.ny} grid · ${nBins} bin${nBins === 1 ? '' : 's'}`;
  s.push(`<text x="${M}" y="${M + 12.5}" font-size="3.2" fill="${SOFT}">${esc(sub)}</text>`);
  const bar = units === 'in' ? 50.8 : 50;
  const bx1 = W - M;
  const bx0 = bx1 - bar;
  s.push(
    `<g stroke="${INK}" stroke-width="0.4"><line x1="${n2(bx0)}" y1="${M + 9}" x2="${n2(bx1)}" y2="${M + 9}"/>` +
      `<line x1="${n2(bx0)}" y1="${M + 7.5}" x2="${n2(bx0)}" y2="${M + 10.5}"/><line x1="${n2(bx1)}" y1="${M + 7.5}" x2="${n2(bx1)}" y2="${M + 10.5}"/></g>`,
    `<text x="${n2((bx0 + bx1) / 2)}" y="${M + 6.3}" font-size="2.6" text-anchor="middle" fill="${SOFT}">${units === 'in' ? '2″' : '50 mm'}</text>`,
  );

  // Plate and cells.
  s.push(box(X(0), Y(L.plateD), L.plateW, L.plateD, `rx="3" fill="#f7f8fa" stroke="${INK}" stroke-width="0.6"`));
  const blocked = new Set(L.mask ?? []);
  const cells: string[] = [];
  for (let i = 0; i < L.nx; i++) {
    for (let j = 0; j < L.ny; j++) {
      const x0 = X(L.xs[i]);
      const y0 = Y(L.ys[j + 1]);
      const w = L.xs[i + 1] - L.xs[i];
      const h = L.ys[j + 1] - L.ys[j];
      if (blocked.has(`${i},${j}`)) {
        cells.push(
          box(x0, y0, w, h, 'fill="#dfe2e6" stroke="#b9bec6" stroke-width="0.25"'),
          `<path d="M${n2(x0 + 2)} ${n2(y0 + 2)}L${n2(x0 + w - 2)} ${n2(y0 + h - 2)}M${n2(x0 + w - 2)} ${n2(y0 + 2)}L${n2(x0 + 2)} ${n2(y0 + h - 2)}" stroke="#a3a9b2" stroke-width="0.35"/>`,
        );
      } else cells.push(box(x0 + 0.6, y0 + 0.6, w - 1.2, h - 1.2, 'rx="2" fill="none" stroke="#cfd3d9" stroke-width="0.25" stroke-dasharray="1 1"'));
    }
  }
  s.push(`<g>${cells.join('')}</g>`);
  // Column letters along the front, row numbers up the left side.
  const marks: string[] = [];
  for (let i = 0; i < L.nx; i++) {
    marks.push(`<text x="${n2(X((L.xs[i] + L.xs[i + 1]) / 2))}" y="${n2(Y(0) + 4.6)}" font-size="3" text-anchor="middle">${columnName(i)}</text>`);
  }
  for (let j = 0; j < L.ny; j++) {
    marks.push(`<text x="${n2(ox - 2.2)}" y="${n2(Y((L.ys[j] + L.ys[j + 1]) / 2) + 1.05)}" font-size="3" text-anchor="end">${j + 1}</text>`);
  }
  s.push(`<g fill="${SOFT}">${marks.join('')}</g>`);
  s.push(
    `<text x="${n2(X(L.plateW / 2))}" y="${n2(oy - 1.6)}" font-size="2.6" text-anchor="middle" letter-spacing="0.8" fill="${SOFT}">BACK</text>`,
    `<text x="${n2(X(L.plateW / 2))}" y="${n2(Y(0) + 10)}" font-size="2.6" text-anchor="middle" letter-spacing="0.8" fill="${SOFT}">FRONT</text>`,
  );

  // Bins.
  const inset = (GRID - BASE_TOP) / 2;
  for (const b of byPosition(d.bins)) {
    const cellsAt = binCellsAt(L, b);
    const e = binEntry(d, b, cellsAt);
    const { w: bw, d: bd } = binSize(b.opts, cellsAt);
    const x0 = cellEdge(L.xs, b.x, L.pitchX) + inset;
    const y0 = cellEdge(L.ys, b.y, L.pitchY) + inset;
    const g: string[] = [];
    g.push(box(X(x0) + 0.3, Y(y0 + bd) + 0.3, bw - 0.6, bd - 0.6, `rx="3.4" fill="#e9ecf0" stroke="${INK}" stroke-width="0.45"`));
    const cx = x0 + WALL;
    const cy = y0 + WALL;
    const blocks: { lines: TextLine[]; r: Rect }[] = [];
    const binLines: TextLine[] = [
      ...(e.label ? [{ text: e.label, bold: true, scale: 1.15 }] : []),
      ...e.contents.map((text) => ({ text })),
      ...e.tools.filter((t) => !e.contents.includes(t)).map((text) => ({ text, dim: !!e.contents.length })),
    ];
    if (e.comps.length) {
      const r = binLayout(b.opts, cellsAt);
      const byKey = new Map(r.compartments.map((c) => [c.key, c]));
      for (const c of r.compartments) {
        for (const rc of c.rects) g.push(box(X(cx + rc.x0), Y(cy + rc.y1), rc.x1 - rc.x0, rc.y1 - rc.y0, 'fill="#ffffff"'));
      }
      const compBlocks = e.comps.map((c) => ({
        c,
        comp: byKey.get(c.key)!,
        lines: [...(c.label ? [{ text: c.label, bold: true, scale: 1.1 }] : []), ...c.contents.map((text) => ({ text }))] as TextLine[],
      }));
      // The bin's own text goes in its largest empty compartment, else on top of the largest one's.
      if (binLines.length) {
        const area = (x: (typeof compBlocks)[number]) => x.comp.area;
        const empty = compBlocks.filter((x) => !x.lines.length).sort((a, b) => area(b) - area(a))[0];
        const target = empty ?? [...compBlocks].sort((a, b) => area(b) - area(a))[0];
        target.lines = [...binLines, ...target.lines];
      }
      for (const x of compBlocks) if (x.lines.length && x.comp) blocks.push({ lines: x.lines, r: mainRect(x.comp) });
    } else {
      const inner = binInnerSize(b.opts, cellsAt);
      if (b.opts.interior === 'cutouts') {
        for (const c of b.opts.cutouts ?? []) {
          const pts = placedOutline(c).map(([px, py]) => `${n2(X(x0 + bw / 2 + px))},${n2(Y(y0 + bd / 2 + py))}`);
          if (pts.length > 2) g.push(`<polygon points="${pts.join(' ')}" fill="#d6dae0" stroke="#9aa1ab" stroke-width="0.3"/>`);
        }
      }
      const lines = binLines.length ? binLines : [{ text: e.size, dim: true }];
      blocks.push({ lines, r: { x0: 0, y0: 0, x1: inner.w, y1: inner.d } });
    }
    for (const bl of blocks) {
      const pad = 1.2;
      const x = X(cx + bl.r.x0) + pad;
      const y = Y(cy + bl.r.y1) + pad;
      const w = bl.r.x1 - bl.r.x0 - 2 * pad;
      const h = bl.r.y1 - bl.r.y0 - 2 * pad;
      g.push(textBlock(bl.lines, x, y, w, h, bl.lines.length === 1 && bl.lines[0].dim ? 3.2 : 6));
    }
    s.push(`<g data-bin="${esc(b.id)}">${g.join('')}</g>`);
  }
  return { id: d.id, name: d.name, w: W, h: H, body: s.join('') };
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A standalone SVG document for a map (or one part of it), sized in mm. */
export function mapSvg(m: Pick<DrawerMap, 'w' | 'h' | 'body'>, view?: ViewBox): string {
  const v = view ?? { x: 0, y: 0, w: m.w, h: m.h };
  const vb = `${n2(v.x)} ${n2(v.y)} ${n2(v.w)} ${n2(v.h)}`;
  const edge = view
    ? `<rect x="${n2(v.x + 0.15)}" y="${n2(v.y + 0.15)}" width="${n2(v.w - 0.3)}" height="${n2(v.h - 0.3)}" fill="none" stroke="#9aa1ab" stroke-width="0.3" stroke-dasharray="2 2"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n2(v.w)}mm" height="${n2(v.h)}mm" viewBox="${vb}" font-family="${FONT}">${m.body}${edge}</svg>`;
}

/** Several maps stacked into one SVG document. */
export function combinedMapSvg(maps: DrawerMap[], gap = 12): string {
  let y = 0;
  const parts: string[] = [];
  for (const m of maps) {
    parts.push(`<g transform="translate(0 ${n2(y)})">${m.body}</g>`);
    y += m.h + gap;
  }
  const w = Math.max(1, ...maps.map((m) => m.w));
  return mapSvg({ w, h: Math.max(1, y - gap), body: parts.join('') });
}

export interface Paper {
  id: string;
  name: string;
  /** Portrait size, mm. */
  w: number;
  h: number;
}

export const PAPERS: Paper[] = [
  { id: 'a4', name: 'A4', w: 210, h: 297 },
  { id: 'letter', name: 'Letter', w: 215.9, h: 279.4 },
];

export interface Tile extends ViewBox {
  row: number;
  col: number;
}

/** Overlapping page-sized pieces covering a w × h map (left to right, top to bottom). */
export function mapTiles(w: number, h: number, pageW: number, pageH: number, overlap = 10): Tile[] {
  const axis = (len: number, page: number): [number, number][] => {
    if (len <= page + 1e-6) return [[0, len]];
    const step = Math.max(1, page - overlap);
    const n = Math.ceil((len - overlap) / step);
    return Array.from({ length: n }, (_, k) => [k * step, Math.min(page, len - k * step)] as [number, number]);
  };
  const xs = axis(w, pageW);
  const ys = axis(h, pageH);
  return ys.flatMap(([y, th], row) => xs.map(([x, tw], col) => ({ x, y, w: tw, h: th, row, col })));
}

/**
 * Actual-size printing: the map cut into pages of `paper` (inside `margin` mm,
 * less `header` mm for the page caption), in whichever orientation needs fewer.
 */
export function tilePlan(w: number, h: number, paper: Paper, margin = 10, header = 8, overlap = 10): { landscape: boolean; tiles: Tile[] } {
  const portrait = mapTiles(w, h, paper.w - 2 * margin, paper.h - 2 * margin - header, overlap);
  const landscape = mapTiles(w, h, paper.h - 2 * margin, paper.w - 2 * margin - header, overlap);
  return landscape.length < portrait.length || (landscape.length === portrait.length && w > h)
    ? { landscape: true, tiles: landscape }
    : { landscape: false, tiles: portrait };
}
