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
import { freeWallMid, freeWallShape } from './resolve';
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

// ---------------------------------------------------------------------------
// Points (diagonal / curved walls)
// ---------------------------------------------------------------------------

export type PointSnapKind = 'corner' | 'end' | 'mid' | 'fraction' | 'axis' | 'edge' | 'on-wall' | 'angle' | 'step' | 'free';

export interface PointSnap {
  x: number;
  y: number;
  kind: PointSnapKind;
  /** Short text for the guide chip ("corner", "midpoint", "45°"…); '' for plain steps. */
  label: string;
}

export interface PointSnapOptions {
  tolerance: number;
  /** Fine increment (mm) when nothing else snaps. */
  step: number;
  /** Alt held: no snapping at all. */
  free?: boolean;
  /** The other end of the wall being drawn: lines up with it, and `constrain` keeps 15° steps from it. */
  from?: [number, number];
  /** Shift held: angle in 15° steps from `from`. */
  constrain?: boolean;
  /** Free wall being edited: its own points don't count. */
  exclude?: string;
}

interface PointTarget {
  x: number;
  y: number;
  kind: PointSnapKind;
  label: string;
  prio: number;
}

/** Points a diagonal wall's end snaps to: cavity corners and edge midpoints, wall ends, midpoints and quarter points. */
export function pointTargets(r: ResolvedLayout, exclude?: string): PointTarget[] {
  const { innerW: W, innerD: D } = r;
  const out: PointTarget[] = [
    { x: 0, y: 0, kind: 'corner', label: 'corner', prio: 0 },
    { x: W, y: 0, kind: 'corner', label: 'corner', prio: 0 },
    { x: W, y: D, kind: 'corner', label: 'corner', prio: 0 },
    { x: 0, y: D, kind: 'corner', label: 'corner', prio: 0 },
    { x: W / 2, y: 0, kind: 'mid', label: 'edge midpoint', prio: 2 },
    { x: W / 2, y: D, kind: 'mid', label: 'edge midpoint', prio: 2 },
    { x: 0, y: D / 2, kind: 'mid', label: 'edge midpoint', prio: 2 },
    { x: W, y: D / 2, kind: 'mid', label: 'edge midpoint', prio: 2 },
  ];
  for (const w of r.walls) {
    const at = (run: number): [number, number] => (w.orient === 'v' ? [w.pos, run] : [run, w.pos]);
    for (const [t, kind, label, prio] of [
      [0, 'end', 'wall end', 1],
      [1, 'end', 'wall end', 1],
      [0.5, 'mid', 'midpoint', 2],
      [0.25, 'fraction', '25%', 3],
      [0.75, 'fraction', '75%', 3],
    ] as const) {
      const [x, y] = at(w.start + t * (w.end - w.start));
      out.push({ x, y, kind, label, prio });
    }
  }
  for (const f of r.free) {
    if (f.id === exclude) continue;
    const m = freeWallMid(f);
    out.push(
      { x: f.a[0], y: f.a[1], kind: 'end', label: 'wall end', prio: 1 },
      { x: f.b[0], y: f.b[1], kind: 'end', label: 'wall end', prio: 1 },
      { x: m[0], y: m[1], kind: 'mid', label: 'midpoint', prio: 2 },
    );
  }
  return out;
}

const clampTo = (v: number, max: number) => Math.min(max, Math.max(0, v));

/** Nearest point on segment p0–p1. */
function project(p0: [number, number], p1: [number, number], x: number, y: number): [number, number] {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - p0[0]) * dx + (y - p0[1]) * dy) / L2)) : 0;
  return [p0[0] + t * dx, p0[1] + t * dy];
}

/**
 * Snap a point inside the cavity for drawing a diagonal / curved wall: corners,
 * wall ends, midpoints and quarter points win when within tolerance, then lining
 * up with the other end (0° / 90°), then the nearest point on a cavity edge or a
 * wall; otherwise the point is rounded to the fine step. Shift (`constrain`)
 * keeps the angle from `from` in 15° steps instead; Alt (`free`) turns it all off.
 */
