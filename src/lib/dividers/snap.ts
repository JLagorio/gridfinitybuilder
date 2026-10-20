/**
 * Snapping for the interior editor. Everything is in cavity mm; the editor
 * converts its pixel tolerance to mm before calling in.
 */
import { BASE_TOP, GRID, WALL } from '../geometry/spec';
import {
  acrossSize,
  compartmentAt,
  covers,
  dependents,
  edgeCenter,
  neighborsAt,
  other,
  rayEnds,
  resolveLayout,
  wallAt,
  type Side,
} from './resolve';
import { resolveIn, type InnerSize, type PlaceHow } from './edit';
import { EDGE, MIN_GAP, MIN_WALL, T, type DividerLayout, type Orient, type Ref, type ResolvedLayout } from './types';

export type SnapKind = PlaceHow['kind'];

export interface SnapMatch {
  kind: SnapKind;
  pos: number;
  /** Short text for the guide: "50%", "aligned", "cell line". */
  label: string;
  /** Fraction, for 'fraction' / 'bin-fraction'. */
  t?: number;
  /** The wall it lines up with, for 'align'. */
  wallId?: string;
}

export interface SnapResult extends SnapMatch {
  /** Every candidate at the chosen position (e.g. 50% and aligned at once), for drawing guides. */
  matches: SnapMatch[];
  loRef: Ref;
  hiRef: Ref;
}

export interface SnapInput {
  /** Pointer coordinate across the wall's axis. */
  pointer: number;
  /** Walls (or edges) bounding the span the wall moves in. */
  lo: Side;
  hi: Side;
  /** Cavity size across the axis. */
  inner: number;
  /** Other walls of the same orientation to line up with. */
  align?: { id: string; pos: number }[];
  /** Grid cell seams across the axis. */
  cells?: number[];
  /** Snap distance (mm). */
  tolerance: number;
  /** Fine increment (mm), e.g. snapStep(units). */
  step: number;
  /** Alt held: only the fine step. */
  free?: boolean;
  /** Allowed range; defaults to MIN_GAP clear on both sides. */
  min?: number;
  max?: number;
}

const FRACTIONS: [number, string][] = [
  [1 / 2, '50%'],
  [1 / 3, '33%'],
  [2 / 3, '67%'],
  [1 / 4, '25%'],
  [3 / 4, '75%'],
];
const PRIORITY: Record<SnapKind, number> = { fraction: 0, align: 1, 'bin-fraction': 2, cell: 3, step: 4, free: 5 };

/**
 * Snap a wall position. Fractions of the span, alignment with other walls,
 * fractions of the whole cavity and grid-cell seams win (nearest first, in that
 * order on ties) when within tolerance; otherwise the clear gap from the low
 * side is rounded to the fine step.
 */
export function snapAcross(s: SnapInput): SnapResult {
  const min = s.min ?? s.lo.pos + T + MIN_GAP;
  const max = Math.max(min, s.max ?? s.hi.pos - T - MIN_GAP);
  const refs = { loRef: s.lo.ref, hiRef: s.hi.ref };
  const cands: SnapMatch[] = [];
  if (!s.free) {
    const span = s.hi.pos - s.lo.pos;
    for (const [t, label] of FRACTIONS) cands.push({ kind: 'fraction', pos: s.lo.pos + t * span, label, t });
    const b0 = edgeCenter('lo', s.inner);
    const b1 = edgeCenter('hi', s.inner);
    const whole = Math.abs(s.lo.pos - b0) < 1e-6 && Math.abs(s.hi.pos - b1) < 1e-6;
    if (!whole) for (const [t, label] of FRACTIONS) cands.push({ kind: 'bin-fraction', pos: b0 + t * (b1 - b0), label: `${label} of bin`, t });
    for (const a of s.align ?? []) cands.push({ kind: 'align', pos: a.pos, label: 'aligned', wallId: a.id });
    for (const c of s.cells ?? []) cands.push({ kind: 'cell', pos: c, label: 'cell line' });
  }
  const inRange = cands.filter((c) => c.pos >= min - 1e-6 && c.pos <= max + 1e-6);
  let best: SnapMatch | null = null;
  let bestScore = Infinity;
  for (const c of inRange) {
    const d = Math.abs(c.pos - s.pointer);
    if (d > s.tolerance) continue;
    const score = d + PRIORITY[c.kind] * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best) {
    const chosen = best;
    const matches = inRange.filter((c) => Math.abs(c.pos - chosen.pos) < 0.05);
    return { ...chosen, matches, ...refs };
  }
  const step = s.step > 0 ? s.step : 1;
  const gap = Math.round((s.pointer - s.lo.pos - T) / step) * step;
  let pos = s.lo.pos + T + gap;
  // Stay on the step grid when clamping.
  if (pos < min - 1e-9) pos = s.lo.pos + T + Math.ceil((min - s.lo.pos - T - 1e-9) / step) * step;
  if (pos > max + 1e-9) pos = s.lo.pos + T + Math.floor((max - s.lo.pos - T + 1e-9) / step) * step;
  pos = Math.min(max, Math.max(min, pos));
  return { kind: s.free ? 'free' : 'step', pos, label: '', matches: [], ...refs };
}

