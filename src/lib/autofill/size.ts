/**
 * "Fill from a list": sizing. Each item (or group of small items) becomes a
 * Proposal: what it holds (a Spec), the smallest bin that holds it, other
 * sizes that also work (for the packer), its label and why it was chosen.
 *
 * `fillBin` turns a proposal into bin options at any size, so the packer can
 * check a spot on narrower edge cells and the user can pick another size:
 * it says whether everything still fits.
 */
import { MIN_HEIGHT_UNITS, binInnerSize, binSize, binTotalHeight, sanitizeBin, type BinCells, type BinOptions } from '../geometry/bin';
import { pocketLayout } from '../geometry/pockets';
import { CUSTOM_SET, presetFields, sizeLabelText, type PocketPreset } from '../geometry/pocketPresets';
import { DEFAULT_VARIANTS, POCKET_KEYS, binBodyHeight, binFloorZ } from '../geometry/variants';
import { DEFAULT_ACCESSORIES } from '../geometry/accessories';
import { DEFAULT_INSERTS } from '../geometry/insertOptions';
import { BASE_TOP, DIVIDER, GRID, HEIGHT_UNIT, LIP_SUPPORT_HEIGHT, WALL } from '../geometry/spec';
import { cutoutArea, pocketBox, type BinCutout } from '../geometry/cutouts';
import { channelLayout, magazineLayout, sanitizeDispenser, tapeLayout, type DispenserOptions } from '../geometry/containers/dispenser';
import { EDGE, resolveLayout, type CompartmentOptions, type DividerLayout, type DividerWall } from '../dividers';
import { bedOvershoot, type Bed } from '../bedfit';
import { fitBinForTools, type BinFit, type Tool } from '../tools';
import { normalizeText, type ListItem } from './parse';
import type { Holder } from './match';

/** A bin size: cells along X and Y (21 mm cells on a half grid), height in 7 mm units. */
export interface BinSize {
  ux: number;
  uy: number;
  h: number;
}

/** What a proposed bin holds. */
export type Spec =
  /** `need` pockets from a preset, `per` items to a pocket. */
  | { kind: 'pockets'; preset: PocketPreset; need: number; per: number; given: boolean }
  /** One pocket per size. */
  | { kind: 'set'; preset: PocketPreset; sizes: number[]; names: string[] }
  | { kind: 'tools'; tools: Tool[] }
  /** `need` items in the magazine or channels (0 = no count given). */
  | { kind: 'dispenser'; style: 'coin' | 'channel' | 'tape'; dispenser: Partial<DispenserOptions>; need: number; length: number }
  /** A compartment per entry, each holding at least `needs[i]` mm³ (0 = any). */
  | { kind: 'compartments'; needs: number[] }
  /** `count` things lying flat, `l` × `w` × `h` each. */
  | { kind: 'objects'; count: number; l: number; w: number; h: number };

export interface Proposal {
  /** Stays the same while other lines change, so a size the user picked sticks. */
  key: string;
  /** The items it holds, in list order (one per compartment for a group). */
  items: ListItem[];
  spec: Spec;
  /** Short name: "AA batteries", "M3 screws, M3 nuts". */
  title: string;
  /** What it holds and why. */
  reason: string;
  /** Related bins share a cluster and are placed next to each other. */
  cluster: string;
  /** The size Gridfit picked, then others that also hold everything (best first). */
  size: BinSize;
  alts: BinSize[];
  /** When one item needs several bins. */
  part?: { index: number; of: number };
  /** Problems even at the picked size (too tall for the drawer, too big for the printer). */
  warnings: string[];
  /** Nothing the printer takes holds it: the size is the closest that does fit. */
  oversize?: boolean;
  /** Label text for the bin, and for each compartment (item order). */
  label: string;
  compLabels?: string[];
}

export interface SizeContext {
  /** Cell pitch, mm: 42, or 21 on a half grid. */
  pitchX: number;
  pitchY: number;
  half: boolean;
  /** Most cells along X and Y: the drawer's grid, at most 12 u. */
  maxX: number;
  maxY: number;
  bed: Bed;
  /** Tallest bin the drawer takes, 7 mm units. */
  maxH: number;
  /** Room above the baseplate, mm (Infinity when the drawer's height isn't set). */
  room: number;
  /** What new bins start from (base, holes, lip, label style): see startOpts. */
  base: BinOptions;
  fmt: (mm: number, o?: { unit?: boolean }) => string;
  /** A volume for reasons ("60 cm³"). */
  vol: (mm3: number) => string;
}

/** What `fillBin` makes of a proposal at one size. */
export interface BinFill {
  opts: BinOptions;
  contents?: string;
  compContents?: Record<string, string>;
  /** How much it holds and needs, in the proposal's own measure (pockets, sizes, items, mm³). */
  cap: number;
  need: number;
  /** Holds everything and fits the printer. */
  ok: boolean;
  /** Fits the printer (bedfit.ts). */
  printable: boolean;
  /** "12 of 12 pockets", "About 70 % full". */
  holds: string;
}

