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
  MIN_FREE_WALL,
  MIN_GAP,
  MIN_WALL,
  T,
  type CompRect,
  type ResolvedFreeWall,
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
    free: resolveFreeWalls(layout, innerW, innerD),
  };
}

// ---------------------------------------------------------------------------
// Diagonal / curved walls
// ---------------------------------------------------------------------------

type P2 = [number, number];

/** Degrees per centerline segment of a curved wall. */
const ARC_STEP = (4 * Math.PI) / 180;

/**
 * Centerline of a wall from `a` to `b` (cavity mm) bent into a circular arc
 * with sagitta `bend` (positive bulges to the left of a → b), clamped to a half
 * circle.
 */
export function freeWallShape(a: P2, b: P2, bend = 0): Pick<ResolvedFreeWall, 'bend' | 'path' | 'length' | 'arc'> {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const c = Math.hypot(dx, dy);
  const s = c > 0 ? clamp(Number(bend) || 0, -c / 2, c / 2) : 0;
  if (Math.abs(s) < 0.01 || c < EPS) return { bend: 0, path: [a, b], length: c };
  const nx = -dy / c;
  const ny = dx / c;
  const R = (c * c) / 4 / (2 * Math.abs(s)) + Math.abs(s) / 2;
  const k = s - Math.sign(s) * R;
  const cx = (a[0] + b[0]) / 2 + nx * k;
  const cy = (a[1] + b[1]) / 2 + ny * k;
  const a0 = Math.atan2(a[1] - cy, a[0] - cx);
  const theta = 2 * Math.asin(Math.min(1, c / (2 * R)));
  // Bulging left of a → b runs clockwise around the center.
  const sweep = s > 0 ? -theta : theta;
  // An even count puts a vertex on the apex.
  const n = Math.max(6, 2 * Math.ceil(theta / (2 * ARC_STEP)));
  const path: P2[] = [a];
  for (let i = 1; i < n; i++) {
    const t = a0 + (sweep * i) / n;
    path.push([cx + R * Math.cos(t), cy + R * Math.sin(t)]);
  }
  path.push(b);
  return { bend: s, path, length: R * theta, arc: { cx, cy, r: R, a0, a1: a0 + sweep } };
}

/** Diagonal / curved walls in cavity mm. Bad or too-short ones are left out. */
export function resolveFreeWalls(layout: DividerLayout | null | undefined, innerW: number, innerD: number): ResolvedFreeWall[] {
  const out: ResolvedFreeWall[] = [];
  const seen = new Set<string>();
  const frac = (v: unknown) => clamp(Number.isFinite(Number(v)) ? Number(v) : 0, 0, 1);
  for (const f of layout?.free ?? []) {
    if (!f || typeof f.id !== 'string' || seen.has(f.id) || !Array.isArray(f.a) || !Array.isArray(f.b)) continue;
    const a: P2 = [frac(f.a[0]) * innerW, frac(f.a[1]) * innerD];
    const b: P2 = [frac(f.b[0]) * innerW, frac(f.b[1]) * innerD];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_FREE_WALL) continue;
    seen.add(f.id);
    out.push({ id: f.id, a, b, lower: Math.max(0, Number(f.lower) || 0), ...freeWallShape(a, b, f.bend), wall: f });
  }
  return out;
}

/** Point on a free wall's centerline halfway along it (the apex of an arc). */
export function freeWallMid(f: Pick<ResolvedFreeWall, 'a' | 'b' | 'arc'>): P2 {
  if (!f.arc) return [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];
  const t = (f.arc.a0 + f.arc.a1) / 2;
  return [f.arc.cx + f.arc.r * Math.cos(t), f.arc.cy + f.arc.r * Math.sin(t)];
}

/**
 * Outline of a free wall `half` mm either side of its centerline, with round
 * ends, CCW. Straight walls give a stadium; bent ones are offset radially.
 */
