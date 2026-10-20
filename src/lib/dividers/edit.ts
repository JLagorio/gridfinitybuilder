/**
 * Layout edits. Every function is pure: it takes a layout plus the cavity size
 * (positions matter for re-referencing) and returns a new layout. Compartment
 * options follow their compartments through splits and merges (carryOptions).
 */
import {
  acrossSize,
  compartmentAt,
  compartmentByKey,
  covers,
  dependents,
  dependsOn,
  edgeCenter,
  neighborsAt,
  rayEnds,
  resolveLayout,
  type Side,
} from './resolve';
import {
  EDGE,
  MIN_GAP,
  T,
  type CompartmentOptions,
  type DividerLayout,
  type DividerWall,
  type Orient,
  type Ref,
  type ResolvedLayout,
} from './types';

/** Inner cavity size (mm). */
export interface InnerSize {
  w: number;
  d: number;
}

/** How a position was chosen; decides how it's stored. */
export interface PlaceHow {
  kind: 'fraction' | 'bin-fraction' | 'align' | 'cell' | 'step' | 'free';
  /** Fraction for 'fraction' (of lo..hi) and 'bin-fraction' (of the whole cavity). */
  t?: number;
  /** Span the fraction refers to (for 'fraction'). */
  loRef?: Ref;
  hiRef?: Ref;
}

export const resolveIn = (l: DividerLayout | null | undefined, s: InnerSize) => resolveLayout(l, s.w, s.d);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function withWalls(l: DividerLayout, walls: DividerWall[], comps = l.comps): DividerLayout {
  const out: DividerLayout = { walls };
  if (comps && Object.keys(comps).length) out.comps = comps;
  return out;
}

/** Explicit layout equivalent to a uniform divX × divY split (deterministic ids x1…, y1…). */
export function uniformLayout(divX: number, divY: number): DividerLayout {
  const walls: DividerWall[] = [];
  const nx = Math.max(1, Math.min(12, Math.round(divX) || 1));
  const ny = Math.max(1, Math.min(12, Math.round(divY) || 1));
  for (let k = 1; k < nx; k++) {
    walls.push({ id: `x${k}`, orient: 'v', lo: k === 1 ? EDGE : `x${k - 1}`, hi: EDGE, pos: { kind: 'ratio', t: 1 / (nx - k + 1) }, start: EDGE, end: EDGE });
  }
  for (let k = 1; k < ny; k++) {
    walls.push({ id: `y${k}`, orient: 'h', lo: k === 1 ? EDGE : `y${k - 1}`, hi: EDGE, pos: { kind: 'ratio', t: 1 / (ny - k + 1) }, start: EDGE, end: EDGE });
  }
  return { walls };
}