/** Fill a loose-parts compartment to this share at most, so parts can be scooped out. */
export const FILL_FACTOR = 0.8;
/** Narrowest compartment for loose parts, mm (room for fingers, and a label you can read). */
export const MIN_COMPARTMENT = 20;
/** Loose parts: lowest and usual tallest bin. */
const LOOSE_MIN_H = 3;
const LOOSE_MAX_H = 6;
/** Gap between things lying side by side, mm. */
const OBJECT_GAP = 2;

const EPS = 1e-6;

/**
 * New-bin settings with everything about the inside reset, so a bin's base,
 * holes, lip, walls and label style follow the user's new-bin settings while
 * the list decides what's inside.
 */
export function startOpts(newBin: BinOptions): BinOptions {
  const pockets = Object.fromEntries(POCKET_KEYS.map((k) => [k, DEFAULT_VARIANTS[k]]));
  return sanitizeBin({
    ...newBin,
    ...DEFAULT_ACCESSORIES,
    ...DEFAULT_INSERTS,
    ...pockets,
    heightMode: 'units',
    interior: 'compartments',
    divX: 1,
    divY: 1,
    layout: null,
    scoop: 0,
    label: newBin.label === 'none' ? 'full' : newBin.label,
    labelText: '',
    cutouts: undefined,
    container: undefined,
  });
}

