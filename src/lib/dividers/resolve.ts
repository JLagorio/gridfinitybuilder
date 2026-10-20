/**
 * Layout → concrete mm walls → compartments.
 *
 * Compartment identity: each compartment is keyed by the set of things bounding
 * it, as sorted tags — `^L ^R ^F ^B` for the cavity edges (left, right, front,
 * back), `<id><` / `<id>>` when it lies on the low / high side of a wall, and
 * `<id>.` when it touches a wall's end face. Moving walls, resizing the bin or
 * editing other compartments keeps the key; splitting or merging a compartment
 * changes it (edit.ts carries options across those).
 */
import {
  EDGE,
  MIN_GAP,
  MIN_WALL,
  T,
  type CompRect,
  type Compartment,
  type DividerLayout,
  type DividerWall,
  type Orient,
  type Rect,
  type Ref,
  type ResolvedLayout,
  type ResolvedWall,
} from './types';

const EPS = 1e-6;
/** Free regions thinner than this are left solid (slivers between near-coincident walls). */
const MIN_REGION = 1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const other = (o: Orient): Orient => (o === 'v' ? 'h' : 'v');

/** Centerline of the virtual divider standing in for a cavity edge. */
export function edgeCenter(side: 'lo' | 'hi', inner: number) {
  return side === 'lo' ? -T / 2 : inner + T / 2;
}

/** Cavity size across a wall of this orientation (x for 'v', y for 'h'). */
export function acrossSize(o: Orient, innerW: number, innerD: number) {
  return o === 'v' ? innerW : innerD;
}

function wellFormed(w: DividerWall | null | undefined): w is DividerWall {
  if (!w || typeof w.id !== 'string' || (w.orient !== 'v' && w.orient !== 'h') || !w.pos) return false;
  if (w.pos.kind === 'ratio') return Number.isFinite(w.pos.t);
  return w.pos.kind === 'exact' && Number.isFinite(w.pos.mm) && (w.pos.from === 'lo' || w.pos.from === 'hi');
}

/**
 * Resolve a layout to mm coordinates inside an innerW × innerD cavity.
 * Bad data degrades gracefully: unknown references fall back to the edge,
 * positions are clamped to keep MIN_GAP clear on each side of their references,
 * and walls that can't fit or end up shorter than MIN_WALL are dropped.
 */
export function resolveLayout(layout: DividerLayout | null | undefined, innerW: number, innerD: number): ResolvedLayout {
  const src = new Map<string, DividerWall>();
  for (const w of layout?.walls ?? []) if (wellFormed(w) && !src.has(w.id)) src.set(w.id, w);
  const walls = [...src.values()];
  const inner = (o: Orient) => acrossSize(o, innerW, innerD);

  const pos = new Map<string, number>();
  const refs = new Map<string, [number, number]>();
  const visiting = new Set<string>();
  const center = (ref: Ref, o: Orient, side: 'lo' | 'hi'): number => {
    const fallback = edgeCenter(side, inner(o));
    const w = ref === EDGE ? undefined : src.get(ref);
    if (!w || w.orient !== o) return fallback;
    const p = posOf(w);
    return Number.isFinite(p) ? p : fallback;
  };
  function posOf(w: DividerWall): number {
    const known = pos.get(w.id);
    if (known !== undefined) return known;
    if (visiting.has(w.id)) return NaN; // reference cycle: the caller falls back to the edge
    visiting.add(w.id);
    const lo = center(w.lo, w.orient, 'lo');
    const hi = center(w.hi, w.orient, 'hi');
    visiting.delete(w.id);
    let p =
      w.pos.kind === 'ratio' ? lo + w.pos.t * (hi - lo) : w.pos.from === 'lo' ? lo + T + w.pos.mm : hi - T - w.pos.mm;
    const min = lo + T + MIN_GAP;
    const max = hi - T - MIN_GAP;
    p = max + EPS < min ? NaN : clamp(p, min, Math.max(min, max));
    pos.set(w.id, p);
    refs.set(w.id, [lo, hi]);
    return p;
  }

  const valid = new Set(walls.filter((w) => Number.isFinite(posOf(w))).map((w) => w.id));
  const ext = new Map<string, [number, number]>();
  // Ends attach to walls that may themselves be dropped (too short); iterate until stable.
  for (let iter = 0; iter <= walls.length; iter++) {
    let changed = false;
    for (const w of walls) {
      if (!valid.has(w.id)) continue;
      const run = inner(other(w.orient));
      const endAt = (ref: Ref, side: 'lo' | 'hi') => {
        const r = ref === EDGE ? undefined : src.get(ref);
        if (r && r.orient !== w.orient && valid.has(r.id)) return clamp(pos.get(r.id)!, 0, run);
        return side === 'lo' ? 0 : run;
      };
      const s = endAt(w.start, 'lo');
      const e = endAt(w.end, 'hi');
      if (e - s < MIN_WALL) {
        valid.delete(w.id);
        changed = true;
      } else ext.set(w.id, [s, e]);
    }
    if (!changed) break;
  }

  // An end stops at the centerline of the wall it attaches to. Where that wall
  // doesn't itself cover the junction (an L corner: both walls end on each
  // other), run on to its far face so the corner is closed.
  const reach = new Map<string, [number, number]>();
  for (const w of walls) {
    if (!valid.has(w.id)) continue;
    let [s, e] = ext.get(w.id)!;
    const p = pos.get(w.id)!;
    const open = (ref: Ref) => {
      const r = src.get(ref);
      if (!r || r.orient === w.orient || !valid.has(r.id)) return false;
      const [rs, re] = ext.get(r.id)!;
      return rs > p - T / 2 + EPS || re < p + T / 2 - EPS;
    };
    if (open(w.start)) s = Math.max(0, s - T / 2);
    if (open(w.end)) e = Math.min(inner(other(w.orient)), e + T / 2);
    reach.set(w.id, [s, e]);
  }

  const out: ResolvedWall[] = [];
  for (const w of walls) {
    if (!valid.has(w.id)) continue;
    const [start, end] = reach.get(w.id)!;
    const [loPos, hiPos] = refs.get(w.id)!;
    out.push({
      id: w.id,
      orient: w.orient,
      pos: pos.get(w.id)!,
      start,
      end,
      loPos,
      hiPos,
      lower: Math.max(0, Number(w.lower) || 0),
      removable: !!w.removable,
      wall: w,
    });
  }
  return {
    innerW,
    innerD,
    walls: out,
    byId: new Map(out.map((w) => [w.id, w])),
    compartments: deriveCompartments(innerW, innerD, out),
    dropped: walls.filter((w) => !valid.has(w.id)).map((w) => w.id),
  };
}

