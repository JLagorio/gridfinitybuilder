/**
 * Switching a drawer between the full grid and the half grid (21 mm cells,
 * see DrawerInput.halfGrid). Bin positions and sizes and blocked cells count
 * cells, so they are converted: each bin stays where it is in the drawer,
 * snapped to the new grid (×2 going to the half grid, ÷2 coming back). Odd
 * half-unit bins shrink to whole units; bins that no longer fit move to the
 * nearest free spot. Stacked bins follow the floor bin they stand on.
 */
import { MAX_CELLS } from '../geometry/placement';
import { canPlace, withBlocked, type CellRect } from '../bins';
import type { PlacedBin } from '../project';
import { alignStacks, stacksOf } from '../stacking';
import { cellEdge, cellsPerUnit, computeLayout, type DrawerInput, type GridLayout } from './drawer';

export interface GridSwitch {
  drawer: DrawerInput;
  bins: PlacedBin[];
  /** Bins that changed size or had to move to fit the new grid. */
  adjusted: number;
}

const EPS = 1e-6;

/** Boundary index nearest to `pos` (a full pitch per cell outside the grid); ties go to the lower index. */
function nearestIndex(bounds: number[], pitch: number, pos: number): number {
  const n = bounds.length - 1;
  let best = 0;
  let bd = Infinity;
  for (let k = -n - 2; k <= 2 * n + 2; k++) {
    const d = Math.abs(cellEdge(bounds, k, pitch) - pos);
    if (d < bd - EPS) {
      bd = d;
      best = k;
    }
  }
  return best;
}

/** A span of cells [i, i + n) on the old axis, snapped to the new one. */
function snapSpan(fromB: number[], fromP: number, toB: number[], toP: number, i: number, n: number, max: number): [number, number] {
  const a = cellEdge(fromB, i, fromP);
  const b = cellEdge(fromB, i + n, fromP);
  const k0 = nearestIndex(toB, toP, a);
  // Shift the far edge as much as the near one moved, so the size survives an offset between the grids.
  const shift = cellEdge(toB, k0, toP) - a;
  const k1 = Math.max(k0 + 1, nearestIndex(toB, toP, b + shift));
  return [k0, Math.min(max, k1 - k0)];
}

type MmRect = { x0: number; x1: number; y0: number; y1: number };

function cellMm(l: GridLayout, i: number, j: number): MmRect {
  return { x0: l.xs[i], x1: l.xs[i + 1], y0: l.ys[j], y1: l.ys[j + 1] };
}

const area = (r: MmRect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
const overlap = (a: MmRect, b: MmRect) =>
  area({ x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) });

/**
 * Blocked cells of `from` as cells of `to`, covering what was blocked:
 * - onto a finer grid, a cell is blocked when blocked cells cover a quarter of it;
 * - onto a coarser grid, when they cover half of it or a whole blocked cell
 *   lies inside it, and a blocked cell left over by that blocks every cell it touches.
 * So nothing blocked is lost, and switching there and back gives the same cells.
 */
export function convertMask(from: GridLayout, to: GridLayout): string[] {
  if (!from.mask?.length) return [];
  const old = from.mask.map((k) => {
    const [i, j] = k.split(',').map(Number);
    return cellMm(from, i, j);
  });
  const finer = to.pitchX < from.pitchX - EPS;
  const blocked = new Map<string, MmRect>();
  const cells: [string, MmRect][] = [];
  for (let i = 0; i < to.nx; i++) for (let j = 0; j < to.ny; j++) cells.push([`${i},${j}`, cellMm(to, i, j)]);
  for (const [k, r] of cells) {
    const covered = old.reduce((t, o) => t + overlap(o, r), 0);
    const holds = old.some((o) => overlap(o, r) >= area(o) - EPS);
    if (covered >= (finer ? 0.25 : 0.5) * area(r) - EPS || (!finer && holds)) blocked.set(k, r);
  }
  for (const o of old) {
    if ([...blocked.values()].some((r) => overlap(o, r) > EPS)) continue;
    for (const [k, r] of cells) if (overlap(o, r) > EPS) blocked.set(k, r);
  }
  return [...blocked.keys()].sort();
}

