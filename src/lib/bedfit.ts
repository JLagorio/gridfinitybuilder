/**
 * Every bin and container has to fit the printer. A part fits when its
 * footprint fits the usable bed (the bed less the edge margin on every side),
 * either way round, and it is no taller than the printer prints. Bins print
 * upright, so their height counts against the printer's height.
 *
 * The store refuses edits that would push a bin past the bed (store.ts), the
 * editors stop drawing, resizing and stretching at the limit, and bins that no
 * longer fit (after picking a smaller printer) are flagged with a way to shrink them.
 *
 * With several printers (fleet.ts) every function also takes all their beds
 * (`usableBeds`): a part fits when it fits at least one of them, and how far it
 * overshoots is the least over them. Each part of a bin (its body, a lid, a
 * container's drawers) may print on a different printer.
 *
 * A printer that keeps part of its bed free (Bambu X1 / P1: the front-left
 * corner, printers.ts `exclude`; Bambu Studio won't slice a part there) takes
 * a part only where it stands clear of that area and the gap bins keep to it:
 * beside it (the strip to its right, the bed's full depth) or behind it (the
 * strip behind, the full width). `Bed.clear` holds those strips, as the packer
 * finds them (layout/pack.ts clearAreas), so what fits here packs there.
 */
import type { PrintSetup } from './layout/plan';
import type { GridLayout } from './layout/drawer';
import type { CellRect } from './bins';
import { MIN_HEIGHT_UNITS, binCells, binSize, binTotalHeight, sanitizeBin, type BinCells, type BinOptions } from './geometry/bin';
import { activeContainer } from './geometry/containers';
import { hasLid, lidSize } from './geometry/lid';
import { binCellsAt, type PlacedBin } from './project';
import type { BinStretch } from './geometry/placement';
import { jobPrinters, printerNames } from './layout/fleet';
import { binSpacing, clearAreas } from './layout/pack';
import { bedExclusion, type BedRect } from './printers';
import { meshSize, printsMesh } from './external';

/** What the printer can take: footprint (either way round) and height, mm. */
export interface Bed {
  w: number;
  d: number;
  h: number;
  /** The printer's name, for messages (usableBeds). */
  name?: string;
  /**
   * With exclusion areas (printers.ts): the parts of the usable bed clear of
   * them, the largest rectangles (layout/pack.ts clearAreas). A part fits
   * when it fits one of them, either way round. Unset: the whole usable bed.
   */
  clear?: readonly { w: number; d: number }[];
  /** Where the exclusion areas are, for messages ("front-left corner"). */
  keepClear?: string;
}

/** One printer's bed, or every printer's: a part fits when it fits at least one of them. */
export type Beds = Bed | readonly Bed[];

const EPS = 1e-6;

const bedList = (bed: Beds): readonly Bed[] => (Array.isArray(bed) ? (bed as readonly Bed[]) : [bed as Bed]);

/**
 * The first printer's bed (with one printer, the only one). With its model
 * (`printerId`) it has the model's exclusion areas, kept clear by the gap
 * bins are packed with (the `spacing`, at least 2 mm).
 */
export function usableBed(setup: Pick<PrintSetup, 'bedW' | 'bedD' | 'plateMargin' | 'maxH'> & Partial<Pick<PrintSetup, 'printerId' | 'spacing'>>): Bed {
  const bed: Bed = { w: setup.bedW - 2 * setup.plateMargin, d: setup.bedD - 2 * setup.plateMargin, h: setup.maxH };
  const exclude = setup.printerId ? bedExclusion(setup.printerId) : [];
  if (!exclude.length) return bed;
  const areas = clearAreas({ bedW: setup.bedW, bedD: setup.bedD, margin: setup.plateMargin, exclude, spacing: binSpacing(setup.spacing) });
  return { ...bed, clear: areas.map((a) => ({ w: a.w, d: a.d })), keepClear: whereOnBed(exclude, setup.bedW, setup.bedD) };
}