export function snapPoint(r: ResolvedLayout, x: number, y: number, o: PointSnapOptions): PointSnap {
  const { innerW: W, innerD: D } = r;
  const cx = clampTo(x, W);
  const cy = clampTo(y, D);
  if (o.free) return { x: cx, y: cy, kind: 'free', label: '' };
  const step = o.step > 0 ? o.step : 1;
  if (o.constrain && o.from) {
    const [fx, fy] = o.from;
    const deg = Math.round((Math.atan2(y - fy, x - fx) * 180) / Math.PI / 15) * 15;
    const a = (deg * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    let len = Math.max(0, Math.round(((x - fx) * ux + (y - fy) * uy) / step) * step);
    // Stay inside the cavity along the ray.
    for (const [u, f, max] of [
      [ux, fx, W],
      [uy, fy, D],
    ]) {
      if (u > 1e-9) len = Math.min(len, (max - f) / u);
      else if (u < -1e-9) len = Math.min(len, -f / u);
    }
    const norm = ((deg % 360) + 360) % 360;
    return { x: fx + ux * len, y: fy + uy * len, kind: 'angle', label: `${norm > 180 ? norm - 180 : norm}°` };
  }
  const tol = o.tolerance;
  let best: PointTarget | null = null;
  let bestScore = Infinity;
  for (const t of pointTargets(r, o.exclude)) {
    const d = Math.hypot(t.x - x, t.y - y);
    // Points are small targets: reach a little further for them than for lines.
    if (d > tol * 1.5) continue;
    const score = d + t.prio * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best) return { x: best.x, y: best.y, kind: best.kind, label: best.label };

  // Line up with the other end.
  let px = cx;
  let py = cy;
  let axis = '';
  if (o.from) {
    if (Math.abs(x - o.from[0]) <= tol && Math.abs(x - o.from[0]) <= Math.abs(y - o.from[1])) {
      px = o.from[0];
      axis = '90°';
    } else if (Math.abs(y - o.from[1]) <= tol) {
      py = o.from[1];
      axis = '0°';
    }
  }

  // Nearest point on a cavity edge or a wall's centerline.
  const lines: { p: [number, number][]; kind: PointSnapKind; label: string }[] = [
    { p: [[0, 0], [W, 0]], kind: 'edge', label: 'edge' },
    { p: [[W, 0], [W, D]], kind: 'edge', label: 'edge' },
    { p: [[0, D], [W, D]], kind: 'edge', label: 'edge' },
    { p: [[0, 0], [0, D]], kind: 'edge', label: 'edge' },
    ...r.walls.map((w) => ({
      p: (w.orient === 'v' ? [[w.pos, w.start], [w.pos, w.end]] : [[w.start, w.pos], [w.end, w.pos]]) as [number, number][],
      kind: 'on-wall' as const,
      label: 'on wall',
    })),
    ...r.free.filter((f) => f.id !== o.exclude).map((f) => ({ p: f.path, kind: 'on-wall' as const, label: 'on wall' })),
  ];
  let line: { x: number; y: number; d: number; kind: PointSnapKind; label: string } | null = null;
  for (const l of lines) {
    for (let i = 0; i + 1 < l.p.length; i++) {
      const [p0, p1] = [l.p[i], l.p[i + 1]];
      let q = project(p0, p1, x, y);
      // Keep the alignment when the line runs across it (where it crosses the segment).
      if (axis === '90°' && Math.abs(p1[0] - p0[0]) > 1e-9) q = [px, p0[1] + ((px - p0[0]) * (p1[1] - p0[1])) / (p1[0] - p0[0])];
      else if (axis === '0°' && Math.abs(p1[1] - p0[1]) > 1e-9) q = [p0[0] + ((py - p0[1]) * (p1[0] - p0[0])) / (p1[1] - p0[1]), py];
      const on = project(p0, p1, q[0], q[1]);
      if (Math.hypot(on[0] - q[0], on[1] - q[1]) > 1e-6) continue;
      const d = Math.hypot(q[0] - x, q[1] - y);
      if (d <= tol && (!line || d < line.d) && q[0] >= -1e-9 && q[0] <= W + 1e-9 && q[1] >= -1e-9 && q[1] <= D + 1e-9) {
        line = { x: q[0], y: q[1], d, kind: l.kind, label: axis ? `${l.label} · ${axis}` : l.label };
      }
    }
  }
  if (line) return { x: line.x, y: line.y, kind: line.kind, label: line.label };
  const round = (v: number) => Math.round(v / step) * step;
  if (axis) return { x: axis === '90°' ? px : clampTo(round(cx), W), y: axis === '0°' ? py : clampTo(round(cy), D), kind: 'axis', label: axis };
  return { x: clampTo(round(cx), W), y: clampTo(round(cy), D), kind: 'step', label: '' };
}

/** Length (along the centerline) and angle (0–180°, 0 = left to right) of a wall from a to b. */
export function freeWallMeasure(a: [number, number], b: [number, number], bend = 0) {
  const s = freeWallShape(a, b, bend);
  let deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  if (deg < 0) deg += 180;
  if (deg >= 180 - 1e-9) deg -= 180;
  return { length: s.length, chord: Math.hypot(b[0] - a[0], b[1] - a[1]), angle: deg, radius: s.arc?.r ?? null };
}