/** Free spot for a w × d rect nearest (x, y), or null. */
function nearestFree(taken: PlacedBin[], w: number, d: number, x: number, y: number, nx: number, ny: number): CellRect | null {
  let best: CellRect | null = null;
  let bd = Infinity;
  for (let j = 0; j + d <= ny; j++) {
    for (let i = 0; i + w <= nx; i++) {
      const dist = Math.abs(i - x) + Math.abs(j - y);
      if (dist >= bd) continue;
      const r = { x: i, y: j, w, d };
      if (canPlace(taken, r, nx, ny)) {
        best = r;
        bd = dist;
      }
    }
  }
  return best;
}

/**
 * The drawer with the half grid turned on or off, and its bins and blocked
 * cells converted. Everything else (stretch, bin settings) carries over.
 */
export function switchHalfGrid(drawer: DrawerInput, bins: PlacedBin[], on: boolean): GridSwitch {
  if (!!drawer.halfGrid === on) return { drawer, bins, adjusted: 0 };
  const { halfGrid: _, ...rest } = drawer;
  const next: DrawerInput = on ? { ...rest, halfGrid: true } : rest;
  const from = computeLayout(drawer);
  next.mask = convertMask(from, computeLayout({ ...next, mask: [] }));
  const to = computeLayout(next);
  const max = on ? MAX_CELLS : MAX_CELLS / 2;
  // Bins already placed (plus blocked cells) are taken; front-left bins go first.
  let taken = withBlocked([], to.mask);
  let adjusted = 0;
  const order = [...bins].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = new Map<string, PlacedBin>();
  const stacks = stacksOf(bins);
  for (const b of order) {
    if (stacks.level.get(b.id)) continue;
    const [x, w] = snapSpan(from.xs, from.pitchX, to.xs, to.pitchX, b.x, b.opts.unitsX, max);
    const [y, d] = snapSpan(from.ys, from.pitchY, to.ys, to.pitchY, b.y, b.opts.unitsY, max);
    // Same size in mm (to the nearest cell)? Then only the grid moved under it.
    const mm = (l: GridLayout, r: CellRect) => [
      cellEdge(l.xs, r.x + r.w, l.pitchX) - cellEdge(l.xs, r.x, l.pitchX),
      cellEdge(l.ys, r.y + r.d, l.pitchY) - cellEdge(l.ys, r.y, l.pitchY),
    ];
    const [ow, od] = mm(from, { x: b.x, y: b.y, w: b.opts.unitsX, d: b.opts.unitsY });
    let r: CellRect = { x, y, w, d };
    let changed = (() => {
      const [nw, nd] = mm(to, r);
      return Math.abs(nw - ow) > 1 || Math.abs(nd - od) > 1;
    })();
    if (!canPlace(taken, r, to.nx, to.ny)) {
      // Nearest free spot of the same size, then smaller, then 1 × 1; as a last resort it stays (and shows as a clash).
      const sizes: [number, number][] = [
        [w, d],
        [w - 1, d],
        [w, d - 1],
        [w - 1, d - 1],
        [1, 1],
      ];
      const spot = sizes
        .filter(([sw, sd]) => sw >= 1 && sd >= 1)
        .reduce<CellRect | null>((found, [sw, sd]) => found ?? nearestFree(taken, sw, sd, x, y, to.nx, to.ny), null);
      if (spot) r = spot;
      changed = true;
    }
    if (changed) adjusted++;
    const nb: PlacedBin = { ...b, x: r.x, y: r.y, opts: { ...b.opts, unitsX: r.w, unitsY: r.d } };
    placed.set(b.id, nb);
    taken = [...taken, nb];
  }
  return { drawer: next, bins: alignStacks(bins.map((b) => placed.get(b.id) ?? b)), adjusted };
}

/** Grid size in full units for the summary ("12 × 8", or "12.5 × 8" on a half grid). */
export function unitsAcross(layout: GridLayout): { x: number; y: number } {
  const per = cellsPerUnit(layout);
  return { x: layout.nx / per, y: layout.ny / per };
}
