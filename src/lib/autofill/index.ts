/**
 * "Fill from a list": a typed list of what to store becomes bins in the
 * drawer. parse.ts reads the list, match.ts says what each item needs,
 * group.ts puts small related parts in one bin, size.ts sizes each bin and
 * pack.ts places them. Pure TS: the dialog (FillFromList.tsx) shows the plan
 * and the store's `addBins` puts it in the drawer in one undo step.
 */
import { MIN_HEIGHT_UNITS, binInnerSize, binTotalHeight, type BinCells, type BinOptions } from '../geometry/bin';
import { binSeatHeight, type BaseplateOptions } from '../geometry/baseplate';
import { PAD, padStyle } from '../geometry/pads';
import { binFloorZ } from '../geometry/variants';
import { HEIGHT_UNIT } from '../geometry/spec';
import { MAX_CELLS } from '../geometry/placement';
import { maxBinUnits } from '../bins';
import { usableBed, usableBeds } from '../bedfit';
import { binCellsAt, type PlacedBin } from '../project';
import { formatLength, MM_PER_IN, type Units } from '../units';
import type { DrawerInput, GridLayout } from '../layout/drawer';
import type { PrintSetup } from '../layout/plan';
import type { Tool } from '../tools';
import { parseList, type ListItem } from './parse';
import { matchItem } from './match';
import { groupEntries, groupItems, isGroup, type Entry } from './group';
import { packBins, type PackItem } from './pack';
import { FILL_FACTOR, cellsFor, fillBin, shrinkSize, sizeGroup, sizeItem, startOpts, type BinFill, type BinSize, type Proposal, type SizeContext } from './size';
import type { NewBin } from './apply';

export { parseLine, parseList, type ListItem } from './parse';
export { matchItem, matchTools, type Holder } from './match';
export { cellsFor, fillBin, type BinFill, type BinSize, type Proposal, type SizeContext, type Spec } from './size';
export { packBins, type PackItem, type PackSpot } from './pack';
export { cleanFillList, mergeBins, type NewBin } from './apply';

export interface FillContext {
  layout: GridLayout;
  drawer: DrawerInput;
  baseplate: BaseplateOptions;
  setup: Pick<PrintSetup, 'bedW' | 'bedD' | 'plateMargin' | 'maxH'> & Partial<Pick<PrintSetup, 'printerId' | 'printers'>>;
  /** The drawer's bins now. */
  bins: PlacedBin[];
  /** The tool library. */
  tools: Tool[];
  /** New-bin settings: base, holes, lip and label style carry over. */
  newBin: BinOptions;
  fmt?: (mm: number, o?: { unit?: boolean }) => string;
  units?: Units;
}

export interface FillOptions {
  /** Small related items share a bin, a compartment each (default on). */
  group?: boolean;
  /** Put the bins in place of the drawer's own, instead of around them. */
  replace?: boolean;
  /** Sizes picked in the preview, by proposal key. */
  sizes?: Record<string, BinSize>;
  /** Proposals the user left out, by key. */
  skip?: string[];
}

/** A proposal placed in a drawer. */
export interface PlannedBin {
  proposal: Proposal;
  x: number;
  y: number;
  size: BinSize;
  /** Its options on the cells it's on. */
  fill: BinFill;
  /** What's wrong with it there (too small for what it holds, too tall for the drawer). */
  warnings: string[];
}

export interface FillPlan {
  items: ListItem[];
  proposals: Proposal[];
  /** Bins placed in this drawer, in list order. */
  placed: PlannedBin[];
  /** Bins with no room in this drawer. */
  left: Proposal[];
  /** Those, in more drawers like this one (same size, empty): one list per drawer. */
  extra: PlannedBin[][];
  /** Too big even for an empty drawer like this one. */
  never: Proposal[];
  /** Left out by the user. */
  skipped: Proposal[];
  /** Room above the baseplate, mm; Infinity when the drawer's height isn't set. */
  room: number;
  ctx: SizeContext;
}

/** Most drawers suggested for what doesn't fit. */
const MAX_EXTRA_DRAWERS = 4;

/** Room above the baseplate for bins, mm: the drawer's inside height less the baseplate (Infinity when not set). */
export function drawerRoom(drawer: DrawerInput, baseplate: BaseplateOptions): number {
  if (drawer.mode !== 'drawer' || drawer.enclosure || !(drawer.height > 0)) return Infinity;
  return drawer.height - binSeatHeight(baseplate) - (padStyle(baseplate) ? PAD.proud : 0);
}

