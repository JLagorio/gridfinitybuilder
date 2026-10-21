/**
 * "Fill from a list": the packer. It places proposed bins on the drawer's
 * free cells, around blocked cells and the bins already there. The biggest
 * clusters of related bins go first (bins too small for what they're for go last), each bin at the spot that keeps it
 * next to its cluster, on whole cells (whole units on a half grid), snug
 * against what's there, toward the front left. A bin that has no room at its
 * size tries its other sizes; if none fits, it's left out.
 */
import { withBlocked, type CellRect } from '../bins';
import type { GridLayout } from '../layout/drawer';
import type { PlacedBin } from '../project';
import type { BinSize } from './size';

export interface PackItem {
  key: string;
  /** Bins in the same cluster are kept together. */
  cluster: string;
  /** Sizes to try, best first. */
  sizes: BinSize[];
  /** Whether the bin still holds everything on the cells at this spot (narrower edge cells). */
  accept?: (x: number, y: number, size: BinSize) => boolean;
  /** Placed after everything else (a bin that can't hold what it's for anyway). */
  last?: boolean;
}

export interface PackSpot {
  key: string;
  x: number;
  y: number;
  size: BinSize;
}

const EPS = 1e-6;

/** Length of the edge two rects share (0 when they don't touch). */
function contact(a: CellRect, b: CellRect): number {
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  if (a.x + a.w === b.x || b.x + b.w === a.x) return overlap(a.y, a.y + a.d, b.y, b.y + b.d);
  if (a.y + a.d === b.y || b.y + b.d === a.y) return overlap(a.x, a.x + a.w, b.x, b.x + b.w);
  return 0;
}

/** Cells between two rects (0 when they touch). */
function gap(a: CellRect, b: CellRect): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.d), b.y - (a.y + a.d));
  return dx + dy;
}

/** Lexicographic: the first difference decides. */
function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

export function packBins(layout: GridLayout, existing: PlacedBin[], items: PackItem[]): { placed: PackSpot[]; left: string[] } {
  const { nx, ny } = layout;
  const occ: boolean[][] = Array.from({ length: nx }, () => Array<boolean>(ny).fill(false));
  for (const b of withBlocked(existing, layout.mask)) {
    for (let i = Math.max(0, b.x); i < Math.min(nx, b.x + b.opts.unitsX); i++) for (let j = Math.max(0, b.y); j < Math.min(ny, b.y + b.opts.unitsY); j++) occ[i][j] = true;
  }
  const free = (r: CellRect) => {
    if (r.x < 0 || r.y < 0 || r.x + r.w > nx || r.y + r.d > ny) return false;
    for (let i = r.x; i < r.x + r.w; i++) for (let j = r.y; j < r.y + r.d; j++) if (occ[i][j]) return false;
    return true;
  };
  const taken = (i: number, j: number) => i < 0 || j < 0 || i >= nx || j >= ny || occ[i][j];
  // Edge cells narrower than a full cell, and (half grid) where whole units start.
  const partialX = Array.from({ length: nx }, (_, i) => Math.abs(layout.xs[i + 1] - layout.xs[i] - layout.pitchX) > EPS);
  const partialY = Array.from({ length: ny }, (_, j) => Math.abs(layout.ys[j + 1] - layout.ys[j] - layout.pitchY) > EPS);
  const fx = partialX[0] ? 1 : 0;
  const fy = partialY[0] ? 1 : 0;

  // Biggest clusters first (by their biggest bin, then in all), then the biggest bins in each.
  const area = (it: PackItem) => (it.sizes[0] ? it.sizes[0].ux * it.sizes[0].uy : 0);
  const clusters = new Map<string, { max: number; total: number; first: number }>();
  items.forEach((it, i) => {
    if (it.last) return;
    const c = clusters.get(it.cluster) ?? { max: 0, total: 0, first: i };
    clusters.set(it.cluster, { max: Math.max(c.max, area(it)), total: c.total + area(it), first: c.first });
  });
  const order = items
    .map((it, i) => ({ it, i, c: clusters.get(it.cluster) ?? { max: 0, total: 0, first: i } }))
    .sort((a, b) => Number(!!a.it.last) - Number(!!b.it.last) || b.c.max - a.c.max || b.c.total - a.c.total || a.c.first - b.c.first || area(b.it) - area(a.it) || a.i - b.i);

  const placed: PackSpot[] = [];
  const left: string[] = [];
  const rects = new Map<string, CellRect[]>();
  for (const { it } of order) {
    let best = null as { r: CellRect; size: BinSize; score: number[] } | null;
    const mates = rects.get(it.cluster) ?? [];
    for (const size of it.sizes) {
      for (let y = 0; y + size.uy <= ny; y++) {
        for (let x = 0; x + size.ux <= nx; x++) {
          const r = { x, y, w: size.ux, d: size.uy };
          if (!free(r)) continue;
          let touch = 0;
          for (let i = x; i < x + r.w; i++) touch += Number(taken(i, y - 1)) + Number(taken(i, y + r.d));
          for (let j = y; j < y + r.d; j++) touch += Number(taken(x - 1, j)) + Number(taken(x + r.w, j));
          let partial = 0;
          for (let i = x; i < x + r.w; i++) partial += Number(partialX[i]);
          for (let j = y; j < y + r.d; j++) partial += Number(partialY[j]);
          const misaligned = layout.halfGrid ? Number((x - fx) % 2 !== 0) + Number((y - fy) % 2 !== 0) : 0;
          const near = mates.length ? Math.min(...mates.map((m) => gap(r, m))) : 0;
          const shared = mates.reduce((t, m) => t + contact(r, m), 0);
          const score = [-shared, near, partial, misaligned, -touch, y, x];
          if (best && !better(score, best.score)) continue;
          if (it.accept && !it.accept(x, y, size)) continue;
          best = { r, size, score };
        }
      }
      // Sizes are in order of preference: a later one only when this one has no room at all.
      if (best) break;
    }
    if (!best) {
      left.push(it.key);
      continue;
    }
    for (let i = best.r.x; i < best.r.x + best.r.w; i++) for (let j = best.r.y; j < best.r.y + best.r.d; j++) occ[i][j] = true;
    rects.set(it.cluster, [...mates, best.r]);
    placed.push({ key: it.key, x: best.r.x, y: best.r.y, size: best.size });
  }
  // Back in the order they were given.
  const at = new Map(items.map((it, i) => [it.key, i]));
  placed.sort((a, b) => at.get(a.key)! - at.get(b.key)!);
  left.sort((a, b) => at.get(a)! - at.get(b)!);
  return { placed, left };
}
