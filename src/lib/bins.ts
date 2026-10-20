import type { PlacedBin } from './project';
import { DEFAULT_BIN, binTotalHeight } from './geometry/bin';

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

/** Id prefix of the stand-ins for blocked cells (see withBlocked). */
export const BLOCKED_ID = '#blocked:';

/**
 * The bins plus a 1 × 1 stand-in for every blocked cell ("i,j", see
 * DrawerInput.mask), so canPlace, canMoveGroup, fitResize and findSpot treat
 * blocked cells as taken. Pass the result to placement checks only.
 */
export function withBlocked(bins: PlacedBin[], mask: readonly string[] | undefined): PlacedBin[] {
  if (!mask?.length) return bins;
  const opts = { ...DEFAULT_BIN, unitsX: 1, unitsY: 1 };
  return [
    ...bins,
    ...mask.map((k) => {
      const [x, y] = k.split(',').map(Number);
      return { id: BLOCKED_ID + k, x, y, opts };
    }),
  ];
}

/** True if the bin covers a blocked cell. */
export function onBlocked(b: PlacedBin, mask: readonly string[] | undefined): boolean {
  if (!mask?.length) return false;
  const r = binRect(b);
  return mask.some((k) => {
    const [x, y] = k.split(',').map(Number);
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.d;
  });
}

export function newId() {
  return Math.random().toString(36).slice(2, 9);
}

/**
 * Tallest bin (in 7 mm units) that fits under `room` mm, measured from the
 * baseplate floor a bin sits on. Returns 0 when nothing fits.
 */
export function maxBinUnits(room: number, lip: boolean): number {
  if (!(room > 0)) return 0;
  let u = 0;
  while (binTotalHeight({ heightUnits: u + 1, lip }) <= room + 1e-6 && u < 60) u++;
  return u;
}
