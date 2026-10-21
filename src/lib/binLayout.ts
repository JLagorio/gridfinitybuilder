import type { BinOptions } from './geometry/bin';
import type { PlacedBin } from './project';
import { binRect, canPlace, type CellRect } from './bins';

/** Bins never get wider or deeper than this (see sanitizeBin). */
export const MAX_BIN_UNITS = 12;

/** Smallest cell rect covering all the bins. */
export function groupBounds(bins: Pick<PlacedBin, 'x' | 'y' | 'opts'>[]): CellRect {
  if (!bins.length) return { x: 0, y: 0, w: 0, d: 0 };
  const x0 = Math.min(...bins.map((b) => b.x));
  const y0 = Math.min(...bins.map((b) => b.y));
  const x1 = Math.max(...bins.map((b) => b.x + b.opts.unitsX));
  const y1 = Math.max(...bins.map((b) => b.y + b.opts.unitsY));
  return { x: x0, y: y0, w: x1 - x0, d: y1 - y0 };
}

/** True if the bins can all shift by (dx, dy) together; they never block each other. */
export function canMoveGroup(all: PlacedBin[], ids: readonly string[], dx: number, dy: number, nx: number, ny: number) {
  const set = new Set(ids);
  const rest = all.filter((b) => !set.has(b.id));
  const moving = all.filter((b) => set.has(b.id));
  return moving.length > 0 && moving.every((b) => canPlace(rest, { ...binRect(b), x: b.x + dx, y: b.y + dy }, nx, ny));
}

/** Copied bins, relative to the front-left corner of their group. */
export interface ClipBin {
  dx: number;
  dy: number;
  opts: BinOptions;
  /** What's in it (copies keep their contents; the stretch stays with the original). */
  contents?: string;
  compContents?: Record<string, string>;
}

export function toClip(bins: PlacedBin[]): ClipBin[] {
  const g = groupBounds(bins);
  return bins.map((b) => ({
    dx: b.x - g.x,
    dy: b.y - g.y,
    opts: structuredClone(b.opts),
    ...(b.contents ? { contents: b.contents } : {}),
    ...(b.compContents ? { compContents: { ...b.compContents } } : {}),
  }));
}

export function clipFits(all: PlacedBin[], clip: ClipBin[], x: number, y: number, nx: number, ny: number) {
  return clip.every((c) => canPlace(all, { x: x + c.dx, y: y + c.dy, w: c.opts.unitsX, d: c.opts.unitsY }, nx, ny));
}

/**
 * Where a copied group fits: the preferred spots in order, then the first free
 * spot scanning from the front-left corner, row by row.
 */
export function findSpot(
  all: PlacedBin[],
  clip: ClipBin[],
  nx: number,
  ny: number,
  prefer: [number, number][] = [],
): [number, number] | null {
  if (!clip.length) return null;
  for (const [x, y] of prefer) if (clipFits(all, clip, x, y, nx, ny)) return [x, y];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (clipFits(all, clip, x, y, nx, ny)) return [x, y];
  return null;
}

/** Spots right next to a group, for duplicates: right, behind, left, in front. */
export function besideGroup(g: CellRect): [number, number][] {
  return [
    [g.x + g.w, g.y],
    [g.x, g.y + g.d],
    [g.x - g.w, g.y],
    [g.x, g.y - g.d],
  ];
}

/** A resize handle: the edges it drags, by compass direction (north = back of the drawer). */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** Index of the boundary nearest to pos (bounds are the n + 1 cell boundaries). */
export function nearestBoundary(bounds: number[], pos: number): number {
  let best = 0;
  for (let k = 1; k < bounds.length; k++) if (Math.abs(bounds[k] - pos) < Math.abs(bounds[best] - pos)) best = k;
  return best;
}

/** The rect a handle asks for when dragged to boundary (bx, by). Never smaller than one cell. */
export function resizeTarget(r: CellRect, h: Handle, bx: number, by: number, max = MAX_BIN_UNITS): CellRect {
  let x0 = r.x;
  let x1 = r.x + r.w;
  let y0 = r.y;
  let y1 = r.y + r.d;
  if (h.includes('e')) x1 = Math.min(Math.max(bx, x0 + 1), x0 + max);
  if (h.includes('w')) x0 = Math.max(Math.min(bx, x1 - 1), x1 - max);
  if (h.includes('n')) y1 = Math.min(Math.max(by, y0 + 1), y0 + max);
  if (h.includes('s')) y0 = Math.max(Math.min(by, y1 - 1), y1 - max);
  return { x: x0, y: y0, w: x1 - x0, d: y1 - y0 };
}

/**
 * Move each edge from where it was toward the target one cell at a time,
 * stopping before it would hit another bin or leave the grid, or (with `fits`)
 * grow the bin past what the printer takes.
 */
export function fitResize(others: PlacedBin[], from: CellRect, to: CellRect, nx: number, ny: number, fits?: (r: CellRect) => boolean): CellRect {
  const e = { x0: from.x, x1: from.x + from.w, y0: from.y, y1: from.y + from.d };
  const goal = { x0: to.x, x1: to.x + to.w, y0: to.y, y1: to.y + to.d };
  const rect = (v: typeof e): CellRect => ({ x: v.x0, y: v.y0, w: v.x1 - v.x0, d: v.y1 - v.y0 });
  for (const k of ['x1', 'x0', 'y1', 'y0'] as const) {
    while (e[k] !== goal[k]) {
      const next = { ...e, [k]: e[k] + Math.sign(goal[k] - e[k]) };
      const r = rect(next);
      const grows = r.w * r.d > rect(e).w * rect(e).d;
      if (r.w < 1 || r.d < 1 || (grows && (!canPlace(others, r, nx, ny) || (fits && !fits(r))))) break;
      e[k] = next[k];
    }
  }
  return rect(e);
}
