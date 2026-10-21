import { GRID } from '../geometry/spec';
import type { CaseOptions } from '../geometry/case';
import type { WallOptions } from '../geometry/wallmount';
import type { SpacerOptions } from '../geometry/spacers';
import type { SkadisOptions } from '../geometry/skadis';
import type { PlacedAttachment } from '../wall/registry';

/**
 * What fills the space left over between the grid and the drawer walls.
 * 'spacers': the baseplate is just the grid and the margins print as separate
 * spacer strips (geometry/spacers.ts).
 */
export type EdgeFill = 'solid' | 'half' | 'fit' | 'spacers';

/**
 * What the grid goes in: a drawer (missing), a printed carry 'case' whose floor
 * is the baseplate (geometry/case.ts), or a 'wall' grid screwed to a wall
 * (geometry/wallmount.ts). Or no grid at all: a 'skadis' pegboard for a space
 * on the wall (geometry/skadis.ts), sized by `skadis`, with no bins.
 */
export type Enclosure = 'case' | 'wall' | 'skadis';

export interface DrawerInput {
  /** 'drawer': fit a grid into a drawer size; 'grid': give the grid size in units. */
  mode: 'drawer' | 'grid';
  /** Inside width of the drawer (X, left→right), mm. */
  width: number;
  /** Inside depth of the drawer (Y, front→back), mm. */
  depth: number;
  /**
   * Extra measurements taken at other spots (drawers are rarely square).
   * The smallest of `width` and these is used.
   */
  widthSamples: number[];
  depthSamples: number[];
  /** Inside height of the drawer (floor to the underside of whatever is above it), mm. 0 = unknown. */
  height: number;
  /** Total clearance subtracted from each axis so the plate drops in easily, mm. */
  clearance: number;
  gridX: number;
  gridY: number;
  /** Where the grid sits inside the leftover margin: 0 = left/front, 0.5 = centered, 1 = right/back. */
  alignX: number;
  alignY: number;
  pitchX: number;
  pitchY: number;
  /**
   * Leftover margin: 'solid' plastic, a row of 'half' (21 mm) cells where there's room,
   * or partial cells that 'fit' the whole margin. Bins placed on partial cells get matching feet.
   */
  fill: EdgeFill;
  /** Narrowest partial cell worth making, mm. Thinner margins stay solid. */
  minFill: number;
  /** Blocked cells ("i,j"): slide hardware, a bump. They get no receptacle and no bins. */
  mask?: string[];
  /** Blocked cells are filled flat ('solid') or cut out of the plate ('void'). */
  maskStyle?: MaskStyle;
  /**
   * Half-grid (Gridfinity Extended's half pitch): cells, receptacles and bin
   * feet are half a pitch (21 mm), so bins come in half units and sit at any
   * half-cell offset. Bin positions and sizes count these cells; `gridX` /
   * `gridY` stay in full units (half steps allowed). Missing = off.
   */
  halfGrid?: boolean;
  /** Carry case or wall grid (see Enclosure). Missing = a plain drawer. */
  enclosure?: Enclosure;
  /** Carry-case settings, kept while another enclosure is picked. Missing = defaults. */
  carryCase?: Partial<CaseOptions>;
  /** Wall-grid settings. Missing = defaults. */
  wallMount?: Partial<WallOptions>;
  /** Spacer-strip settings (fill 'spacers'). Missing = defaults. */
  spacers?: Partial<SpacerOptions>;
  /** Skådis board settings, the space on the wall included (enclosure 'skadis'). Missing = defaults. */
  skadis?: Partial<SkadisOptions>;
  /** What hangs on a Skådis board (lib/wall). Missing = nothing. */
  attachments?: PlacedAttachment[];
  /**
   * "Just bins": the baseplate is there already (printed before, or bought),
   * so nothing of the grid prints: no baseplate pieces, connector keys, pads
   * or spacer strips, and for a carry case or wall grid none of its parts
   * either. The grid still says where the bins go and how they fit; the view
   * draws it as not printed. Missing = the baseplate prints (only kept when on).
   */
  haveBaseplate?: true;
}

export type MaskStyle = 'solid' | 'void';

export const DEFAULT_DRAWER: DrawerInput = {
  mode: 'drawer',
  width: 510.5,
  depth: 376.5,
  widthSamples: [],
  depthSamples: [],
  height: 0,
  clearance: 0.5,
  gridX: 4,
  gridY: 3,
  alignX: 0.5,
  alignY: 0.5,
  pitchX: GRID,
  pitchY: GRID,
  fill: 'solid',
  minFill: 15,
};

