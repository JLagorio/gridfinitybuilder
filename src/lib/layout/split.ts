import type { GridLayout } from './drawer';

/** One printable baseplate piece, in plate coordinates (drawer front-left = 0,0). */
export interface PieceDef {
  id: number;
  col: number;
  row: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Cell index ranges, half-open: [x0, x1) × [y0, y1). */
  cells: { x0: number; x1: number; y0: number; y1: number };
  /** Which sides are the outside edge of the whole baseplate. */
  outer: { left: boolean; right: boolean; front: boolean; back: boolean };
}

/** Boundaries along one axis, including 0 and the total length. */
export type AxisPartition = number[];

const EPS = 1e-6;

/**
 * Candidate cut positions along one axis. Cuts normally fall on cell boundaries
 * (the middle of a wall), so every receptacle stays whole. Margins are only cut
 * when allowed or when a margin is too big to share a piece with any cell.
 */
export function axisCuts(
  origin: number,
  n: number,
  pitch: number,
  total: number,
  maxLen: number,
  splitMargins: boolean,
): number[] {
  const cuts = new Set<number>();
  for (let k = 1; k < n; k++) cuts.add(round(origin + k * pitch));
  const marginStart = origin;
  const marginEnd = total - (origin + n * pitch);
  const addMarginCuts = (a: number, b: number, len: number) => {
    // a..b is the margin span. Add the grid-edge cut, then even subdivisions if needed.
    if (len < 0.5) return;
    const forced = len + pitch > maxLen || n === 0;
    if (!splitMargins && !forced) return;
    cuts.add(round(a === 0 ? b : a));
    const parts = Math.ceil(len / Math.max(maxLen, 1));
    for (let i = 1; i < parts; i++) cuts.add(round(a + (len * i) / parts));
  };
  addMarginCuts(0, marginStart, marginStart);
  addMarginCuts(origin + n * pitch, total, marginEnd);
  return [...cuts].filter((c) => c > EPS && c < total - EPS).sort((a, b) => a - b);
}

function round(v: number) {
  return Math.round(v * 1e6) / 1e6;
}

/** Fewest pieces possible (greedy is optimal for 1-D interval cover). Returns Infinity if impossible. */
export function minPieces(total: number, cuts: number[], maxLen: number): number {
  const pos = [0, ...cuts, total];
  let i = 0;
  let count = 0;
  while (pos[i] < total - EPS) {
    let j = i;
    while (j + 1 < pos.length && pos[j + 1] - pos[i] <= maxLen + EPS) j++;
    if (j === i) return Infinity;
    i = j;
    count++;
  }
  return count;
}

/** All partitions that use exactly the minimum number of pieces (capped). */
export function enumeratePartitions(total: number, cuts: number[], maxLen: number, limit = 400): AxisPartition[] {
  const pos = [0, ...cuts, total];
  const k = minPieces(total, cuts, maxLen);
  if (!Number.isFinite(k)) return [];
  const out: AxisPartition[] = [];
  const path: number[] = [0];
  const dfs = (i: number, left: number) => {
    if (out.length >= limit) return;
    if (left === 0) {
      if (Math.abs(pos[i] - total) < EPS) out.push([...path]);
      return;
    }
    for (let j = i + 1; j < pos.length; j++) {
      const len = pos[j] - pos[i];
      if (len > maxLen + EPS) break;
      if (total - pos[j] > maxLen * (left - 1) + EPS) continue;
      path.push(pos[j]);
      dfs(j, left - 1);
      path.pop();
    }
  };
  dfs(0, k);
  return out;
}

/** Greedy from the start: as many full-size pieces as possible, remainder last. */
export function greedyPartition(total: number, cuts: number[], maxLen: number): AxisPartition | null {
  const pos = [0, ...cuts, total];
  const out = [0];
  let i = 0;
  while (pos[i] < total - EPS) {
    let j = i;
    while (j + 1 < pos.length && pos[j + 1] - pos[i] <= maxLen + EPS) j++;
    if (j === i) return null;
    out.push(pos[j]);
    i = j;
  }
  return out;
}

/** Lower is better: largest piece first, then spread. */
export function balanceScore(p: AxisPartition): number {
  const lens = p.slice(1).map((v, i) => v - p[i]);
  const max = Math.max(...lens);
  const min = Math.min(...lens);
  return max * 1000 + (max - min);
}

export function makePieces(layout: GridLayout, xs: AxisPartition, ys: AxisPartition): PieceDef[] {
  const pieces: PieceDef[] = [];
  const cellRange = (a: number, b: number, origin: number, pitch: number, n: number) => {
    const c0 = Math.max(0, Math.min(n, Math.round((a - origin) / pitch)));
    const c1 = Math.max(0, Math.min(n, Math.round((b - origin) / pitch)));
    return [c0, Math.max(c0, c1)];
  };
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = xs[c];
      const x1 = xs[c + 1];
      const y0 = ys[r];
      const y1 = ys[r + 1];
      const [cx0, cx1] = cellRange(x0, x1, layout.originX, layout.pitchX, layout.nx);
      const [cy0, cy1] = cellRange(y0, y1, layout.originY, layout.pitchY, layout.ny);
      pieces.push({
        id: r * cols + c + 1,
        col: c,
        row: r,
        x0,
        y0,
        x1,
        y1,
        cells: { x0: cx0, x1: cx1, y0: cy0, y1: cy1 },
        outer: { left: c === 0, right: c === cols - 1, front: r === 0, back: r === rows - 1 },
      });
    }
  }
  return pieces;
}
