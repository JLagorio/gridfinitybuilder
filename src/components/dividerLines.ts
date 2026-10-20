import { binLayout, type BinOptions } from '../lib/geometry/bin';
import { BASE_TOP, GRID, WALL } from '../lib/geometry/spec';
import { binCellsAt, type PlacedBin } from '../lib/project';
import { cellEdge, type GridLayout } from '../lib/layout/drawer';

export interface PlateLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Bin options are replaced (never mutated) on edit, so they key the cache.
const cache = new WeakMap<BinOptions, { key: string; lines: PlateLine[] }>();

/** A bin's divider centerlines in plate mm (y toward the back), for the drawer grid. */
export function dividerLines(layout: GridLayout, b: PlacedBin): PlateLine[] {
  const x0 = cellEdge(layout.xs, b.x, layout.pitchX);
  const y0 = cellEdge(layout.ys, b.y, layout.pitchY);
  const key = `${x0},${y0},${layout.xs.join('/')},${layout.ys.join('/')}`;
  const hit = cache.get(b.opts);
  if (hit && hit.key === key) return hit.lines;
  const r = binLayout(b.opts, binCellsAt(layout, b));
  const ox = x0 + (GRID - BASE_TOP) / 2 + WALL;
  const oy = y0 + (GRID - BASE_TOP) / 2 + WALL;
  const lines = r.walls.map((w) =>
    w.orient === 'v'
      ? { x1: ox + w.pos, x2: ox + w.pos, y1: oy + w.start, y2: oy + w.end }
      : { x1: ox + w.start, x2: ox + w.end, y1: oy + w.pos, y2: oy + w.pos },
  );
  cache.set(b.opts, { key, lines });
  return lines;
}