/** Next free id of the form w1, w2, … (deterministic, so identical edits give identical layouts). */
export function newWallId(l: DividerLayout, taken: string[] = []): string {
  let n = 0;
  for (const w of [...l.walls.map((x) => x.id), ...taken]) {
    const m = /^w(\d+)$/.exec(w);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `w${n + 1}`;
}

/**
 * Re-point a wall at new references without moving it (at centerline `p`).
 * Exact walls stay exact, measured from the same side.
 */
export function rebase(w: DividerWall, p: number, lo: Side, hi: Side, keepExact = true): DividerWall {
  if (w.pos.kind === 'exact' && keepExact) {
    const from = w.pos.from;
    const mm = from === 'lo' ? p - lo.pos - T : hi.pos - p - T;
    return { ...w, lo: lo.ref, hi: hi.ref, pos: { kind: 'exact', mm: Math.max(0, mm), from } };
  }
  const span = hi.pos - lo.pos;
  return { ...w, lo: lo.ref, hi: hi.ref, pos: { kind: 'ratio', t: span > 0 ? clamp((p - lo.pos) / span, 0, 1) : 0.5 } };
}

/** Position fields for a wall placed at `p` between `nb`, per how it was snapped. */
function positionFor(
  w: DividerWall,
  p: number,
  nb: { lo: Side; hi: Side },
  how: PlaceHow | undefined,
): DividerWall {
  if (how?.kind === 'bin-fraction' && how.t !== undefined) return { ...w, lo: EDGE, hi: EDGE, pos: { kind: 'ratio', t: how.t } };
  if (how?.kind === 'cell') {
    // Cell seams sit at fixed mm from the left/front edge: keep them there if the bin is resized.
    return { ...w, lo: EDGE, hi: nb.hi.ref, pos: { kind: 'exact', mm: Math.max(0, p - T / 2), from: 'lo' } };
  }
  if (how?.kind === 'fraction' && how.t !== undefined && how.loRef === nb.lo.ref && how.hiRef === nb.hi.ref) {
    return { ...w, lo: nb.lo.ref, hi: nb.hi.ref, pos: { kind: 'ratio', t: how.t } };
  }
  return rebase(w, p, nb.lo, nb.hi, w.pos.kind === 'exact');
}

/**
 * Move compartment options to the compartments of `next`: same key → kept;
 * merged compartments take the options of the largest old compartment inside
 * them; split compartments give both halves the parent's options. Options of
 * compartments that no longer exist are dropped.
 */
export function carryOptions(prev: DividerLayout | null | undefined, next: DividerLayout, size: InnerSize): DividerLayout {
  const comps = next.comps ?? {};
  if (!Object.keys(comps).length) return withWalls(next, next.walls, undefined);
  const r0 = resolveIn(prev ?? { walls: [] }, size);
  const r1 = resolveIn(next, size);
  const out: Record<string, CompartmentOptions> = {};
  for (const c of r1.compartments) if (comps[c.key]) out[c.key] = comps[c.key];
  const olds = r0.compartments.filter((c) => comps[c.key] && !out[c.key]).sort((a, b) => b.area - a.area);
  for (const oc of olds) {
    const nc = compartmentAt(r1, oc.point[0], oc.point[1]);
    if (nc && !out[nc.key]) out[nc.key] = comps[oc.key];
  }
  for (const c of r1.compartments) {
    if (out[c.key]) continue;
    const oc = compartmentAt(r0, c.point[0], c.point[1]);
    if (oc && comps[oc.key]) out[c.key] = comps[oc.key];
  }
  return withWalls(next, next.walls, out);
}

export function addWall(l: DividerLayout, size: InnerSize, w: DividerWall): DividerLayout {
  return carryOptions(l, withWalls(l, [...l.walls, w]), size);
}

/** A new wall at centerline `p` between neighbors `nb`, ending at `start`/`end`. */
export function makeWall(
  l: DividerLayout,
  orient: Orient,
  p: number,
  nb: { lo: Side; hi: Side },
  ends: { start: Ref; end: Ref },
  how?: PlaceHow,
): DividerWall {
  const base: DividerWall = { id: newWallId(l), orient, lo: nb.lo.ref, hi: nb.hi.ref, pos: { kind: 'ratio', t: 0.5 }, start: ends.start, end: ends.end };
  return positionFor(base, p, nb, how);
}

/** Rewrite `xId`'s references so it no longer depends on any of `avoid` (it doesn't move). */
export function detach(l: DividerLayout, size: InnerSize, xId: string, avoid: string[]): DividerLayout {
  const r = resolveIn(l, size);
  const X = r.byId.get(xId);
  if (!X) return l;
  const bad = new Set<string>([xId, ...avoid, ...dependents(l, xId)]);
  for (const a of avoid) for (const d of dependents(l, a)) bad.add(d);
  const nb = neighborsAt(r, X.orient, X.pos, (X.start + X.end) / 2, bad);
  return withWalls(
    l,
    l.walls.map((w) => (w.id === xId ? rebase(w, X.pos, nb.lo, nb.hi) : w)),
  );
}

/**
 * Commit a wall at centerline `p` (after a drag). Its references become its
 * current neighbors, except walls that depend on it (they move with it).
 */
export function moveWall(l: DividerLayout, size: InnerSize, id: string, p: number, how?: PlaceHow): DividerLayout {
  const r = resolveIn(l, size);
  const R = r.byId.get(id);
  const src = l.walls.find((w) => w.id === id);
  if (!R || !src) return l;
  const skip = dependents(l, id);
  skip.add(id);
  const nb = neighborsAt(r, R.orient, p, (R.start + R.end) / 2, skip);
  const moved = positionFor(src, p, nb, how);
  return carryOptions(l, withWalls(l, l.walls.map((w) => (w.id === id ? moved : w))), size);
}

/** Current clear gaps on each side of a wall (at its mid-run). */
export function wallGaps(r: ResolvedLayout, id: string) {
  const W = r.byId.get(id);
  if (!W) return null;
  const run = (W.start + W.end) / 2;
  const nb = neighborsAt(r, W.orient, W.pos, run, new Set([id]));
  return { ...nb, run, loGap: W.pos - nb.lo.pos - T, hiGap: nb.hi.pos - W.pos - T };
}

/**
 * Make a wall exact: `mm` clear between it and its neighbor on `side`
 * (as measured by wallGaps). If that neighbor currently follows this wall, it's
 * detached first so the typed gap really holds.
 */
export function setWallGap(l: DividerLayout, size: InnerSize, id: string, side: 'lo' | 'hi', mm: number): DividerLayout {
  let r = resolveIn(l, size);
  const g = wallGaps(r, id);
  if (!g) return l;
  const N = g[side];
  let cur = l;
  if (N.ref !== EDGE && dependsOn(cur, N.ref, id)) {
    cur = detach(cur, size, N.ref, [id]);
    r = resolveIn(cur, size);
  }
  const W = r.byId.get(id)!;
  const skip = dependents(cur, id);
  skip.add(id);
  const safe = neighborsAt(r, W.orient, W.pos, g.run, skip);
  const lo = side === 'lo' ? N : safe.lo;
  const hi = side === 'hi' ? N : safe.hi;
  const inner = acrossSize(W.orient, size.w, size.d);
  const v = clamp(mm, MIN_GAP, Math.max(MIN_GAP, inner));
  const walls = cur.walls.map((w) => (w.id === id ? { ...w, lo: lo.ref, hi: hi.ref, pos: { kind: 'exact' as const, mm: v, from: side } } : w));
  return carryOptions(l, withWalls(cur, walls), size);
}

/** Drop the exact measurement and keep the wall where it is as a ratio of its neighbors. */
export function makeRatio(l: DividerLayout, size: InnerSize, id: string): DividerLayout {
  const r = resolveIn(l, size);
  const R = r.byId.get(id);
  if (!R) return l;
  return withWalls(
    l,
    l.walls.map((w) => (w.id === id ? rebase(w, R.pos, { ref: w.lo, pos: R.loPos }, { ref: w.hi, pos: R.hiPos }, false) : w)),
  );
}

export function setWallProps(l: DividerLayout, id: string, patch: { lower?: number; removable?: boolean }): DividerLayout {
  return withWalls(
    l,
    l.walls.map((w) => {
      if (w.id !== id) return w;
      const out: DividerWall = { ...w };
      if (patch.lower !== undefined) {
        if (patch.lower > 0) out.lower = patch.lower;
        else delete out.lower;
      }
      if (patch.removable !== undefined) {
        if (patch.removable) out.removable = true;
        else delete out.removable;
      }
      return out;
    }),
  );
}

/** Re-attach one end of a wall. Returns null if the wall would become degenerate. */
export function setWallEnd(l: DividerLayout, size: InnerSize, id: string, which: 'start' | 'end', ref: Ref): DividerLayout | null {
  const next = withWalls(
    l,
    l.walls.map((w) => (w.id === id ? { ...w, [which]: ref } : w)),
  );
  if (!resolveIn(next, size).byId.has(id)) return null;
  return carryOptions(l, next, size);
}

/**
 * Delete a wall. Walls positioned relative to it are re-referenced (they stay
 * put); walls that ended on it run on to the next wall beyond it (or the edge).
 * Walls that end up exactly on top of each other are merged.
 */
export function removeWall(l: DividerLayout, size: InnerSize, id: string): DividerLayout {
  const src = l.walls.find((w) => w.id === id);
  if (!src) return l;
  const r = resolveIn(l, size);
  const X = r.byId.get(id);
  const inner = (o: Orient) => acrossSize(o, size.w, size.d);
  const xSide = (side: 'lo' | 'hi'): Side => ({
    ref: src[side],
    pos: X ? (side === 'lo' ? X.loPos : X.hiPos) : edgeCenter(side, inner(src.orient)),
  });
  let walls = l.walls
    .filter((w) => w.id !== id)
    .map((w) => {
      let out = w;
      const R = r.byId.get(w.id);
      if (w.lo === id || w.hi === id) {
        if (R) {
          const lo = w.lo === id ? xSide('lo') : { ref: w.lo, pos: R.loPos };
          const hi = w.hi === id ? xSide('hi') : { ref: w.hi, pos: R.hiPos };
          out = rebase(out, R.pos, lo, hi);
        } else out = { ...out, lo: w.lo === id ? src.lo : w.lo, hi: w.hi === id ? src.hi : w.hi };
      }
      if (w.start === id || w.end === id) {
        let start = w.start === id ? EDGE : w.start;
        let end = w.end === id ? EDGE : w.end;
        if (R && X) {
          const beyond = rayEnds(r, R.orient, R.pos, X.pos, new Set([id]));
          if (w.start === id) start = beyond.start.ref;
          if (w.end === id) end = beyond.end.ref;
        }
        out = { ...out, start, end };
      }
      return out;
    });
  walls = mergeDuplicates({ walls }, size).walls;
  return carryOptions(l, withWalls(l, walls), size);
}

/** Remove walls that coincide with an earlier wall (same line, same extent), redirecting references. */
function mergeDuplicates(l: DividerLayout, size: InnerSize): DividerLayout {
  const r = resolveIn(l, size);
  const redirect = new Map<string, string>();
  const ws = r.walls;
  for (let a = 0; a < ws.length; a++) {
    if (redirect.has(ws[a].id)) continue;
    for (let b = a + 1; b < ws.length; b++) {
      const A = ws[a];
      const B = ws[b];
      if (redirect.has(B.id) || A.orient !== B.orient) continue;
      if (Math.abs(A.pos - B.pos) < 0.01 && Math.abs(A.start - B.start) < 0.01 && Math.abs(A.end - B.end) < 0.01) redirect.set(B.id, A.id);
    }
  }
  if (!redirect.size) return l;
  const fix = (ref: Ref, self: string) => {
    const t = redirect.get(ref) ?? ref;
    return t === self ? EDGE : t;
  };
  return {
    ...l,
    walls: l.walls
      .filter((w) => !redirect.has(w.id))
      .map((w) => ({ ...w, lo: fix(w.lo, w.id), hi: fix(w.hi, w.id), start: fix(w.start, w.id), end: fix(w.end, w.id) })),
  };
}

export function setCompartmentOptions(l: DividerLayout, key: string, patch: Partial<Record<keyof CompartmentOptions, unknown>>): DividerLayout {
  const cur: CompartmentOptions = { ...(l.comps?.[key] ?? {}) };
  for (const [k, v] of Object.entries(patch) as [keyof CompartmentOptions, unknown][]) {
    if (v === undefined || v === null) delete cur[k];
    else (cur as Record<string, unknown>)[k] = v;
  }
  const comps = { ...(l.comps ?? {}) };
  if (Object.keys(cur).length) comps[key] = cur;
  else delete comps[key];
  return withWalls(l, l.walls, comps);
}

// ---------------------------------------------------------------------------
// Auto-divide
// ---------------------------------------------------------------------------

export type SplitResult = { layout: DividerLayout; added: string[]; error?: undefined } | { error: string; layout?: undefined };

/** "1:2:1" → [1, 2, 1]. Null unless 2–24 positive numbers. */
export function parseRatio(s: string): number[] | null {
  const parts = s
    .trim()
    .split(/[\s:,/]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 2 || parts.length > 24 || parts.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  return parts;
}

/** The compartment to split: the given key, or the only compartment when there is just one. */
function targetCompartment(r: ResolvedLayout, key: string | null | undefined) {
  return compartmentByKey(r, key) ?? (r.compartments.length === 1 ? r.compartments[0] : null);
}

/** Span (centerlines of the bounding walls) of a compartment across `orient`, at its interior point. */
export function compartmentSpan(r: ResolvedLayout, key: string | null | undefined, orient: Orient) {
  const C = targetCompartment(r, key);
  if (!C) return null;
  const [px, py] = C.point;
  const across = orient === 'v' ? px : py;
  const run = orient === 'v' ? py : px;
  const nb = neighborsAt(r, orient, across, run);
  return { C, run, ...nb, span: nb.hi.pos - nb.lo.pos };
}

/**
 * Split a compartment into parts with the given relative sizes, with walls of
 * `orient` ('v' → columns, 'h' → rows). Sizes are centerline pitches, so equal
 * weights give equal compartments.
 */
export function splitCompartment(
  l: DividerLayout,
  size: InnerSize,
  key: string | null | undefined,
  orient: Orient,
  weights: number[],
): SplitResult {
  const r = resolveIn(l, size);
  const sp = compartmentSpan(r, key, orient);
  if (!sp) return { error: 'Select a compartment first.' };
  if (weights.length < 2) return { error: 'Need at least two parts.' };
  const total = weights.reduce((a, b) => a + b, 0);
  if (weights.some((wt) => (wt / total) * sp.span - T < MIN_GAP - 1e-6)) return { error: 'Too small for that many compartments.' };
  const walls = [...l.walls];
  const added: string[] = [];
  let f = 0;
  let prev: Side = sp.lo;
  for (let k = 0; k < weights.length - 1; k++) {
    const fk = f + weights[k] / total;
    const p = sp.lo.pos + fk * sp.span;
    const ends = rayEnds(r, orient, p, sp.run);
    const id = newWallId({ walls });
    walls.push({ id, orient, lo: prev.ref, hi: sp.hi.ref, pos: { kind: 'ratio', t: (fk - f) / (1 - f) }, start: ends.start.ref, end: ends.end.ref });
    added.push(id);
    prev = { ref: id, pos: p };
    f = fk;
  }
  return { layout: carryOptions(l, withWalls(l, walls), size), added };
}

/** How many compartments of at least `min` mm clear fit in a centerline span. */
export function countForMinSize(span: number, min: number): number {
  if (!(min > 0)) return 1;
  return Math.max(1, Math.floor(span / (min + T) + 1e-9));
}

/** As many equal compartments as fit with each at least `min` mm clear. */
export function splitByMinSize(
  l: DividerLayout,
  size: InnerSize,
  key: string | null | undefined,
  orient: Orient,
  min: number,
): SplitResult {
  const sp = compartmentSpan(resolveIn(l, size), key, orient);
  if (!sp) return { error: 'Select a compartment first.' };
  const n = countForMinSize(sp.span, Math.max(min, MIN_GAP));
  if (n < 2) return { error: `Only one compartment of ${Math.round(min * 10) / 10} mm fits.` };
  return splitCompartment(l, size, key, orient, Array(n).fill(1));
}

/**
 * Space a wall and its siblings (the run of parallel walls next to it with the
 * same extent, along a line through its middle) evenly between the walls or
 * edges on either side of the run.
 */
export function distributeEvenly(l: DividerLayout, size: InnerSize, id: string): DividerLayout {
  let r = resolveIn(l, size);
  const W = r.byId.get(id);
  if (!W) return l;
  const m = (W.start + W.end) / 2;
  const line = r.walls.filter((w) => w.orient === W.orient && covers(w, m)).sort((a, b) => a.pos - b.pos);
  const at = line.findIndex((w) => w.id === id);
  const same = (k: number) => Math.abs(line[k].start - W.start) < 0.01 && Math.abs(line[k].end - W.end) < 0.01;
  let a = at;
  let b = at;
  while (a > 0 && same(a - 1)) a--;
  while (b < line.length - 1 && same(b + 1)) b++;
  const sibs = line.slice(a, b + 1).map((w) => w.id);
  let cur = l;
  let loRef: Ref = a > 0 ? line[a - 1].id : EDGE;
  let hiRef: Ref = b < line.length - 1 ? line[b + 1].id : EDGE;
  for (const bound of [loRef, hiRef]) {
    if (bound !== EDGE && sibs.some((s) => dependsOn(cur, bound, s))) cur = detach(cur, size, bound, sibs);
  }
  r = resolveIn(cur, size);
  if (loRef !== EDGE && !r.byId.has(loRef)) loRef = EDGE;
  if (hiRef !== EDGE && !r.byId.has(hiRef)) hiRef = EDGE;
  const n = sibs.length;
  const walls = cur.walls.map((w) => {
    const k = sibs.indexOf(w.id);
    if (k < 0) return w;
    return { ...w, lo: k === 0 ? loRef : sibs[k - 1], hi: hiRef, pos: { kind: 'ratio' as const, t: 1 / (n + 1 - k) } };
  });
  return carryOptions(l, withWalls(cur, walls), size);
}