/** Grid-cell seams in cavity coordinates, from the bin's cell pitches along one axis. */
export function cellLines(cells: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let k = 0; k < cells.length - 1; k++) {
    acc += cells[k];
    out.push(acc - (GRID - BASE_TOP) / 2 - WALL);
  }
  return out;
}

export interface SnapOptions {
  tolerance: number;
  step: number;
  free?: boolean;
  /** Cell seams along x (for 'v' walls) and y (for 'h' walls). */
  cellsX?: number[];
  cellsY?: number[];
}

export interface Ghost {
  orient: Orient;
  pos: number;
  start: number;
  end: number;
  startRef: Ref;
  endRef: Ref;
  lo: Side;
  hi: Side;
  snap: SnapResult;
  /** Key of the compartment it splits. */
  comp: string;
}

/** Which way a new wall should run for a pointer in a compartment: toward the nearer midline. */
export function autoOrient(r: ResolvedLayout, x: number, y: number): Orient {
  const nv = neighborsAt(r, 'v', x, y);
  const nh = neighborsAt(r, 'h', y, x);
  const fits = (nb: { lo: Side; hi: Side }) => nb.hi.pos - nb.lo.pos >= 2 * (T + MIN_GAP);
  if (!fits(nv)) return 'h';
  if (!fits(nh)) return 'v';
  const u = (x - nv.lo.pos) / (nv.hi.pos - nv.lo.pos);
  const v = (y - nh.lo.pos) / (nh.hi.pos - nh.lo.pos);
  return Math.abs(u - 0.5) <= Math.abs(v - 0.5) ? 'v' : 'h';
}

/** The wall that a click at (x, y) would add, snapped, spanning its compartment wall to wall. */
export function ghostAt(r: ResolvedLayout, x: number, y: number, orient: Orient, o: SnapOptions): Ghost | null {
  if (wallAt(r, x, y)) return null;
  const c = compartmentAt(r, x, y);
  if (!c) return null;
  const across = orient === 'v' ? x : y;
  const run = orient === 'v' ? y : x;
  const nb = neighborsAt(r, orient, across, run);
  if (nb.hi.pos - nb.lo.pos < 2 * (T + MIN_GAP)) return null;
  const snap = snapAcross({
    pointer: across,
    lo: nb.lo,
    hi: nb.hi,
    inner: acrossSize(orient, r.innerW, r.innerD),
    align: r.walls.filter((w) => w.orient === orient).map((w) => ({ id: w.id, pos: w.pos })),
    cells: orient === 'v' ? o.cellsX : o.cellsY,
    tolerance: o.tolerance,
    step: o.step,
    free: o.free,
  });
  const ends = rayEnds(r, orient, snap.pos, run);
  if (ends.end.pos - ends.start.pos < MIN_WALL) return null;
  return {
    orient,
    pos: snap.pos,
    start: ends.start.pos,
    end: ends.end.pos,
    startRef: ends.start.ref,
    endRef: ends.end.ref,
    lo: nb.lo,
    hi: nb.hi,
    snap,
    comp: c.key,
  };
}

// ---------------------------------------------------------------------------
// Dragging
// ---------------------------------------------------------------------------

/** Walls and compartments, as identities — equal when a drag didn't change the topology. */
export function topologyKey(r: ResolvedLayout): string {
  return `${r.walls.map((w) => w.id).join(',')}|${r.compartments
    .map((c) => c.key)
    .sort()
    .join(';')}`;
}