export function cellsFor(ctx: Pick<SizeContext, 'pitchX' | 'pitchY' | 'half'>, ux: number, uy: number): BinCells {
  return { x: Array<number>(ux).fill(ctx.pitchX), y: Array<number>(uy).fill(ctx.pitchY), ...(ctx.half ? { half: true as const } : {}) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Bin options at a size
// ---------------------------------------------------------------------------

/** Pocket layouts are the slow part: keep the recent ones. */
const layoutCache = new Map<string, ReturnType<typeof pocketLayout>>();

function pocketsAt(opts: BinOptions, cells: BinCells) {
  const key = JSON.stringify([POCKET_KEYS.map((k) => opts[k]), opts.unitsX, opts.unitsY, opts.heightUnits, opts.lip, opts.base, cells]);
  let L = layoutCache.get(key);
  if (!L) {
    const { w, d } = binSize(opts, cells);
    const body = binBodyHeight(opts);
    L = pocketLayout(opts, w, d, binFloorZ(opts), opts.lip ? body - LIP_SUPPORT_HEIGHT : body);
    if (layoutCache.size > 3000) layoutCache.clear();
    layoutCache.set(key, L);
  }
  return L;
}

const toolFits = new WeakMap<Tool[], Map<string, BinFit>>();

/** "Make a bin" (ToolLibrary) for these tools: the smallest bin and its pockets. */
export function toolFit(tools: Tool[], ctx: Pick<SizeContext, 'base' | 'half'>): BinFit {
  const key = `${ctx.base.lip}|${ctx.base.lipStyle}|${ctx.base.base}|${ctx.half}`;
  let m = toolFits.get(tools);
  if (!m) toolFits.set(tools, (m = new Map()));
  let f = m.get(key);
  if (!f) m.set(key, (f = fitBinForTools(tools, { lip: ctx.base.lip, lipStyle: ctx.base.lipStyle, base: ctx.base.base, half: ctx.half })));
  return f;
}

/** The pockets turned a quarter turn (for a bin turned the other way). */
const turned = (cs: BinCutout[]): BinCutout[] => cs.map((c) => ({ ...c, x: -c.y, y: c.x, rotation: (c.rotation + 90) % 360 }));

/** Where a compartment's walls go: clear widths along the bin, as a chain of ratio walls from the left (or front). */
function rowLayout(widths: number[], orient: 'v' | 'h'): DividerLayout {
  const walls: DividerWall[] = [];
  // Centerlines: the cavity edges count as walls half a divider outside it (see dividers/types.ts).
  const inner = widths.reduce((s, w) => s + w, 0) + (widths.length - 1) * DIVIDER;
  let prev = -DIVIDER / 2;
  for (let k = 1; k < widths.length; k++) {
    const at = prev + widths[k - 1] + DIVIDER;
    const span = inner + DIVIDER / 2 - prev;
    const t = Math.round(((at - prev) / span) * 1e6) / 1e6;
    walls.push({ id: `w${k}`, orient, lo: k === 1 ? EDGE : `w${k - 1}`, hi: EDGE, pos: { kind: 'ratio', t }, start: EDGE, end: EDGE });
    prev = at;
  }
  return { walls };
}

/**
 * The proposal as bin options at `size`, on `cells` (the cells under its spot,
 * or full cells). Says how much it holds there.
 */
export function fillBin(p: Proposal, size: BinSize, cells: BinCells, ctx: SizeContext): BinFill {
  const base: BinOptions = { ...ctx.base, unitsX: size.ux, unitsY: size.uy, heightUnits: size.h, labelText: p.label };
  const single = p.items.length === 1 ? p.items[0].text : undefined;
  const contents = single !== undefined ? { contents: single } : {};
  const done = (opts: BinOptions, cap: number, need: number, holds: string, extra: Partial<BinFill> = {}): BinFill => {
    const o = sanitizeBin(opts);
    const printable = bedOvershoot(o, cells, ctx.bed) <= EPS;
    return { opts: o, ...contents, cap, need, ok: printable && cap >= need - EPS, printable, holds, ...extra };
  };
  const s = p.spec;
  switch (s.kind) {
    case 'pockets':
    case 'set': {
      const fields = presetFields(s.preset);
      const set = s.kind === 'set';
      const opts: BinOptions = {
        ...base,
        ...fields,
        interior: 'pockets',
        ...(set
          ? {
              pocketSizes: s.sizes,
              pocketSizeNames: s.names,
              pocketPreset: s.sizes.length === s.preset.sizes?.length ? s.preset.id : CUSTOM_SET,
            }
          : {}),
      };
      const L = pocketsAt(sanitizeBin(opts), cells);
      if (set) {
        const cap = s.sizes.length - L.missing.length;
        return done(opts, cap, s.sizes.length, `${cap} of ${plural(s.sizes.length, 'size')}`);
      }
      const n = L.pockets.length;
      const holds = s.given ? `${Math.min(n * s.per, s.need * s.per)} of ${s.need * s.per}` : plural(n, 'pocket');
      return done(opts, n, s.need, s.per > 1 && s.given ? `Room for ${n * s.per}` : holds);
    }
    case 'tools': {
      const fit = toolFit(s.tools, ctx);
      const { w, d } = binSize(base, cells);
      const area = cutoutArea(w, d, base.lip, base.lipStyle);
      const inside = (cs: BinCutout[]) =>
        cs.every((c) => {
          const b = pocketBox(c);
          return b.x0 >= area.x0 - 1e-3 && b.y0 >= area.y0 - 1e-3 && b.x1 <= area.x1 + 1e-3 && b.y1 <= area.y1 + 1e-3;
        });
      let cutouts = fit.cutouts;
      if (!inside(cutouts) && inside(turned(cutouts))) cutouts = turned(cutouts);
      const room = inside(cutouts) && size.h >= fit.heightUnits;
      const opts: BinOptions = { ...base, interior: 'cutouts', cutouts };
      return done(opts, room ? 1 : 0, 1, room ? plural(s.tools.length, 'tool pocket') : 'Too small for the tools');
    }
    case 'dispenser': {
      const dispenser = sanitizeDispenser(s.dispenser);
      const opts: BinOptions = { ...base, label: 'none', container: 'dispenser', containers: { ...base.containers, dispenser } };
      const bin = sanitizeBin(opts);
      if (s.style === 'coin') {
        const L = magazineLayout(bin, dispenser, cells);
        const cap = L.tray && L.well ? L.xs.length * L.capacity : 0;
        return done(opts, cap, Math.max(1, s.need), s.need ? `Room for ${cap} of ${s.need}` : `Room for ${cap}`);
      }
      if (s.style === 'channel') {
        const L = channelLayout(bin, dispenser, cells);
        const long = L.to - L.from >= s.length - EPS && L.width >= 12;
        const cap = long ? L.centers.length : 0;
        // About 100 zip ties to a channel.
        const need = Math.max(1, Math.ceil(s.need / 100));
        return done(opts, cap, need, long ? plural(L.centers.length, 'channel') : `Too short for ${ctx.fmt(s.length)} zip ties`);
      }
      const L = tapeLayout(bin, dispenser, cells);
      const fits = L.needsW <= L.W + EPS && L.over <= 0.5;
      return done(opts, fits ? 1 : 0, 1, fits ? 'One roll' : 'Too small for the roll');
    }
    case 'compartments': {
      const n = s.needs.length;
      const { w, d } = binInnerSize(base, cells);
      const alongX = w >= d - EPS;
      const length = (alongX ? w : d) - (n - 1) * DIVIDER;
      const across = alongX ? d : w;
      const depth = HEIGHT_UNIT * size.h - binFloorZ(base);
      const need = s.needs.map((v) => Math.max(MIN_COMPARTMENT, v / Math.max(1, across * depth)));
      const total = need.reduce((a, b) => a + b, 0);
      const volume = s.needs.reduce((a, b) => a + b, 0);
      // What's left over is shared out by volume (evenly when there's none).
      const spare = Math.max(0, length - total);
      const widths = need.map((v, i) => v + spare * (volume > 0 ? s.needs[i] / volume : 1 / n));
      const fits = total <= length + EPS;
      const holds = volume > 0 ? `About ${Math.round((100 * volume) / Math.max(1, length * across * depth))} % full` : n > 1 ? plural(n, 'compartment') : '';
      const scoop = 1;
      if (n === 1) return done({ ...base, scoop }, fits ? 1 : 0, 1, holds);
      const layout = rowLayout(widths, alongX ? 'v' : 'h');
      // Compartment keys, left to right (or front to back), for their labels and contents.
      const r = resolveLayout(layout, w, d);
      const keys = [...r.compartments].sort((a, b) => (alongX ? a.point[0] - b.point[0] : a.point[1] - b.point[1])).map((c) => c.key);
      const comps: Record<string, CompartmentOptions> = {};
      const compContents: Record<string, string> = {};
      keys.forEach((k, i) => {
        if (p.compLabels?.[i]) comps[k] = { labelText: p.compLabels[i] };
        // One item in several compartments: its label once, on the first.
        else if (p.items.length === 1 && i > 0) comps[k] = { label: 'none' };
        if (p.items.length > 1 && p.items[i]) compContents[k] = p.items[i].text;
      });
      const opts: BinOptions = { ...base, scoop, layout: { ...layout, ...(Object.keys(comps).length ? { comps } : {}) } };
      return done(opts, fits ? 1 : 0, 1, holds, p.items.length > 1 ? { compContents } : {});
    }
    case 'objects': {
      const { w, d } = binInnerSize(base, cells);
      const depth = HEIGHT_UNIT * size.h - binFloorZ(base);
      const g = OBJECT_GAP;
      const row = (a: number, b: number) => Math.floor((w + g) / (a + g) + EPS) * Math.floor((d + g) / (b + g) + EPS);
      const layers = depth >= s.h - EPS ? Math.max(1, Math.floor(depth / s.h + EPS)) : 0;
      const cap = Math.max(row(s.l, s.w), row(s.w, s.l)) * layers;
      return done({ ...base }, cap, s.count, s.count > 1 ? `Room for ${cap}` : cap ? 'Fits' : 'Too small');
    }
  }
}

// ---------------------------------------------------------------------------
// Picking a size
// ---------------------------------------------------------------------------

/** Longest a bin may be for its width. */
const MAX_ASPECT = 5;

/**
 * Footprints from small to big: fewest cells, whole units on a half grid,
 * squarest, then wider than deep. Nothing thinner than a full cell unless
 * it's that small both ways, and nothing longer than MAX_ASPECT × its width.
 */
function footprints(ctx: SizeContext): [number, number][] {
  const out: [number, number][] = [];
  for (let ux = 1; ux <= ctx.maxX; ux++) {
    for (let uy = 1; uy <= ctx.maxY; uy++) {
      const [a, b] = [ux * ctx.pitchX, uy * ctx.pitchY].sort((p, q) => p - q);
      if (b > a * MAX_ASPECT + EPS || (a < GRID - EPS && b > GRID + EPS)) continue;
      out.push([ux, uy]);
    }
  }
  const odd = (a: [number, number]) => (ctx.half ? (a[0] % 2) + (a[1] % 2) : 0);
  return out.sort((a, b) => a[0] * a[1] - b[0] * b[1] || odd(a) - odd(b) || Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]) || b[0] - a[0]);
}

