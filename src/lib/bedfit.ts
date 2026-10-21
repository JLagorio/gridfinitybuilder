/**
 * Every bin and container has to fit the printer. A part fits when its
 * footprint fits the usable bed (the bed less the edge margin on every side),
 * either way round, and it is no taller than the printer prints. Bins print
 * upright, so their height counts against the printer's height.
 *
 * The store refuses edits that would push a bin past the bed (store.ts), the
 * editors stop drawing, resizing and stretching at the limit, and bins that no
 * longer fit (after picking a smaller printer) are flagged with a way to shrink them.
 */
import type { PrintSetup } from './layout/plan';
import type { GridLayout } from './layout/drawer';
import type { CellRect } from './bins';
import { MIN_HEIGHT_UNITS, binCells, binSize, binTotalHeight, sanitizeBin, type BinCells, type BinOptions } from './geometry/bin';
import { activeContainer } from './geometry/containers';
import { hasLid, lidSize } from './geometry/lid';
import { binCellsAt, type PlacedBin } from './project';
import type { BinStretch } from './geometry/placement';

/** What the printer can take: footprint (either way round) and height, mm. */
export interface Bed {
  w: number;
  d: number;
  h: number;
}

const EPS = 1e-6;

export function usableBed(setup: Pick<PrintSetup, 'bedW' | 'bedD' | 'plateMargin' | 'maxH'>): Bed {
  return { w: setup.bedW - 2 * setup.plateMargin, d: setup.bedD - 2 * setup.plateMargin, h: setup.maxH };
}

/** How far a w × d × h part overshoots the bed, mm, in its better orientation (0 = it fits). */
export function partOvershoot(w: number, d: number, h: number, bed: Bed): number {
  const flat = Math.min(Math.max(w - bed.w, d - bed.d), Math.max(d - bed.w, w - bed.d));
  return Math.max(0, flat, h - bed.h);
}

export function fitsBed(w: number, d: number, h: number, bed: Bed): boolean {
  return partOvershoot(w, d, h, bed) <= EPS;
}

interface PartSize {
  name: string;
  w: number;
  d: number;
  h: number;
}

/** The printed parts a bin brings that could be big: its body, a stacking lid, a container's own parts. */
function bigParts(opts: BinOptions, cellsIn: Partial<BinCells> | null | undefined): PartSize[] {
  const o = sanitizeBin(opts);
  const cells = binCells(o, cellsIn);
  const { w, d } = binSize(o, cells);
  const out: PartSize[] = [{ name: 'bin', w, d, h: binTotalHeight(o) }];
  const c = activeContainer(o);
  if (c) for (const p of c.def.parts?.(o, c.opts, cells) ?? []) out.push({ name: p.name.toLowerCase(), w: p.w, d: p.d, h: p.h });
  else if (hasLid(o)) out.push({ name: 'lid', ...lidSize(o, cells) });
  return out;
}

/** How far the bin's worst part overshoots the bed, mm (0 = everything fits). */
export function bedOvershoot(opts: BinOptions, cells: Partial<BinCells> | null | undefined, bed: Bed): number {
  return Math.max(0, ...bigParts(opts, cells).map((p) => partOvershoot(p.w, p.d, p.h, bed)));
}

export function placedOvershoot(layout: GridLayout, b: PlacedBin, bed: Bed): number {
  return bedOvershoot(b.opts, binCellsAt(layout, b), bed);
}