export function freeWallOutline(f: Pick<ResolvedFreeWall, 'path' | 'arc'>, half = T / 2, capSegs = 8): P2[] {
  const p = f.path;
  const n = p.length;
  // Left normal of the direction of travel at each point.
  const normals: P2[] = p.map((q, i) => {
    if (f.arc) {
      const sweep = f.arc.a1 - f.arc.a0;
      const ux = (q[0] - f.arc.cx) / f.arc.r;
      const uy = (q[1] - f.arc.cy) / f.arc.r;
      return sweep > 0 ? [-ux, -uy] : [ux, uy];
    }
    const [q0, q1] = i < n - 1 ? [q, p[i + 1]] : [p[i - 1], q];
    const L = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) || 1;
    return [-(q1[1] - q0[1]) / L, (q1[0] - q0[0]) / L];
  });
  const out: P2[] = [];
  const cap = (c: P2, from: P2) => {
    const a0 = Math.atan2(from[1], from[0]);
    for (let k = 1; k < capSegs; k++) {
      const t = a0 + (Math.PI * k) / capSegs;
      out.push([c[0] + half * Math.cos(t), c[1] + half * Math.sin(t)]);
    }
  };
  for (let i = 0; i < n; i++) out.push([p[i][0] - half * normals[i][0], p[i][1] - half * normals[i][1]]);
  cap(p[n - 1], [-normals[n - 1][0], -normals[n - 1][1]]);
  for (let i = n - 1; i >= 0; i--) out.push([p[i][0] + half * normals[i][0], p[i][1] + half * normals[i][1]]);
  cap(p[0], normals[0]);
  return out;
}

/** Distance from a point to a polyline. */
export function distToPath(path: P2[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const [x0, y0] = path[i];
    const [x1, y1] = path[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? clamp(((x - x0) * dx + (y - y0) * dy) / L2, 0, 1) : 0;
    best = Math.min(best, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)));
  }
  return best;
}

/** The free wall under a point (within `tol` mm of its faces), nearest first. */
export function freeWallAt(r: ResolvedLayout, x: number, y: number, tol = 0): ResolvedFreeWall | null {
  let best: ResolvedFreeWall | null = null;
  let bestD = Infinity;
  for (const f of r.free) {
    const d = distToPath(f.path, x, y);
    if (d <= T / 2 + tol && d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Wall segments (finger notches and shaped tops)
// ---------------------------------------------------------------------------

export interface WallSpan {
  /** Clear run between the faces of the walls (or edges) at its ends (cavity mm, along the wall). */
  a: number;
  b: number;
  aEdge: boolean;
  bEdge: boolean;
}

/**
 * The parts of a straight wall's run between the perpendicular walls that cross
 * or meet it (on either side), face to face.
 */
export function wallSpans(r: ResolvedLayout, id: string): WallSpan[] {
  const W = r.byId.get(id);
  if (!W) return [];
  const runSize = acrossSize(other(W.orient), r.innerW, r.innerD);
  const blocks = r.walls
    .filter(
      (P) =>
        P.orient !== W.orient &&
        P.start <= W.pos + T / 2 + EPS &&
        P.end >= W.pos - T / 2 - EPS &&
        P.pos > W.start - T / 2 - EPS &&
        P.pos < W.end + T / 2 + EPS,
    )
    .map((P) => [P.pos - T / 2, P.pos + T / 2] as const)
    .sort((p, q) => p[0] - q[0]);
  const out: WallSpan[] = [];
  let at = W.start;
  const push = (a: number, b: number) => {
    if (b - a > 0.5) out.push({ a, b, aEdge: a <= EPS, bEdge: b >= runSize - EPS });
  };
  for (const [b0, b1] of blocks) {
    if (b0 > at) push(at, Math.min(b0, W.end));
    at = Math.max(at, b1);
  }
  if (W.end > at) push(at, W.end);
  return out;
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
