import { GRID } from '../geometry/spec';

/** What fills the space left over between the grid and the drawer walls. */
export type EdgeFill = 'solid' | 'half' | 'fit';

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
}

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
  /** Nominal pitch (full cells). */
  pitchX: number;
  pitchY: number;
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
  if (d.fill === 'half') return margin + EPS >= pitch / 2 ? pitch / 2 : 0;
  if (d.fill === 'fit') return margin + EPS >= Math.max(d.minFill, 8) ? margin : 0;
  return 0;
}

export function computeLayout(d: DrawerInput): GridLayout {
  const pitchX = d.pitchX > 0 ? d.pitchX : GRID;
  const pitchY = d.pitchY > 0 ? d.pitchY : GRID;
  if (d.mode === 'grid') {
    const nx = Math.max(1, Math.floor(d.gridX));
    const ny = Math.max(1, Math.floor(d.gridY));
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
  const plateW = Math.max(0, effectiveSize(d.width, d.widthSamples) - d.clearance);
  const plateD = Math.max(0, effectiveSize(d.depth, d.depthSamples) - d.clearance);
  const fx = Math.max(0, Math.floor(plateW / pitchX + EPS));
  const fy = Math.max(0, Math.floor(plateD / pitchY + EPS));
  const mx = clean(plateW - fx * pitchX);
  const my = clean(plateD - fy * pitchY);
  const left0 = clean(mx * clamp01(d.alignX));
  const front0 = clean(my * clamp01(d.alignY));
  const right0 = clean(mx - left0);
  const back0 = clean(my - front0);
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