/** "front-left corner", "back edge"…: where exclusion areas are on a bed. */
function whereOnBed(areas: readonly BedRect[], bedW: number, bedD: number): string {
  const one = (e: BedRect) => {
    const side = e.x <= EPS ? 'left' : e.x + e.w >= bedW - EPS ? 'right' : '';
    const end = e.y <= EPS ? 'front' : e.y + e.d >= bedD - EPS ? 'back' : '';
    return side && end ? `${end}-${side} corner` : side || end ? `${side || end} edge` : 'middle';
  };
  return [...new Set(areas.map(one))].join(' and ');
}

/** Every printer's bed, named: what the editors hold bins to. */
export function usableBeds(setup: PrintSetup): Bed[] {
  const names = printerNames(setup);
  return jobPrinters(setup).map((p, i) => ({ ...usableBed({ ...p, spacing: setup.spacing }), name: names[i] }));
}

/**
 * The usable bed for hints and messages: "236 × 236", and with exclusion
 * areas "236 × 236 (225 × 236 or 236 × 215 clear of the front-left corner)".
 */
export function bedText(bed: Bed, fmt: (mm: number) => string = (mm) => `${r1(mm)}`): string {
  const size = (r: { w: number; d: number }) => `${fmt(r.w)} × ${fmt(r.d)}`;
  if (!bed.clear) return size(bed);
  const clear = bed.clear.length ? bed.clear.map(size).join(' or ') : 'nothing';
  return `${size(bed)} (${clear} clear of the ${bed.keepClear ?? 'area the printer keeps free'})`;
}

/** How many printers the beds are for. */
export const bedCount = (bed: Beds) => bedList(bed).length;

/** How far a w × d footprint overshoots a rectangle, in its better orientation (≤ 0 = it fits). */
const flatOn = (w: number, d: number, r: { w: number; d: number }) => Math.min(Math.max(w - r.w, d - r.d), Math.max(d - r.w, w - r.d));

/** How far a footprint overshoots the bed: the usable bed, or with exclusion areas the part of it clear of them that it comes closest to fitting. */
function flatOvershoot(w: number, d: number, bed: Bed): number {
  const full = flatOn(w, d, bed);
  if (!bed.clear) return full;
  return Math.max(full, bed.clear.length ? Math.min(...bed.clear.map((r) => flatOn(w, d, r))) : Math.max(w, d));
}

function overshootOn(w: number, d: number, h: number, bed: Bed): number {
  return Math.max(0, flatOvershoot(w, d, bed), h - bed.h);
}

/** How far a w × d × h part overshoots the bed, mm, in its better orientation (0 = it fits); with several beds, the one it comes closest to. */
export function partOvershoot(w: number, d: number, h: number, bed: Beds): number {
  return Math.min(...bedList(bed).map((b) => overshootOn(w, d, h, b)));
}