/** Footprint and height overshoot of the bin's worst parts, separately. */
function overshoots(layout: GridLayout, b: PlacedBin, bed: Bed): { flat: number; tall: number } {
  const parts = bigParts(b.opts, binCellsAt(layout, b));
  return {
    flat: Math.max(0, ...parts.map((p) => partOvershoot(p.w, p.d, 0, bed))),
    tall: Math.max(0, ...parts.map((p) => p.h - bed.h)),
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Why the bin doesn't fit the printer, or null when it does. `fmt` formats a length (with its unit). */
export function bedProblem(
  opts: BinOptions,
  cells: Partial<BinCells> | null | undefined,
  bed: Bed,
  fmt: (mm: number) => string = (mm) => `${r1(mm)} mm`,
): string | null {
  for (const p of bigParts(opts, cells)) {
    const flat = Math.min(Math.max(p.w - bed.w, p.d - bed.d), Math.max(p.d - bed.w, p.w - bed.d));
    const what = p.name === 'bin' ? 'This bin' : `Its ${p.name}`;
    if (flat > EPS) return `${what} is ${fmt(p.w)} × ${fmt(p.d)}: too big for the print bed, which takes ${fmt(bed.w)} × ${fmt(bed.d)} inside the edge margin.`;
    if (p.h > bed.h + EPS) return `${what} is ${fmt(p.h)} tall: the printer prints up to ${fmt(bed.h)}.`;
  }
  return null;
}

/** Does a bin with these options fit the bed with this footprint (cells) on the grid? */
export function rectFitsBed(layout: GridLayout, b: Pick<PlacedBin, 'opts'> & { stretch?: Partial<BinStretch> }, r: CellRect, bed: Bed): boolean {
  const probe: PlacedBin = { id: '#probe', x: r.x, y: r.y, opts: { ...b.opts, unitsX: r.w, unitsY: r.d }, ...(b.stretch ? { stretch: b.stretch } : {}) };
  return placedOvershoot(layout, probe, bed) <= EPS;
}

/** The most cells along an axis the bin can have (its other size kept) and still fit; at least 1. */
export function maxUnitsAlong(layout: GridLayout, b: PlacedBin, axis: 'x' | 'y', bed: Bed, cap: number): number {
  let best = 1;
  for (let n = 1; n <= cap; n++) {
    const r = { x: b.x, y: b.y, w: axis === 'x' ? n : b.opts.unitsX, d: axis === 'y' ? n : b.opts.unitsY };
    if (rectFitsBed(layout, b, r, bed)) best = n;
    else if (n > (axis === 'x' ? b.opts.unitsX : b.opts.unitsY)) break;
  }
  return best;
}

/**
 * The bin made small enough for the bed: lower (in 7 mm units) while too
 * tall, then scale the stretch back, then shorten the longer side a cell at a
 * time (front-left corner kept). Returns the bin unchanged when it already fits.
 */
export function shrinkToBed(layout: GridLayout, b: PlacedBin, bed: Bed): PlacedBin {
  let cur = b;
  if (placedOvershoot(layout, cur, bed) <= EPS) return b;
  const o = () => overshoots(layout, cur, bed);
  if (o().tall > EPS && cur.opts.heightMode && cur.opts.heightMode !== 'units') cur = { ...cur, opts: { ...cur.opts, heightMode: 'units' } };
  while (o().tall > EPS && cur.opts.heightUnits > MIN_HEIGHT_UNITS) cur = { ...cur, opts: { ...cur.opts, heightUnits: cur.opts.heightUnits - 1 } };
  const st = cur.stretch;
  for (let k = 9; st && k >= 0 && o().flat > EPS; k--) {
    const t = k / 10;
    cur = { ...cur, stretch: { left: (st.left ?? 0) * t, right: (st.right ?? 0) * t, front: (st.front ?? 0) * t, back: (st.back ?? 0) * t } };
  }
  while (o().flat > EPS && (cur.opts.unitsX > 1 || cur.opts.unitsY > 1)) {
    const k = cur.opts.unitsX >= cur.opts.unitsY ? 'unitsX' : 'unitsY';
    cur = { ...cur, opts: { ...cur.opts, [k]: cur.opts[k] - 1 } };
  }
  return cur;
}

/**
 * The stretch made to fit the bed: `want` as it is when it fits, else scaled
 * back (all sides together) to the most that fits. Null when no stretch fits.
 */
export function fitStretch(layout: GridLayout, b: PlacedBin, want: Partial<BinStretch> | null, bed: Bed): Partial<BinStretch> | null {
  if (!want) return null;
  const at = (t: number): PlacedBin => ({
    ...b,
    stretch: { left: (want.left ?? 0) * t, right: (want.right ?? 0) * t, front: (want.front ?? 0) * t, back: (want.back ?? 0) * t },
  });
  if (placedOvershoot(layout, at(1), bed) <= EPS) return want;
  if (placedOvershoot(layout, at(0), bed) > EPS) return null;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const t = (lo + hi) / 2;
    if (placedOvershoot(layout, at(t), bed) <= EPS) lo = t;
    else hi = t;
  }
  const s = at(Math.floor(lo * 1000) / 1000).stretch!;
  const r2 = (v: number | undefined) => Math.floor((v ?? 0) * 100) / 100;
  return { left: r2(s.left), right: r2(s.right), front: r2(s.front), back: r2(s.back) };
}