/**
 * The drawer's inside height when it counts for the bins (the "taller than
 * the drawer" warnings, stacking room), mm; 0 when it isn't known. It's asked
 * for with a drawer size, and for a bins-only drawer whatever gives its size.
 */
export function insideHeight(d: Pick<DrawerInput, 'mode' | 'height' | 'haveBaseplate'>): number {
  return (d.mode === 'drawer' || d.haveBaseplate) && d.height > 0 ? d.height : 0;
}

/** Smallest positive measurement. */
export function effectiveSize(primary: number, samples: number[] = []): number {
  const all = [primary, ...samples].filter((v) => Number.isFinite(v) && v > 0);
  return all.length ? Math.min(...all) : 0;
}

export interface GridLayout {
  /** Final baseplate outer size. */
  plateW: number;
  plateD: number;
  nx: number;
  ny: number;
  /** Nominal pitch (full cells): the drawer's pitch, halved on a half grid. */
  pitchX: number;
  pitchY: number;
  /** Half-grid drawer (see DrawerInput.halfGrid); only present when on, so classic layouts are unchanged. */
  halfGrid?: true;
  /** Front-left corner of cell (0, 0) in plate coordinates. */
  originX: number;
  originY: number;
  /**
   * Cell boundaries in plate coordinates: nx + 1 values along X, ny + 1 along Y.
   * Full cells are one pitch wide; edge-fill cells can be narrower.
   */
  xs: number[];
  ys: number[];
  /** Solid margin left on each side (after edge fill). */
  margins: { left: number; right: number; front: number; back: number };
  /** Blocked cells ("i,j") inside the grid; only present when there are some. */
  mask?: string[];
  maskStyle?: MaskStyle;
}

/** Blocked cell keys that fall inside an nx × ny grid, sorted and deduplicated. */
export function maskInGrid(mask: readonly string[] | undefined, nx: number, ny: number): string[] {
  if (!mask?.length) return [];
  const keep = new Set<string>();
  for (const k of mask) {
    const m = /^(\d+),(\d+)$/.exec(k);
    if (m && +m[1] < nx && +m[2] < ny) keep.add(`${+m[1]},${+m[2]}`);
  }
  return [...keep].sort();
}

/** Adds the drawer's blocked cells to a layout (left untouched when there are none). */
function withMask(l: GridLayout, d: DrawerInput): GridLayout {
  const mask = maskInGrid(d.mask, l.nx, l.ny);
  return mask.length ? { ...l, mask, maskStyle: d.maskStyle === 'void' ? 'void' : 'solid' } : l;
}

const EPS = 1e-6;

/** Boundaries of n full cells starting at origin, plus any edge-fill cells. */
function axisBounds(origin: number, n: number, pitch: number, before: number, after: number) {
  const xs: number[] = [];
  if (before > 0) xs.push(clean(origin - before));
  for (let k = 0; k <= n; k++) xs.push(clean(origin + k * pitch));
  if (after > 0) xs.push(clean(origin + n * pitch + after));
  return xs;
}

/** Width of the edge-fill cell for a margin, or 0 to leave it solid. */
function fillCell(margin: number, d: DrawerInput, pitch: number): number {
  // On a half grid the cells already are half cells: 'half' leaves the margin solid.
  if (d.fill === 'half') return !d.halfGrid && margin + EPS >= pitch / 2 ? pitch / 2 : 0;
  if (d.fill === 'fit') return margin + EPS >= Math.max(d.minFill, 8) ? margin : 0;
  return 0;
}

export function computeLayout(d: DrawerInput): GridLayout {
  const l = withMask(computeGrid(d), d);
  return d.halfGrid ? { ...l, halfGrid: true } : l;
}

/** Cells per full unit: 2 on a half grid. */
export const cellsPerUnit = (d: Pick<DrawerInput, 'halfGrid'> | Pick<GridLayout, 'halfGrid'>) => (d.halfGrid ? 2 : 1);

