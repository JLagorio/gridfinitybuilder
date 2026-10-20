import type { GridLayout } from '../layout/drawer';
import type { PieceDef } from '../layout/split';

/** Axis-aligned rectangle in plate coordinates. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const rectsOverlap = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export const growRect = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d });

/** Blocked cells of a layout as a set of "i,j" keys. */
export function maskSet(layout: Pick<GridLayout, 'mask'>): Set<string> {
  return new Set(layout.mask ?? []);
}

const cellOf = (key: string) => key.split(',').map(Number) as [number, number];

/**
 * What a 'void' mask cuts out of the plate: each blocked cell, out to the
 * plate edge when the cell is on the edge of the grid (so the margin next to
 * it goes too and the plate gets a notch rather than a thin sliver).
 */
export function voidRects(layout: GridLayout): Rect[] {
  if (layout.maskStyle !== 'void' || !layout.mask?.length) return [];
  const { xs, ys, nx, ny, plateW, plateD } = layout;
  return layout.mask.map((k) => {
    const [i, j] = cellOf(k);
    return {
      x0: i === 0 ? -1 : xs[i],
      x1: i === nx - 1 ? plateW + 1 : xs[i + 1],
      y0: j === 0 ? -1 : ys[j],
      y1: j === ny - 1 ? plateD + 1 : ys[j + 1],
    };
  });
}

/** True when 'void' blocked cells take up the whole piece, so there's nothing to print. */
export function pieceIsVoid(layout: GridLayout, piece: PieceDef): boolean {
  const { cells } = piece;
  if (cells.x1 <= cells.x0 || cells.y1 <= cells.y0) return false;
  const voids = voidRects(layout);
  if (!voids.length) return false;
  const inside = (b: number[], lo: number, hi: number) => b.filter((v) => v > lo + 1e-6 && v < hi - 1e-6);
  const xs = [piece.x0, ...inside(layout.xs, piece.x0, piece.x1), piece.x1];
  const ys = [piece.y0, ...inside(layout.ys, piece.y0, piece.y1), piece.y1];
  for (let a = 0; a + 1 < xs.length; a++) {
    for (let b = 0; b + 1 < ys.length; b++) {
      const x = (xs[a] + xs[a + 1]) / 2;
      const y = (ys[b] + ys[b + 1]) / 2;
      if (!voids.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1)) return false;
    }
  }
  return true;
}
