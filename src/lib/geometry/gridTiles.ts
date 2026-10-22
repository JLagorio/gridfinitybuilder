/**
 * Boards made of squares (openGrid's 28 mm, Multiboard's 25 mm): the board
 * split into tiles that fit the bed, always on the lines between squares so
 * every square stays whole, and where each tile's screws go. Shared by
 * opengrid.ts and multiboard.ts.
 */

/** A free area of the bed, mm. */
export interface BedArea {
  w: number;
  d: number;
}

/** One printed tile: its squares, half-open [c0, c1) × [r0, r1), counted from the board's bottom left. */
export interface GridTile {
  id: number;
  col: number;
  row: number;
  c0: number;
  c1: number;
  r0: number;
  r1: number;
  /** Which sides are the board's outer edge (the others are seams). */
  outer: { left: boolean; right: boolean; bottom: boolean; top: boolean };
}

export interface GridSplit {
  tiles: GridTile[];
  /** Tiles across and up. */
  cols: number;
  rows: number;
  error?: string;
}

/** Screws: one in from each corner of every tile, also spread across it, or none. */
export type GridScrews = 'corners' | 'grid' | 'none';

/** How snug the parts that fit together are. */
export type GridFit = 'snug' | 'normal' | 'loose';

const EPS = 1e-6;

/** Boundaries of n squares in k runs, as even as can be (the first ones a square longer). */
function runs(n: number, k: number): number[] {
  const base = Math.floor(n / k);
  const extra = n % k;
  const at = [0];
  for (let i = 0; i < k; i++) at.push(at[i] + base + (i < extra ? 1 : 0));
  return at;
}

/**
 * The fewest tiles for a board of nx × ny squares of `pitch` mm on the bed
 * areas, either way round. `reach`: how far a tile sticks out past its squares
 * (Multiboard's teeth); `max`: most squares a tile has each way (0: what the bed takes).
 */
export function splitGrid(nx: number, ny: number, pitch: number, areas: BedArea[], o: { reach: number; max: number }): GridSplit {
  let best: { xs: number[]; ys: number[]; n: number; seams: number } | null = null;
  for (const a of areas) {
    for (const [aw, ad] of [
      [a.w, a.d],
      [a.d, a.w],
    ]) {
      let mx = Math.floor((aw - o.reach) / pitch + EPS);
      let my = Math.floor((ad - o.reach) / pitch + EPS);
      if (o.max > 0) {
        mx = Math.min(mx, o.max);
        my = Math.min(my, o.max);
      }
      if (mx < 1 || my < 1) continue;
      const kx = Math.ceil(nx / mx);
      const ky = Math.ceil(ny / my);
      const n = kx * ky;
      if (!best || n < best.n || (n === best.n && kx + ky < best.seams)) best = { xs: runs(nx, kx), ys: runs(ny, ky), n, seams: kx + ky };
    }
  }
  if (!best) return { tiles: [], cols: 0, rows: 0, error: 'Not even one square fits this bed.' };
  const { xs, ys } = best;
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  const tiles: GridTile[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      tiles.push({
        id: r * cols + c + 1,
        col: c,
        row: r,
        c0: xs[c],
        c1: xs[c + 1],
        r0: ys[r],
        r1: ys[r + 1],
        outer: { left: c === 0, right: c === cols - 1, bottom: r === 0, top: r === rows - 1 },
      });
  return { tiles, cols, rows };
}

/** Grid crossings 1 … n − 1 along a tile n squares long: its ends, or also every `every` squares between. */
function crossings(n: number, mode: GridScrews, every: number): number[] {
  if (n < 2) return [];
  if (mode === 'corners') return n === 2 ? [1] : [1, n - 1];
  const m = Math.max(2, Math.round((n - 2) / Math.max(1, every)) + 1);
  return [...new Set(Array.from({ length: m }, (_, k) => Math.round(1 + ((n - 2) * k) / (m - 1))))];
}

/** A tile's screws, at grid crossings inside it (counted in squares from its bottom left). */
export function tileScrews(w: number, h: number, mode: GridScrews, every: number): [number, number][] {
  if (mode === 'none') return [];
  const out: [number, number][] = [];
  for (const j of crossings(h, mode, every)) for (const i of crossings(w, mode, every)) out.push([i, j]);
  return out;
}

// Cleaning saved options.
export const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, n)) : dflt;
};
export const int = (v: unknown, lo: number, hi: number, dflt: number) => Math.round(num(v, lo, hi, dflt));
export const pick = <T>(v: unknown, all: readonly T[], dflt: T): T => (all.includes(v as T) ? (v as T) : dflt);
export const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);

export const r3 = (v: number) => Math.round(v * 1000) / 1000;