function computeGrid(d: DrawerInput): GridLayout {
  const per = cellsPerUnit(d);
  const pitchX = (d.pitchX > 0 ? d.pitchX : GRID) / per;
  const pitchY = (d.pitchY > 0 ? d.pitchY : GRID) / per;
  if (d.mode === 'grid') {
    // gridX / gridY are full units; a half grid takes half units too.
    const nx = Math.max(1, Math.floor(d.gridX * per + EPS));
    const ny = Math.max(1, Math.floor(d.gridY * per + EPS));
    return {
      plateW: nx * pitchX,
      plateD: ny * pitchY,
      nx,
      ny,
      pitchX,
      pitchY,
      originX: 0,
      originY: 0,
      xs: axisBounds(0, nx, pitchX, 0, 0),
      ys: axisBounds(0, ny, pitchY, 0, 0),
      margins: { left: 0, right: 0, front: 0, back: 0 },
    };
  }
  const { plateW, plateD, fx, fy, left0, right0, front0, back0 } = drawerFit(d, pitchX, pitchY);
  if (d.fill === 'spacers') {
    // Just the grid: the margins print as spacer strips (spacerMargins).
    return {
      plateW: clean(fx * pitchX),
      plateD: clean(fy * pitchY),
      nx: fx,
      ny: fy,
      pitchX,
      pitchY,
      originX: 0,
      originY: 0,
      xs: axisBounds(0, fx, pitchX, 0, 0),
      ys: axisBounds(0, fy, pitchY, 0, 0),
      margins: { left: 0, right: 0, front: 0, back: 0 },
    };
  }
  const fl = fillCell(left0, d, pitchX);
  const fr = fillCell(right0, d, pitchX);
  const ff = fillCell(front0, d, pitchY);
  const fb = fillCell(back0, d, pitchY);
  const xs = axisBounds(left0, fx, pitchX, fl, fr);
  const ys = axisBounds(front0, fy, pitchY, ff, fb);
  return {
    plateW,
    plateD,
    nx: xs.length - 1,
    ny: ys.length - 1,
    pitchX,
    pitchY,
    originX: xs[0],
    originY: ys[0],
    xs,
    ys,
    margins: { left: clean(left0 - fl), right: clean(right0 - fr), front: clean(front0 - ff), back: clean(back0 - fb) },
  };
}

/** Whole cells that fit the drawer, and the margin left on each side (before any edge fill). */
function drawerFit(d: DrawerInput, pitchX: number, pitchY: number) {
  const plateW = Math.max(0, effectiveSize(d.width, d.widthSamples) - d.clearance);
  const plateD = Math.max(0, effectiveSize(d.depth, d.depthSamples) - d.clearance);
  const fx = Math.max(0, Math.floor(plateW / pitchX + EPS));
  const fy = Math.max(0, Math.floor(plateD / pitchY + EPS));
  const mx = clean(plateW - fx * pitchX);
  const my = clean(plateD - fy * pitchY);
  const left0 = clean(mx * clamp01(d.alignX));
  const front0 = clean(my * clamp01(d.alignY));
  return { plateW, plateD, fx, fy, left0, front0, right0: clean(mx - left0), back0: clean(my - front0) };
}

/**
 * The margins a 'spacers' drawer leaves around its grid, which the spacer
 * strips fill: the drawer's inside size less the fit clearance, less the grid.
 * Null for any other drawer (and for a carry case or wall grid, which have none).
 */
export function spacerMargins(d: DrawerInput): { left: number; right: number; front: number; back: number } | null {
  if (d.mode !== 'drawer' || d.fill !== 'spacers' || d.enclosure) return null;
  const per = cellsPerUnit(d);
  const f = drawerFit(d, (d.pitchX > 0 ? d.pitchX : GRID) / per, (d.pitchY > 0 ? d.pitchY : GRID) / per);
  return { left: f.left0, right: f.right0, front: f.front0, back: f.back0 };
}

/** Position of cell boundary k, extrapolating a full pitch per cell outside the grid. */
export function cellEdge(bounds: number[], k: number, pitch: number): number {
  const n = bounds.length - 1;
  if (k <= 0) return bounds[0] + k * pitch;
  if (k >= n) return bounds[n] + (k - n) * pitch;
  return bounds[k];
}

/** Sizes of the cells [i, i + count) along one axis (a full pitch outside the grid). */
export function cellSizes(bounds: number[], i: number, count: number, pitch: number): number[] {
  return Array.from({ length: count }, (_, k) => clean(cellEdge(bounds, i + k + 1, pitch) - cellEdge(bounds, i + k, pitch)));
}

/** Index of the cell containing pos, or -1. */
export function cellIndexAt(bounds: number[], pos: number): number {
  for (let i = 0; i + 1 < bounds.length; i++) if (pos >= bounds[i] && pos < bounds[i + 1]) return i;
  return -1;
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
}

function clean(v: number) {
  return Math.abs(v) < 1e-4 ? 0 : Math.round(v * 1e4) / 1e4;
}

export { parseLength } from '../units';