/** Heights to try, lowest first. */
function heights(p: Proposal, ctx: SizeContext, tall = false): number[] {
  const max = Math.max(MIN_HEIGHT_UNITS, ctx.maxH);
  const range = (lo: number, hi: number) => Array.from({ length: Math.max(1, hi - lo + 1) }, (_, i) => Math.min(max, lo + i));
  const s = p.spec;
  const floor = binFloorZ(ctx.base);
  const lip = ctx.base.lip ? LIP_SUPPORT_HEIGHT : 0;
  const need = (depth: number) => Math.max(MIN_HEIGHT_UNITS, Math.ceil((floor + depth + lip) / HEIGHT_UNIT - EPS));
  switch (s.kind) {
    case 'pockets':
    case 'set':
      return [Math.min(max, need(s.preset.depth))];
    case 'tools':
      return [Math.min(max, toolFit(s.tools, ctx).heightUnits)];
    case 'dispenser':
      return s.style === 'coin' ? range(Math.min(max, 4), max) : s.style === 'channel' ? [Math.min(max, 3)] : [MIN_HEIGHT_UNITS];
    case 'compartments': {
      const lo = Math.min(max, LOOSE_MIN_H);
      return s.needs.some((v) => v > 0) ? range(lo, tall ? max : Math.min(max, LOOSE_MAX_H)) : [Math.min(max, Math.max(lo, ctx.base.heightUnits))];
    }
    case 'objects': {
      const lo = Math.min(max, need(s.h));
      return range(lo, tall ? max : Math.max(lo, Math.min(max, LOOSE_MAX_H)));
    }
  }
}