const round = (v: number) => (v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));

/** The sizing context for a drawer. */
export function sizeContext(c: FillContext): SizeContext {
  const units = c.units ?? 'mm';
  const base = startOpts(c.newBin);
  // With several printers a bin only has to fit one of them (bedfit.ts).
  const bed = c.setup.printers?.length ? usableBeds(c.setup as PrintSetup) : [usableBed(c.setup)];
  const room = drawerRoom(c.drawer, c.baseplate);
  // Tallest bin the printer takes, and the drawer.
  let printerH = 1;
  while (printerH < 30 && binTotalHeight({ ...base, heightUnits: printerH + 1 }) <= Math.max(...bed.map((b) => b.h)) + 1e-6) printerH++;
  const drawerH = Number.isFinite(room) ? maxBinUnits(room, base.lip) : Infinity;
  const half = !!c.layout.halfGrid;
  const cap = half ? MAX_CELLS : 12;
  return {
    pitchX: c.layout.pitchX,
    pitchY: c.layout.pitchY,
    half,
    maxX: Math.max(1, Math.min(cap, c.layout.nx)),
    maxY: Math.max(1, Math.min(cap, c.layout.ny)),
    bed,
    maxH: Math.max(MIN_HEIGHT_UNITS, Math.min(printerH, drawerH)),
    room,
    base,
    fmt: c.fmt ?? ((mm, o) => formatLength(mm, units, o)),
    vol: (mm3) => (units === 'in' ? `${round(mm3 / MM_PER_IN ** 3)} in³` : `${round(mm3 / 1000)} cm³`),
  };
}

/** A key per line that stays put while other lines change ("200 m3 screws", then "200 m3 screws~2" for a repeat). */
function entryKeys(items: ListItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map((i) => {
    const k = i.text.toLowerCase();
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n > 1 ? `${k}~${n}` : k;
  });
}

/** Every proposed bin for the list, before packing. */
export function propose(text: string, ctx: SizeContext, tools: Tool[], group = true): { items: ListItem[]; proposals: Proposal[] } {
  const items = parseList(text);
  const keys = entryKeys(items);
  const entries: Entry[] = items.map((item, i) => ({ key: keys[i], item, holder: matchItem(item, tools) }));
  const per = ctx.half ? 2 : 1;
  const h6 = Math.min(6, ctx.maxH);
  const room = (ux: number, uy: number) => {
    const { w, d } = binInnerSize({ unitsX: ux * per, unitsY: uy * per }, cellsFor(ctx, ux * per, uy * per));
    return w * d * (HEIGHT_UNIT * h6 - binFloorZ(ctx.base));
  };
  const need = (e: Entry) => (e.holder.kind === 'loose' ? e.holder.volume / FILL_FACTOR : 0);
  const list = group ? groupEntries(entries, need, { small: room(2, 1), tiny: room(1, 1), most: room(2, 2) }) : entries;
  // Sizing is the slow part: while a list is typed, only lines that changed are sized again.
  const memo = sized(ctx, tools);
  const proposals = list.flatMap((x) => {
    const k = isGroup(x) ? `${x.key}|${x.title}|${x.entries.map((e) => e.item.text).join('\n')}` : `${x.key}|${x.item.text}`;
    let out = memo.get(k);
    if (!out) {
      out = isGroup(x)
        ? sizeGroup(
            x.key,
            groupItems(x),
            x.entries.map((e) => e.holder),
            x.title,
            ctx,
          )
        : sizeItem(x.key, x.item, x.holder, ctx);
      if (memo.size > 400) memo.clear();
      memo.set(k, out);
    }
    return out;
  });
  return { items, proposals };
}

/** Proposals already sized for a drawer (sizing context and tool library). */
const sizedCache = new WeakMap<Tool[], Map<string, Map<string, Proposal[]>>>();

function sized(ctx: SizeContext, tools: Tool[]): Map<string, Proposal[]> {
  const { fmt: _f, vol: _v, ...rest } = ctx;
  // Formatting depends only on the units, which the volume shows.
  const key = JSON.stringify([rest, ctx.vol(1e6), ctx.fmt(25.4)]);
  let byCtx = sizedCache.get(tools);
  if (!byCtx) sizedCache.set(tools, (byCtx = new Map()));
  let m = byCtx.get(key);
  if (!m) {
    if (byCtx.size > 8) byCtx.clear();
    byCtx.set(key, (m = new Map()));
  }
  return m;
}