/** Footprint of a wall in cavity mm. */
export function wallRect(w: ResolvedWall): Rect {
  return w.orient === 'v'
    ? { x0: w.pos - T / 2, x1: w.pos + T / 2, y0: w.start, y1: w.end }
    : { x0: w.start, x1: w.end, y0: w.pos - T / 2, y1: w.pos + T / 2 };
}

function breaks(vals: number[], max: number): number[] {
  const a = vals.filter((v) => v > EPS && v < max - EPS).sort((p, q) => p - q);
  const out = [0];
  for (const v of a) if (v - out[out.length - 1] > 1e-6) out.push(v);
  if (max - out[out.length - 1] > 1e-6) out.push(max);
  else out[out.length - 1] = max;
  return out;
}

/**
 * Free regions of the cavity between walls, by flood fill over a
 * coordinate-compressed grid. `solid` picks which walls count (the geometry
 * code uses it to find the merged space above lowered walls).
 */
export function deriveCompartments(
  innerW: number,
  innerD: number,
  walls: ResolvedWall[],
  solid: (w: ResolvedWall) => boolean = () => true,
): Compartment[] {
  if (!(innerW > 0 && innerD > 0)) return [];
  const ws = walls.filter(solid);
  const xs = breaks(ws.flatMap((w) => (w.orient === 'v' ? [w.pos - T / 2, w.pos + T / 2] : [w.start, w.end])), innerW);
  const ys = breaks(ws.flatMap((w) => (w.orient === 'h' ? [w.pos - T / 2, w.pos + T / 2] : [w.start, w.end])), innerD);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const idx = (i: number, j: number) => j * nx + i;
  const cover: (number[] | undefined)[] = new Array(nx * ny);
  const mid = (a: number[], k: number) => (a[k] + a[k + 1]) / 2;
  ws.forEach((w, k) => {
    const r = wallRect(w);
    const I: number[] = [];
    const J: number[] = [];
    for (let i = 0; i < nx; i++) if (mid(xs, i) > r.x0 && mid(xs, i) < r.x1) I.push(i);
    for (let j = 0; j < ny; j++) if (mid(ys, j) > r.y0 && mid(ys, j) < r.y1) J.push(j);
    for (const i of I) for (const j of J) (cover[idx(i, j)] ??= []).push(k);
  });

  // Flood fill the free cells.
  const region = new Int32Array(nx * ny).fill(-1);
  const regions: number[][] = [];
  for (let c = 0; c < nx * ny; c++) {
    if (cover[c] || region[c] !== -1) continue;
    const id = regions.length;
    const cells: number[] = [c];
    region[c] = id;
    for (let q = 0; q < cells.length; q++) {
      const cc = cells[q];
      const i = cc % nx;
      const j = (cc - i) / nx;
      for (const [di, dj] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const n = idx(ii, jj);
        if (cover[n] || region[n] !== -1) continue;
        region[n] = id;
        cells.push(n);
      }
    }
    regions.push(cells);
  }

  const out: Compartment[] = [];
  const keys = new Map<string, number>();
  regions.forEach((cells, rid) => {
    let bx0 = Infinity;
    let bx1 = -Infinity;
    let by0 = Infinity;
    let by1 = -Infinity;
    for (const c of cells) {
      const i = c % nx;
      const j = (c - i) / nx;
      bx0 = Math.min(bx0, xs[i]);
      bx1 = Math.max(bx1, xs[i + 1]);
      by0 = Math.min(by0, ys[j]);
      by1 = Math.max(by1, ys[j + 1]);
    }
    if (bx1 - bx0 < MIN_REGION || by1 - by0 < MIN_REGION) return;
    const inR = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && region[idx(i, j)] === rid;

    // Boundary tags.
    const tags = new Set<string>();
    const tagWalls = (n: number, prefer: Orient, side: string) => {
      const ks = cover[n];
      if (!ks) return;
      const pref = ks.filter((k) => ws[k].orient === prefer);
      for (const k of pref) tags.add(`${ws[k].id}${side}`);
      if (!pref.length) for (const k of ks) tags.add(`${ws[k].id}.`);
    };
    for (const c of cells) {
      const i = c % nx;
      const j = (c - i) / nx;
      if (i === 0) tags.add('^L');
      else if (!inR(i - 1, j)) tagWalls(idx(i - 1, j), 'v', '>');
      if (i === nx - 1) tags.add('^R');
      else if (!inR(i + 1, j)) tagWalls(idx(i + 1, j), 'v', '<');
      if (j === 0) tags.add('^F');
      else if (!inR(i, j - 1)) tagWalls(idx(i, j - 1), 'h', '>');
      if (j === ny - 1) tags.add('^B');
      else if (!inR(i, j + 1)) tagWalls(idx(i, j + 1), 'h', '<');
    }
    let key = [...tags].sort().join(',');
    const dup = keys.get(key) ?? 0;
    keys.set(key, dup + 1);
    if (dup) key += `#${dup + 1}`;

    // Rectangles: maximal runs per row, merged with identical runs in the next row.
    const done: [number, number, number, number][] = [];
    let open = new Map<string, [number, number, number, number]>();
    for (let j = 0; j < ny; j++) {
      const next = new Map<string, [number, number, number, number]>();
      for (let i = 0; i < nx; i++) {
        if (!inR(i, j)) continue;
        let i1 = i;
        while (inR(i1 + 1, j)) i1++;
        const k = `${i}:${i1}`;
        const prev = open.get(k);
        if (prev) {
          prev[3] = j;
          next.set(k, prev);
          open.delete(k);
        } else next.set(k, [i, i1, j, j]);
        i = i1;
      }
      done.push(...open.values());
      open = next;
    }
    done.push(...open.values());

    const rects: CompRect[] = done.map(([i0, i1, j0, j1]) => {
      let front = true;
      let back = true;
      let left = true;
      let right = true;
      let backLower = 0;
      for (let i = i0; i <= i1; i++) {
        if (inR(i, j0 - 1)) front = false;
        if (inR(i, j1 + 1)) back = false;
        else if (j1 + 1 < ny) {
          for (const k of cover[idx(i, j1 + 1)] ?? []) if (ws[k].orient === 'h') backLower = Math.max(backLower, ws[k].lower);
        }
      }
      for (let j = j0; j <= j1; j++) {
        if (inR(i0 - 1, j)) left = false;
        if (inR(i1 + 1, j)) right = false;
      }
      return {
        x0: xs[i0],
        x1: xs[i1 + 1],
        y0: ys[j0],
        y1: ys[j1 + 1],
        open: { front, back, left, right },
        convex: [
          !inR(i0 - 1, j0) && !inR(i0, j0 - 1),
          !inR(i1 + 1, j0) && !inR(i1, j0 - 1),
          !inR(i1 + 1, j1) && !inR(i1, j1 + 1),
          !inR(i0 - 1, j1) && !inR(i0, j1 + 1),
        ],
        backLower,
      };
    });
    rects.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const area = rects.reduce((t, r) => t + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
    const big = rects.reduce((a, b) => ((b.x1 - b.x0) * (b.y1 - b.y0) > (a.x1 - a.x0) * (a.y1 - a.y0) ? b : a));
    out.push({
      key,
      rects,
      bounds: { x0: bx0, y0: by0, x1: bx1, y1: by1 },
      area,
      isRect: rects.length === 1,
      point: [(big.x0 + big.x1) / 2, (big.y0 + big.y1) / 2],
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface Side {
  ref: Ref;
  /** Centerline (edges at −T/2 / inner + T/2 across; 0 / inner along a run). */
  pos: number;
}

/** Does the wall's run cover this coordinate? */
export function covers(w: ResolvedWall, run: number, eps = 1e-6) {
  return w.start - eps <= run && run <= w.end + eps;
}

/**
 * Nearest parallel walls (or edges) on each side of a point, looking across the
 * `orient` axis at run coordinate `run`.
 */
export function neighborsAt(
  r: ResolvedLayout,
  orient: Orient,
  across: number,
  run: number,
  exclude?: Set<string>,
): { lo: Side; hi: Side } {
  const inner = acrossSize(orient, r.innerW, r.innerD);
  const lo: Side = { ref: EDGE, pos: edgeCenter('lo', inner) };
  const hi: Side = { ref: EDGE, pos: edgeCenter('hi', inner) };
  for (const w of r.walls) {
    if (w.orient !== orient || exclude?.has(w.id) || !covers(w, run)) continue;
    if (w.pos < across - EPS && w.pos > lo.pos) {
      lo.ref = w.id;
      lo.pos = w.pos;
    }
    if (w.pos > across + EPS && w.pos < hi.pos) {
      hi.ref = w.id;
      hi.pos = w.pos;
    }
  }
  return { lo, hi };
}

/**
 * Where a wall of `orient` at `across` would end if it grew both ways from
 * `run`: the nearest perpendicular walls crossing its line, or the edges.
 */
export function rayEnds(
  r: ResolvedLayout,
  orient: Orient,
  across: number,
  run: number,
  exclude?: Set<string>,
): { start: Side; end: Side } {
  const runSize = acrossSize(other(orient), r.innerW, r.innerD);
  const start: Side = { ref: EDGE, pos: 0 };
  const end: Side = { ref: EDGE, pos: runSize };
  for (const w of r.walls) {
    if (w.orient === orient || exclude?.has(w.id) || !covers(w, across)) continue;
    if (w.pos < run && w.pos > start.pos) {
      start.ref = w.id;
      start.pos = w.pos;
    }
    if (w.pos > run && w.pos < end.pos) {
      end.ref = w.id;
      end.pos = w.pos;
    }
  }
  return { start, end };
}

const inRect = (r: Rect, x: number, y: number, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad;

/** The wall under a point (within `tol` mm of its footprint), nearest centerline first. */
export function wallAt(r: ResolvedLayout, x: number, y: number, tol = 0): ResolvedWall | null {
  let best: ResolvedWall | null = null;
  let bestD = Infinity;
  for (const w of r.walls) {
    if (!inRect(wallRect(w), x, y, tol)) continue;
    const d = Math.abs((w.orient === 'v' ? x : y) - w.pos);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

export function compartmentAt(r: ResolvedLayout, x: number, y: number): Compartment | null {
  for (const c of r.compartments) if (c.rects.some((rc) => inRect(rc, x, y))) return c;
  return null;
}

export function compartmentByKey(r: ResolvedLayout, key: string | null | undefined): Compartment | null {
  return (key && r.compartments.find((c) => c.key === key)) || null;
}

/** Does wall `a`'s position depend (through lo/hi references) on wall `b`? */
export function dependsOn(layout: DividerLayout, a: string, b: string): boolean {
  const byId = new Map(layout.walls.map((w) => [w.id, w]));
  const seen = new Set<string>();
  const stack = [a];
  while (stack.length) {
    const w = byId.get(stack.pop()!);
    if (!w) continue;
    for (const ref of [w.lo, w.hi]) {
      if (ref === b) return true;
      if (ref !== EDGE && !seen.has(ref)) {
        seen.add(ref);
        stack.push(ref);
      }
    }
  }
  return false;
}

/** Every wall whose position depends on `id` (they move when it moves). */
export function dependents(layout: DividerLayout, id: string): Set<string> {
  const out = new Set<string>();
  for (const w of layout.walls) if (w.id !== id && dependsOn(layout, w.id, id)) out.add(w.id);
  return out;
}

/** Clear gap (mm) between two centerlines with a divider on each. */
export const clearGap = (loPos: number, hiPos: number) => hiPos - loPos - T;

export { EPS as RESOLVE_EPS, MIN_GAP };