/**
 * The lowest height at which the proposal holds everything at this footprint,
 * or null. A taller bin never holds less, so it looks at the tallest first
 * and then halves the range.
 */
function heightAt(p: Proposal, ux: number, uy: number, ctx: SizeContext, hs: number[]): number | null {
  const cells = cellsFor(ctx, ux, uy);
  const ok = (h: number) => fillBin(p, { ux, uy, h }, cells, ctx).ok;
  if (hs.length < 3) return hs.find(ok) ?? null;
  if (!ok(hs[hs.length - 1])) return null;
  let lo = 0;
  let hi = hs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ok(hs[mid])) hi = mid;
    else lo = mid + 1;
  }
  return hs[lo];
}

/** False when a footprint surely can't hold the proposal (to skip the slow checks): too small or too big for the bed. */
function mayFit(p: Proposal, ux: number, uy: number, ctx: SizeContext): boolean {
  const cells = cellsFor(ctx, ux, uy);
  const outer = binSize({ unitsX: ux, unitsY: uy }, cells);
  if (Math.min(Math.max(outer.w - ctx.bed.w, outer.d - ctx.bed.d), Math.max(outer.d - ctx.bed.w, outer.w - ctx.bed.d)) > EPS) return false;
  const { w, d } = binInnerSize({ unitsX: ux, unitsY: uy }, cells);
  const s = p.spec;
  const area = w * d;
  switch (s.kind) {
    case 'objects': {
      const one = Math.max(w, d) >= s.l - EPS && Math.min(w, d) >= s.w - EPS;
      return one && area * Math.max(1, Math.floor((HEIGHT_UNIT * ctx.maxH) / s.h)) >= s.count * s.l * s.w;
    }
    case 'pockets': {
      const pw = s.preset.w + s.preset.spacing;
      const pd = (s.preset.d ?? s.preset.w) + s.preset.spacing;
      return Math.max(w, d) >= Math.max(s.preset.w, s.preset.d ?? 0) && area >= s.need * pw * pd * 0.75;
    }
    case 'set':
      return area >= s.sizes.reduce((t, v) => t + (v + s.preset.spacing) ** 2, 0) * 0.6;
    case 'tools': {
      const f = toolFit(s.tools, ctx);
      return (ux >= f.unitsX && uy >= f.unitsY) || (ux >= f.unitsY && uy >= f.unitsX);
    }
    case 'compartments':
      return Math.max(w, d) >= s.needs.length * MIN_COMPARTMENT && area * (HEIGHT_UNIT * ctx.maxH) >= s.needs.reduce((t, v) => t + v, 0);
    default:
      return true;
  }
}

/** The smallest size that holds everything, and other sizes that do (up to 1.6 × the cells), or null. */
export function pickSize(p: Proposal, ctx: SizeContext, tall = false): { size: BinSize; alts: BinSize[] } | null {
  const hs = heights(p, ctx, tall);
  let first: BinSize | null = null;
  const alts: BinSize[] = [];
  for (const [ux, uy] of footprints(ctx)) {
    if (first && ux * uy > first.ux * first.uy * 1.6 + EPS) break;
    if (!mayFit(p, ux, uy, ctx)) continue;
    const h = heightAt(p, ux, uy, ctx, hs);
    if (h === null) continue;
    if (!first) first = { ux, uy, h };
    else if (alts.length < 4) alts.push({ ux, uy, h });
  }
  return first ? { size: first, alts } : null;
}

