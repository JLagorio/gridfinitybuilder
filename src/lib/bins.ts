import type { PlacedBin } from './project';

/** Cell → bin id map for the drawer grid. */
export function occupancy(bins: PlacedBin[], nx: number, ny: number): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: nx }, () => Array<string | null>(ny).fill(null));
  for (const b of bins) {
    for (let i = b.x; i < b.x + b.opts.unitsX; i++) {
      for (let j = b.y; j < b.y + b.opts.unitsY; j++) {
        if (i >= 0 && j >= 0 && i < nx && j < ny && grid[i][j] === null) grid[i][j] = b.id;
      }
    }
  }
  return grid;
}

export interface CellRect {
  x: number;
  y: number;
  w: number;
  d: number;
}

export function rectsOverlap(a: CellRect, b: CellRect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;
}

export function binRect(b: PlacedBin): CellRect {
  return { x: b.x, y: b.y, w: b.opts.unitsX, d: b.opts.unitsY };
}

/** True if the rect is inside the grid and doesn't collide with other bins. */
export function canPlace(bins: PlacedBin[], r: CellRect, nx: number, ny: number, ignoreId?: string) {
  if (r.x < 0 || r.y < 0 || r.x + r.w > nx || r.y + r.d > ny) return false;
  return !bins.some((b) => b.id !== ignoreId && rectsOverlap(binRect(b), r));
}

export function outOfBounds(b: PlacedBin, nx: number, ny: number) {
  return b.x < 0 || b.y < 0 || b.x + b.opts.unitsX > nx || b.y + b.opts.unitsY > ny;
}

export function newId() {
  return Math.random().toString(36).slice(2, 9);
}