export function fitsBed(w: number, d: number, h: number, bed: Beds): boolean {
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
export function bedOvershoot(opts: BinOptions, cells: Partial<BinCells> | null | undefined, bed: Beds): number {
  return Math.max(0, ...bigParts(opts, cells).map((p) => partOvershoot(p.w, p.d, p.h, bed)));
}

export function placedOvershoot(layout: GridLayout, b: PlacedBin, bed: Beds): number {
  if (b.external) return externalOvershoot(b, bed);
  return bedOvershoot(b.opts, binCellsAt(layout, b), bed);
}

/**
 * Bins from elsewhere (external.ts): only an imported mesh that prints has to
 * fit the printer, as it is (its cells don't change it); placeholders and
 * bins you already have never print.
 */
export function externalOvershoot(b: Pick<PlacedBin, 'external'>, bed: Beds): number {
  if (!printsMesh(b)) return 0;
  const s = meshSize(b.external!.mesh!);
  return partOvershoot(s.w, s.d, s.h, bed);
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
  beds: Beds,
  fmt: (mm: number) => string = (mm) => `${r1(mm)} mm`,
): string | null {
  const list = bedList(beds);
  if (list.length > 1) return bedsProblem(bigParts(opts, cells), list, fmt);
  const bed = list[0];
  for (const p of bigParts(opts, cells)) {
    const what = p.name === 'bin' ? 'This bin' : `Its ${p.name}`;
    if (flatOn(p.w, p.d, bed) > EPS) return `${what} is ${fmt(p.w)} × ${fmt(p.d)}: too big for the print bed, which takes ${fmt(bed.w)} × ${fmt(bed.d)} inside the edge margin.`;
    if (flatOvershoot(p.w, p.d, bed) > EPS) return `${what} is ${fmt(p.w)} × ${fmt(p.d)}: ${notClear(bed, fmt)}`;
    if (p.h > bed.h + EPS) return `${what} is ${fmt(p.h)} tall: the printer prints up to ${fmt(bed.h)}.`;
  }
  return null;
}

/** Why a part that fits inside the edge margin still doesn't fit: the area the printer keeps free is in the way. */
function notClear(bed: Bed, fmt: (mm: number) => string): string {
  const where = bed.keepClear ?? 'area the printer keeps free';
  const clear = bed.clear?.length ? bed.clear.map((r) => `${fmt(r.w)} × ${fmt(r.d)}`).join(' or ') : 'nothing';
  return `it fits inside the edge margin, but not clear of the ${where} Bambu Studio keeps free (it won't slice a part there). Clear of it the bed takes ${clear}.`;
}

/** Why a part fits none of several printers: what the one it comes closest to takes. */
function bedsProblem(parts: PartSize[], beds: readonly Bed[], fmt: (mm: number) => string): string | null {
  for (const p of parts) {
    if (beds.some((b) => overshootOn(p.w, p.d, p.h, b) <= EPS)) continue;
    const near = beds.reduce((a, b) => (overshootOn(p.w, p.d, p.h, b) < overshootOn(p.w, p.d, p.h, a) - EPS ? b : a));
    const what = p.name === 'bin' ? 'This bin' : `Its ${p.name}`;
    const name = near.name ?? 'the closest printer';
    if (flatOn(p.w, p.d, near) > EPS)
      return `${what} is ${fmt(p.w)} × ${fmt(p.d)}: too big for every printer. The ${name} comes closest, with ${fmt(near.w)} × ${fmt(near.d)} inside the edge margin.`;
    if (overshootOn(p.w, p.d, 0, near) > EPS) return `${what} is ${fmt(p.w)} × ${fmt(p.d)}: too big for every printer. The ${name} comes closest: ${notClear(near, fmt)}`;
    return `${what} is ${fmt(p.h)} tall: too tall for every printer. The ${name} comes closest, printing up to ${fmt(near.h)}.`;
  }
  return null;
}

/** Does a bin with these options fit the bed with this footprint (cells) on the grid? */
export function rectFitsBed(layout: GridLayout, b: Pick<PlacedBin, 'opts' | 'external'> & { stretch?: Partial<BinStretch> }, r: CellRect, bed: Beds): boolean {
  if (b.external) return externalOvershoot(b, bed) <= EPS;
  const probe: PlacedBin = { id: '#probe', x: r.x, y: r.y, opts: { ...b.opts, unitsX: r.w, unitsY: r.d }, ...(b.stretch ? { stretch: b.stretch } : {}) };
  return placedOvershoot(layout, probe, bed) <= EPS;
}

/** The most cells along an axis the bin can have (its other size kept) and still fit; at least 1. */
export function maxUnitsAlong(layout: GridLayout, b: PlacedBin, axis: 'x' | 'y', bed: Beds, cap: number): number {
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
 * With several beds, made to fit the one that leaves it biggest.
 */
export function shrinkToBed(layout: GridLayout, b: PlacedBin, beds: Beds): PlacedBin {
  // An imported mesh is what it is; placeholders never print.
  if (b.external) return b;
  const list = bedList(beds);
  if (list.length > 1) {
    if (placedOvershoot(layout, b, list) <= EPS) return b;
    const size = (x: PlacedBin) => {
      const body = bigParts(x.opts, binCellsAt(layout, x))[0];
      return body.w * body.d * body.h;
    };
    return list.map((one) => shrinkToBed(layout, b, one)).reduce((a, c) => (size(c) > size(a) + EPS ? c : a));
  }
  const bed = list[0];
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
export function fitStretch(layout: GridLayout, b: PlacedBin, want: Partial<BinStretch> | null, bed: Beds): Partial<BinStretch> | null {
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