/** The biggest footprint the printer and the drawer take, at the tallest height to try. */
function biggest(p: Proposal, ctx: SizeContext, tall = true): BinSize {
  const hs = heights(p, ctx, tall);
  const h = hs[hs.length - 1];
  for (const [ux, uy] of [...footprints(ctx)].reverse()) {
    const o = sanitizeBin({ ...ctx.base, unitsX: ux, unitsY: uy, heightUnits: h });
    if (bedOvershoot(o, cellsFor(ctx, ux, uy), ctx.bed) <= EPS) return { ux, uy, h };
  }
  return { ux: 1, uy: 1, h };
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/** A short label from the item: its name, or `{contents}` when the name is the whole line. */
export function labelFor(item: ListItem): string {
  if (item.name === normalizeText(item.text) && item.text.length <= 28) return '{contents}';
  if (item.name.length <= 24) return item.name;
  let out = '';
  for (const w of item.name.split(' ')) {
    if ((out ? `${out} ${w}` : w).length > 24) break;
    out = out ? `${out} ${w}` : w;
  }
  return out || item.name.slice(0, 24);
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Specs and their reasons for one item. */
function specFor(item: ListItem, h: Holder, ctx: SizeContext): { spec: Spec; reason: string; cluster: string; warnings: string[] } {
  const warnings: string[] = [];
  const name = item.name;
  switch (h.kind) {
    case 'pockets': {
      const reach = binFloorZ(ctx.base) + h.itemH;
      if (reach > ctx.room + EPS && h.lay) {
        const count = Math.max(1, h.given ? h.count : 6);
        return {
          spec: { kind: 'objects', count, l: h.lay[0], w: h.lay[1], h: h.lay[1] },
          reason: `${capital(name)} lie flat: standing, they reach ${ctx.fmt(reach)}, and the drawer has ${ctx.fmt(ctx.room)}.`,
          cluster: h.preset.group,
          warnings,
        };
      }
      if (reach > ctx.room + EPS) warnings.push(`They stand about ${ctx.fmt(h.itemH)} tall, more than the drawer has room for.`);
      const need = h.given ? Math.max(1, Math.ceil(h.count / h.per)) : 1;
      // "Batteries" without a size get AA pockets: say so.
      const what = h.preset.group === 'Batteries' && !item.cell ? `${name} (${h.preset.label} size)` : name;
      const reason = h.given ? `Pocket grid for ${h.count} ${what}.` : `Pocket grid for ${what}. No count given: the smallest bin.`;
      return { spec: { kind: 'pockets', preset: h.preset, need, per: h.per, given: h.given }, reason, cluster: h.preset.group, warnings };
    }
    case 'set': {
      const n = h.sizes.length;
      // Nominal sizes, as the set is sold: "1 to 10 mm", "1/16″ to 1/2″".
      const inch = h.preset.labels === 'inch';
      const size = (v: number, i: number) => h.names[i] || sizeLabelText(v, inch ? 'inch' : 'mm');
      const named = inch ? `${size(h.sizes[0], 0)}″ to ${size(h.sizes[n - 1], n - 1)}″` : `${size(h.sizes[0], 0)} to ${size(h.sizes[n - 1], n - 1)} mm`;
      const what = h.preset.id.startsWith('drills') ? 'Drill index' : h.preset.id.startsWith('hexkeys') ? 'Hex keys' : 'Socket set';
      return { spec: { kind: 'set', preset: h.preset, sizes: h.sizes, names: h.names }, reason: `${what}: a pocket for each of ${n} sizes, ${named}.`, cluster: 'Tools', warnings };
    }
    case 'tools': {
      const names = [...new Set(h.tools.map((t) => t.name))].join(', ');
      return {
        spec: { kind: 'tools', tools: h.tools },
        reason: `Tool cutout${h.tools.length > 1 ? 's' : ''} for ${h.tools.length > 1 && names.split(', ').length === 1 ? `${h.tools.length} × ${names}` : names}, from your tool library.`,
        cluster: 'Tools',
        warnings,
      };
    }
    case 'dispenser': {
      if (h.style === 'coin') {
        const label = h.item.toUpperCase();
        return {
          spec: { kind: 'dispenser', style: 'coin', dispenser: { style: 'magazine', item: h.item, shape: 'coin' }, need: h.count ?? 0, length: 0 },
          reason: `Dispenser for ${h.count ? `${h.count} ` : ''}${label} coin cells: refill from the top, take one from the tray.`,
          cluster: 'Batteries',
          warnings,
        };
      }
      if (h.style === 'channel') {
        return {
          spec: { kind: 'dispenser', style: 'channel', dispenser: { style: 'channel', channelWidth: 20, channels: 0, along: 'auto' }, need: h.count ?? 0, length: h.length },
          reason: `Dispenser channels for ${h.item} up to ${ctx.fmt(h.length)} long.`,
          cluster: 'Hardware',
          warnings,
        };
      }
      return {
        spec: { kind: 'dispenser', style: 'tape', dispenser: { style: 'tape', tapePreset: h.item }, need: 1, length: 0 },
        reason: `Tape dispenser for a roll of ${name}.`,
        cluster: 'Office',
        warnings,
      };
    }
    case 'loose': {
      const v = h.volume / FILL_FACTOR;
      const reason = h.given ? `About ${ctx.vol(h.volume)} of ${name}: a compartment with a scoop.` : `Room for about ${h.count} ${name} (no count given), with a scoop.`;
      return { spec: { kind: 'compartments', needs: [v] }, reason, cluster: capital(h.loose.category), warnings };
    }
    case 'objects': {
      const size = `${ctx.fmt(h.l, { unit: false })} × ${ctx.fmt(h.w)}`;
      const reason = !h.typical
        ? `Sized for ${h.count > 1 ? `${h.count} at ` : ''}${size} × ${ctx.fmt(h.h)}.`
        : h.count > 1
          ? `Room for ${h.count} ${name} lying flat, about ${size} each.`
          : `Sized for typical ${name} (about ${size}). Trace yours for a cutout that fits.`;
      return { spec: { kind: 'objects', count: h.count, l: h.l, w: h.w, h: h.h }, reason, cluster: 'Tools', warnings };
    }
    case 'general':
      return h.small
        ? { spec: { kind: 'compartments', needs: [0, 0] }, reason: 'A general bin with 2 compartments and scoops.', cluster: 'Misc', warnings }
        : { spec: { kind: 'compartments', needs: [0] }, reason: 'Not something Gridfit knows: a plain bin with a scoop. Change its size if it needs more room.', cluster: 'Misc', warnings };
  }
}

/** The spec cut into `k` parts (several bins for one item). */
function splitSpec(s: Spec, k: number): Spec[] {
  const each = (n: number) => Math.ceil(n / k);
  switch (s.kind) {
    case 'pockets':
      return Array.from({ length: k }, () => ({ ...s, need: each(s.need) }));
    case 'set': {
      const per = each(s.sizes.length);
      return Array.from({ length: k }, (_, i) => ({ ...s, sizes: s.sizes.slice(i * per, (i + 1) * per), names: s.names.slice(i * per, (i + 1) * per) })).filter((x) => x.sizes.length);
    }
    case 'compartments':
      return Array.from({ length: k }, () => ({ ...s, needs: s.needs.map((v) => v / k) }));
    case 'objects':
      return Array.from({ length: k }, () => ({ ...s, count: each(s.count) }));
    case 'tools':
      // One bin per tool.
      return s.tools.map((t) => ({ ...s, tools: [t] }));
    default:
      return [s];
  }
}

/** How many bins a spec needs, given what the biggest one holds. */
function partsNeeded(p: Proposal, ctx: SizeContext): number {
  const big = biggest(p, ctx, false);
  const f = fillBin(p, big, cellsFor(ctx, big.ux, big.uy), ctx);
  const s = p.spec;
  if (s.kind === 'compartments') {
    // Compare volumes: what the biggest bin takes against what's needed.
    const { w, d } = binInnerSize({ unitsX: big.ux, unitsY: big.uy }, cellsFor(ctx, big.ux, big.uy));
    const room = w * d * (HEIGHT_UNIT * big.h - binFloorZ(ctx.base));
    return Math.min(8, Math.max(1, Math.ceil(s.needs.reduce((a, b) => a + b, 0) / Math.max(1, room))));
  }
  if (s.kind === 'tools') return s.tools.length;
  if (s.kind === 'dispenser' || f.cap <= 0) return 1;
  return Math.min(8, Math.max(1, Math.ceil(f.need / f.cap)));
}

/** Size a proposal; one that's too big for one bin becomes several (or, failing that, a taller one). */
function finish(p: Proposal, ctx: SizeContext): Proposal[] {
  const got = pickSize(p, ctx);
  if (got) return [{ ...p, size: got.size, alts: got.alts }];
  const k = partsNeeded(p, ctx);
  if (k > 1) {
    const parts = splitSpec(p.spec, k);
    const out = parts.map((spec, i) => ({ ...p, key: `${p.key}#${i + 1}`, spec, part: { index: i + 1, of: parts.length } }));
    const sized = out.map((q) => pickSize(q, ctx) ?? pickSize(q, ctx, true));
    if (sized.every(Boolean)) return out.map((q, i) => ({ ...q, size: sized[i]!.size, alts: sized[i]!.alts }));
  }
  const tall = pickSize(p, ctx, true);
  if (tall) return [{ ...p, size: tall.size, alts: tall.alts }];
  // Nothing holds it all: the closest size that fits, flagged.
  const s = p.spec;
  if (s.kind === 'tools' || s.kind === 'objects') {
    const fit = s.kind === 'tools' ? toolFit(s.tools, ctx) : null;
    const want =
      s.kind === 'tools'
        ? { ux: fit!.unitsX, uy: fit!.unitsY, h: fit!.heightUnits }
        : { ux: cellsAcross(s.l, ctx.pitchX), uy: cellsAcross(s.w, ctx.pitchY), h: heights(p, ctx)[0] };
    const why = s.kind === 'tools' ? 'Too big for one bin your printer takes: this is as close as it gets.' : `Longer than a bin your printer takes: this is as close as it gets.`;
    return [{ ...p, size: shrinkSize(want, ctx), alts: [], warnings: [...p.warnings, why], oversize: true }];
  }
  const big = biggest(p, ctx);
  const f = fillBin(p, big, cellsFor(ctx, big.ux, big.uy), ctx);
  return [{ ...p, size: big, alts: [], warnings: [...p.warnings, `Even the biggest bin that fits doesn't hold it all: ${f.holds.charAt(0).toLowerCase()}${f.holds.slice(1)}.`], oversize: true }];
}

/** Cells along one axis for something `mm` long inside the walls. */
const cellsAcross = (mm: number, pitch: number) => Math.max(1, Math.ceil((mm + 2 * WALL + (GRID - BASE_TOP) + 1) / pitch - EPS));

/** A size cut down to the grid, the drawer's height and the print bed (the longer side first). */
export function shrinkSize(want: BinSize, ctx: SizeContext): BinSize {
  const s = { ux: Math.min(want.ux, ctx.maxX), uy: Math.min(want.uy, ctx.maxY), h: Math.min(want.h, ctx.maxH) };
  const over = () => bedOvershoot(sanitizeBin({ ...ctx.base, unitsX: s.ux, unitsY: s.uy, heightUnits: s.h }), cellsFor(ctx, s.ux, s.uy), ctx.bed) > EPS;
  while (over() && (s.ux > 1 || s.uy > 1)) {
    if (s.ux >= s.uy) s.ux--;
    else s.uy--;
  }
  return s;
}

/** Proposals for one item (several when it needs more than one bin). */
export function sizeItem(key: string, item: ListItem, holder: Holder, ctx: SizeContext): Proposal[] {
  const s = specFor(item, holder, ctx);
  const p: Proposal = {
    key,
    items: [item],
    spec: s.spec,
    title: item.name,
    reason: s.reason,
    cluster: s.cluster,
    size: { ux: 1, uy: 1, h: 3 },
    alts: [],
    warnings: s.warnings,
    label: labelFor(item),
    ...(s.spec.kind === 'compartments' && s.spec.needs.length > 1 ? { compLabels: s.spec.needs.map(() => '') } : {}),
  };
  // A general bin: 2 × 1 (or what the drawer has room for), as tall as new bins.
  const general = s.spec.kind === 'compartments' && s.spec.needs.every((v) => v === 0);
  const per = ctx.half ? 2 : 1;
  const h = heights(p, ctx)[0];
  const sizes = [
    { ux: 2 * per, uy: per, h },
    { ux: per, uy: 2 * per, h },
    { ux: per, uy: per, h },
  ].map((z) => shrinkSize(z, ctx));
  const out = general ? [{ ...p, size: sizes[0], alts: sizes.slice(1) }] : finish(p, ctx);
  // Lowered for the drawer: pockets end up shallower, tools may not go all the way in.
  if (ctx.maxH < heightsWanted(p, ctx)) {
    const note = p.spec.kind === 'tools' ? "Lowered to fit the drawer: the tools stick out of their pockets." : 'Lowered to fit the drawer: the pockets are shallower than usual.';
    for (const q of out) if (!q.warnings.includes(note)) q.warnings = [...q.warnings, note];
  }
  return out;
}

/** The height pockets and tools would like, before the drawer's limit (0 when it doesn't matter). */
function heightsWanted(p: Proposal, ctx: SizeContext): number {
  const s = p.spec;
  const floor = binFloorZ(ctx.base);
  const lip = ctx.base.lip ? LIP_SUPPORT_HEIGHT : 0;
  if (s.kind === 'pockets' || s.kind === 'set') return Math.max(MIN_HEIGHT_UNITS, Math.ceil((floor + s.preset.depth + lip) / HEIGHT_UNIT - EPS));
  if (s.kind === 'tools') return toolFit(s.tools, ctx).heightUnits;
  return 0;
}

/** One bin with a compartment for each of these small items, sized by their volumes. */
export function sizeGroup(key: string, items: ListItem[], holders: Holder[], title: string, ctx: SizeContext): Proposal[] {
  const needs = holders.map((h) => (h.kind === 'loose' ? h.volume / FILL_FACTOR : 0));
  const total = holders.reduce((t, h) => t + (h.kind === 'loose' ? h.volume : 0), 0);
  const first = holders[0];
  const p: Proposal = {
    key,
    items,
    spec: { kind: 'compartments', needs },
    title: items.map((i) => i.name).join(', '),
    reason: `${items.length} compartments sized by volume (about ${ctx.vol(total)} in all), with scoops.`,
    cluster: first.kind === 'loose' ? capital(first.loose.category) : 'Misc',
    size: { ux: 1, uy: 1, h: 3 },
    alts: [],
    warnings: [],
    label: title,
    compLabels: items.map(labelFor),
  };
  return finish(p, ctx);
}

/** The height of a bin at a size, mm (for the drawer check). */
export function proposalHeight(p: Proposal, size: BinSize, ctx: SizeContext): number {
  return binTotalHeight(fillBin(p, size, cellsFor(ctx, size.ux, size.uy), ctx).opts);
}