/** The layout with one wall moved to centerline `p`, keeping its references (its dependents follow). */
export function withWallAt(l: DividerLayout, r: ResolvedLayout, id: string, p: number): DividerLayout {
  const R = r.byId.get(id);
  if (!R) return l;
  return {
    ...l,
    walls: l.walls.map((w) => {
      if (w.id !== id) return w;
      if (w.pos.kind === 'exact')
        return { ...w, pos: { ...w.pos, mm: Math.max(0, w.pos.from === 'lo' ? p - R.loPos - T : R.hiPos - p - T) } };
      const span = R.hiPos - R.loPos;
      return { ...w, pos: { kind: 'ratio', t: span > 0 ? (p - R.loPos) / span : 0.5 } };
    }),
  };
}

export interface DragContext {
  id: string;
  orient: Orient;
  /** Centerline when the drag started. */
  origin: number;
  /** Span used for fraction snaps: nearest neighbors that don't move with the wall. */
  lo: Side;
  hi: Side;
  /** Walls to line up with (not the dragged one or walls that follow it). */
  align: { id: string; pos: number }[];
  run: number;
}

export function dragContext(l: DividerLayout, r: ResolvedLayout, id: string): DragContext | null {
  const R = r.byId.get(id);
  if (!R) return null;
  const skip = dependents(l, id);
  skip.add(id);
  const run = (R.start + R.end) / 2;
  const nb = neighborsAt(r, R.orient, R.pos, run, skip);
  return {
    id,
    orient: R.orient,
    origin: R.pos,
    lo: nb.lo,
    hi: nb.hi,
    align: r.walls.filter((w) => w.orient === R.orient && !skip.has(w.id)).map((w) => ({ id: w.id, pos: w.pos })),
    run,
  };
}

/**
 * Move a wall toward `target` as far as possible without changing the layout's
 * topology (no wall crossing another, no compartment vanishing or dropping
 * below MIN_GAP). Returns the reached position and the resulting layout.
 */
export function clampDrag(l: DividerLayout, size: InnerSize, id: string, target: number) {
  const r0 = resolveIn(l, size);
  const R = r0.byId.get(id);
  if (!R) return { pos: target, layout: l, resolved: r0 };
  const key0 = topologyKey(r0);
  const min0 = new Map(r0.compartments.map((c) => [c.key, Math.min(c.bounds.x1 - c.bounds.x0, c.bounds.y1 - c.bounds.y0)]));
  const test = (p: number) => {
    const lay = withWallAt(l, r0, id, p);
    const res = resolveLayout(lay, size.w, size.d);
    if (topologyKey(res) !== key0) return null;
    for (const c of res.compartments) {
      const m = Math.min(c.bounds.x1 - c.bounds.x0, c.bounds.y1 - c.bounds.y0);
      if (m < Math.min(MIN_GAP, min0.get(c.key) ?? MIN_GAP) - 1e-6) return null;
    }
    const W = res.byId.get(id);
    if (!W || Math.abs(W.pos - p) > 1e-3) return null;
    return { layout: lay, resolved: res };
  };
  const hit = test(target);
  if (hit) return { pos: target, ...hit };
  const across = acrossSize(R.orient, size.w, size.d);
  let good = R.pos;
  let bad = Math.min(across, Math.max(0, target));
  for (let k = 0; k < 20; k++) {
    const m = (good + bad) / 2;
    if (test(m)) good = m;
    else bad = m;
  }
  const fin = test(good);
  return fin ? { pos: good, ...fin } : { pos: R.pos, layout: l, resolved: r0 };
}

/** Walls (or the edge) one end of a wall can attach to: perpendicular walls crossing its line. */
export function endTargets(r: ResolvedLayout, id: string, which: 'start' | 'end'): Side[] {
  const W = r.byId.get(id);
  if (!W) return [];
  const runSize = acrossSize(other(W.orient), r.innerW, r.innerD);
  const out: Side[] = [{ ref: EDGE, pos: which === 'start' ? 0 : runSize }];
  for (const w of r.walls) {
    if (w.orient === W.orient || !covers(w, W.pos)) continue;
    if (which === 'start' ? w.pos < W.end - MIN_WALL : w.pos > W.start + MIN_WALL) out.push({ ref: w.id, pos: w.pos });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

/** Nearest end target to a run coordinate. */
export function nearestTarget(targets: Side[], run: number): Side | null {
  let best: Side | null = null;
  for (const t of targets) if (!best || Math.abs(t.pos - run) < Math.abs(best.pos - run)) best = t;
  return best;
}
