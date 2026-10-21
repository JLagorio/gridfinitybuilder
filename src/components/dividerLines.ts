import { binLayout, type BinOptions } from '../lib/geometry/bin';
import { WALL } from '../lib/geometry/spec';
import { binCellsAt, binOrigin, type PlacedBin } from '../lib/project';
import type { GridLayout } from '../lib/layout/drawer';

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
  // The body's front-left corner (a stretched bin reaches past its cells).
  const { x: x0, y: y0 } = binOrigin(layout, b);
  const cells = binCellsAt(layout, b);
  const key = `${x0},${y0},${layout.xs.join('/')},${layout.ys.join('/')},${JSON.stringify(cells?.stretch ?? null)}`;
  const hit = cache.get(b.opts);
  if (hit && hit.key === key) return hit.lines;
  const r = binLayout(b.opts, cells);
  const ox = x0 + WALL;
  const oy = y0 + WALL;
  const lines = r.walls.map((w) =>
    w.orient === 'v'
      ? { x1: ox + w.pos, x2: ox + w.pos, y1: oy + w.start, y2: oy + w.end }
      : { x1: ox + w.start, x2: ox + w.end, y1: oy + w.pos, y2: oy + w.pos },
  );
  cache.set(b.opts, { key, lines });
  return lines;
}