/** The cells a bin of this size has at (x, y): narrower edge cells, half cells. */
function cellsAt(layout: GridLayout, ctx: SizeContext, x: number, y: number, s: BinSize) {
  return binCellsAt(layout, { id: '#probe', x, y, opts: { unitsX: s.ux, unitsY: s.uy } as BinOptions }) ?? cellsFor(ctx, s.ux, s.uy);
}

/** Pack proposals into a drawer whose bins are `existing`. */
function packInto(layout: GridLayout, ctx: SizeContext, existing: PlacedBin[], proposals: Proposal[]): { placed: PlannedBin[]; left: Proposal[] } {
  const byKey = new Map(proposals.map((p) => [p.key, p]));
  const items: PackItem[] = proposals.map((p) => {
    // Most spots are on full cells: one check each.
    const seen = new Map<string, boolean>();
    const holds = (s: BinSize, cells: BinCells) => {
      const k = JSON.stringify([s, cells]);
      if (!seen.has(k)) seen.set(k, fillBin(p, s, cells, ctx).ok);
      return seen.get(k)!;
    };
    return {
      key: p.key,
      cluster: p.cluster,
      sizes: [p.size, ...p.alts],
      // On narrower edge cells a bin may hold less: only take a spot where it still holds what it does on full cells.
      accept: (x, y, s) => !holds(s, cellsFor(ctx, s.ux, s.uy)) || holds(s, cellsAt(layout, ctx, x, y, s)),
      last: !!p.oversize,
    };
  });
  const r = packBins(layout, existing, items);
  const room = ctx.room;
  const placed = r.placed.map((spot) => {
    const p = byKey.get(spot.key)!;
    const fill = fillBin(p, spot.size, cellsAt(layout, ctx, spot.x, spot.y, spot.size), ctx);
    const warnings = [...p.warnings];
    if (!p.oversize && fill.cap < fill.need) warnings.push(`Too small for everything at this size: ${fill.holds.charAt(0).toLowerCase()}${fill.holds.slice(1)}.`);
    const tall = binTotalHeight(fill.opts);
    if (tall > room + 1e-6) warnings.push(`It's ${ctx.fmt(tall)} tall: more than the ${ctx.fmt(room)} the drawer has above the baseplate.`);
    return { proposal: p, x: spot.x, y: spot.y, size: spot.size, fill, warnings };
  });
  return { placed, left: r.left.map((k) => byKey.get(k)!) };
}

/** Bins for a typed list in this drawer: proposed, sized and packed. */
export function planFill(text: string, c: FillContext, o: FillOptions = {}): FillPlan {
  const ctx = sizeContext(c);
  const { items, proposals: raw } = propose(text, ctx, c.tools, o.group !== false);
  // Sizes the user picked stay as picked (within the grid and the drawer's height).
  const proposals = raw.map((p) => {
    const s = o.sizes?.[p.key];
    if (!s) return p;
    // Never past the printer: like the bin editors, a size stops at what the bed takes.
    const size = shrinkSize({ ux: clampInt(s.ux, 1, ctx.maxX), uy: clampInt(s.uy, 1, ctx.maxY), h: clampInt(s.h, MIN_HEIGHT_UNITS, ctx.maxH) }, ctx);
    return { ...p, size, alts: [] };
  });
  const skip = new Set(o.skip ?? []);
  const here = packInto(
    c.layout,
    ctx,
    o.replace ? [] : c.bins,
    proposals.filter((p) => !skip.has(p.key)),
  );
  // What's left, in empty drawers like this one.
  const extra: PlannedBin[][] = [];
  let rest = here.left;
  while (rest.length && extra.length < MAX_EXTRA_DRAWERS) {
    const next = packInto(c.layout, ctx, [], rest);
    if (!next.placed.length) break;
    extra.push(next.placed);
    rest = next.left;
  }
  // Past the last suggested drawer, only what wouldn't fit even alone.
  const never = rest.filter((p) => !packInto(c.layout, ctx, [], [p]).placed.length);
  return { items, proposals, placed: here.placed, left: here.left, extra, never, skipped: proposals.filter((p) => skip.has(p.key)), room: ctx.room, ctx };
}

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));

/** Planned bins as bins to add (store `addBins`). */
export function plannedBins(list: PlannedBin[]): NewBin[] {
  return list.map((b) => ({
    x: b.x,
    y: b.y,
    opts: b.fill.opts,
    ...(b.fill.contents ? { contents: b.fill.contents } : {}),
    ...(b.fill.compContents && Object.keys(b.fill.compContents).length ? { compContents: b.fill.compContents } : {}),
  }));
}
