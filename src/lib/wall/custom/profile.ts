/**
 * The custom attachment's side profile (kinds/custom.ts): the part seen from its left side, z out from the board
 * and y up, in mm, extruded across its width in front of a back plate (z 0 to `CUSTOM.plate`, y 0 to its height).
 * Plain TypeScript, shared by planning, the geometry (kinds/custom.geom.ts) and the editor
 * (components/ProfileEditor.tsx).
 *
 * What keeps anything drawn here hanging on the board and printing without supports:
 * - one simple polygon (no edge crosses another), at most 40 points, inside 200 × 200 mm, never behind the board;
 * - joined to the back plate: it reaches into it along 3 mm or more;
 * - walls 1.6 mm thick or more (four lines of a 0.4 mm nozzle): thinner ones are flagged;
 * - printed upright (as it hangs), every edge that faces down is 45° or steeper unless it lies on the bed (y = 0);
 *   printed on its side the profile lies flat on the bed and any shape prints.
 * Features (holes, slots, text) go on its flat faces: the profile's edges and the plate's front where it's free.
 */
import type { Vec2 } from '../../geometry/kernel';

export const CUSTOM = {
  /** Back plate thickness. */
  plate: 4,
  /** Thinnest wall. */
  wall: 1.6,
  /** Most points in a profile, most features. */
  points: 40,
  features: 12,
  /** Furthest out from the board, highest. */
  reach: 200,
  tall: 200,
  /** Least length along which the profile reaches into the plate. */
  attach: 3,
  /** Least length of a face that takes features. */
  face: 4,
  /** End walls, dividers, gussets and the front lip: their thickness; a gusset between the ends every so far. */
  end: 2,
  divider: 1.6,
  gusset: 3,
  lip: 2.4,
  gussetEvery: 150,
} as const;

export const FEATURE_KINDS = ['round', 'slot', 'rect', 'hex', 'notch', 'text'] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

/**
 * Holes, slots, text… on a face: one, or a row or grid of them. Short keys keep share links short.
 */
export interface Feature {
  /** Its face: a profile edge (from point `f` to the next), or -1 for the back plate's front. */
  f: number;
  k: FeatureKind;
  /** Size across (x) and along the face, mm: a round hole's diameter and a hex hole's size across flats are `a`; text's width and letter height. */
  a: number;
  b: number;
  /** How deep, mm; 0: through the wall (text: 0.6 mm in). */
  d: number;
  /** Where the middle of the group is, from the face's middle: across and along it, mm. */
  u: number;
  v: number;
  /** How many across and along, centre to centre how far apart, mm. */
  n: number;
  m: number;
  su: number;
  sv: number;
  /** Its text. */
  t?: string;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const crossO = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const next = <T>(p: T[], i: number) => p[(i + 1) % p.length];

/** Signed area (z right, y up): positive anticlockwise. */
export function signedArea(p: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) a += p[i][0] * next(p as Vec2[], i)[1] - next(p as Vec2[], i)[0] * p[i][1];
  return a / 2;
}

/** Whether closed segments ab and cd meet. */
function meet(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const e = 1e-7;
  const o1 = crossO(a, b, c);
  const o2 = crossO(a, b, d);
  const o3 = crossO(c, d, a);
  const o4 = crossO(c, d, b);
  if (((o1 > e && o2 < -e) || (o1 < -e && o2 > e)) && ((o3 > e && o4 < -e) || (o3 < -e && o4 > e))) return true;
  const on = (p: Vec2, q: Vec2, r: Vec2) =>
    Math.min(p[0], q[0]) - e <= r[0] && r[0] <= Math.max(p[0], q[0]) + e && Math.min(p[1], q[1]) - e <= r[1] && r[1] <= Math.max(p[1], q[1]) + e;
  return (Math.abs(o1) <= e && on(a, b, c)) || (Math.abs(o2) <= e && on(a, b, d)) || (Math.abs(o3) <= e && on(c, d, a)) || (Math.abs(o4) <= e && on(c, d, b));
}

/** Whether any edge crosses or touches another (but its neighbours, where they meet), or doubles back on itself. */
export function selfCrossing(p: readonly Vec2[]): boolean {
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    // Doubling back: the next edge runs back along this one.
    const c = p[(i + 2) % n];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    if (Math.abs(ux * vy - uy * vx) <= 1e-9 * Math.hypot(ux, uy) * Math.hypot(vx, vy) && ux * vx + uy * vy < 0) return true;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (meet(a, b, p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Whether a point is inside a polygon (even-odd). */
export function insidePolygon(p: readonly Vec2[], q: Vec2): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [zi, yi] = p[i];
    const [zj, yj] = p[j];
    if (yi > q[1] !== yj > q[1] && q[0] < ((zj - zi) * (q[1] - yi)) / (yj - yi) + zi) c = !c;
  }
  return c;
}

/** Where a vertical line at `z` is inside the profile: y intervals, bottom up. */
export function spanAt(p: readonly Vec2[], z: number): [number, number][] {
  const ys: number[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = next(p as Vec2[], i);
    if (a[0] <= z !== b[0] <= z) ys.push(a[1] + ((z - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
  }
  ys.sort((s, t) => s - t);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k], ys[k + 1]]);
  return out;
}

/** The profile's bottom and top at `z` (null where it isn't). */
export function lowerAt(p: readonly Vec2[], z: number): number | null {
  const s = spanAt(p, z);
  return s.length ? s[0][0] : null;
}
export function upperAt(p: readonly Vec2[], z: number): number | null {
  const s = spanAt(p, z);
  return s.length ? s[s.length - 1][1] : null;
}

/** How far it reaches out from the board. */
export const reachOf = (p: readonly Vec2[]) => Math.max(CUSTOM.plate, ...p.map((q) => q[0]));
/** Its top. */
export const topOf = (p: readonly Vec2[]) => Math.max(0, ...p.map((q) => q[1]));

/** What's wrong with a profile, if anything: too few points or too little area, edges that cross, or not joined to the plate. */
export type ProfileProblem = 'small' | 'crossing' | 'loose';

export function profileProblem(p: readonly Vec2[]): ProfileProblem | null {
  if (p.length < 3 || Math.abs(signedArea(p)) < 20) return 'small';
  if (selfCrossing(p)) return 'crossing';
  // Joined: it reaches 0.5 mm or more into the plate, along 3 mm or more.
  const along = spanAt(p, CUSTOM.plate - 0.5).reduce((t, [a, b]) => t + b - a, 0);
  return along < CUSTOM.attach - 1e-6 ? 'loose' : null;
}

/** Drop the points that change the outline least till `max` are left (Visvalingam). */
function simplify(p: Vec2[], max: number): Vec2[] {
  const q = [...p];
  while (q.length > max) {
    let best = 0;
    let least = Infinity;
    for (let i = 0; i < q.length; i++) {
      const a = Math.abs(crossO(q[(i + q.length - 1) % q.length], q[i], q[(i + 1) % q.length]));
      if (a < least) {
        least = a;
        best = i;
      }
    }
    q.splice(best, 1);
  }
  return q;
}

/**
 * A profile from saved or edited data (anything): points to 0.1 mm, behind the board and below the bed moved
 * onto them, repeats dropped, at most 40 points, anticlockwise. Null when what's left isn't a usable profile
 * (profileProblem). `flipped`: it was clockwise, so its edges run the other way now; `kept`: no point was dropped
 * (so its edges are the ones its features were put on).
 */
export function cleanProfile(raw: unknown): { pts: Vec2[]; flipped: boolean; kept: boolean } | null {
  if (!Array.isArray(raw)) return null;
  let pts: Vec2[] = [];
  for (const q of raw.slice(0, 400)) {
    if (!Array.isArray(q)) continue;
    const z = Number(q[0]);
    const y = Number(q[1]);
    if (!Number.isFinite(z) || !Number.isFinite(y)) continue;
    const pt: Vec2 = [r1(clamp(z, 0, CUSTOM.reach)), r1(clamp(y, 0, CUSTOM.tall))];
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 0.3) pts.push(pt);
  }
  while (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.3) pts.pop();
  const kept = pts.length === raw.length && pts.length <= CUSTOM.points;
  if (pts.length > CUSTOM.points) pts = simplify(pts, CUSTOM.points);
  const flipped = signedArea(pts) < 0;
  if (flipped) pts.reverse();
  return profileProblem(pts) ? null : { pts, flipped, kept };
}

// ---------------------------------------------------------------------------
// Printing upright: the 45° rule
// ---------------------------------------------------------------------------

/** Steepest a downward face may lean from upright and still print without support, degrees (half a degree's grace). */
const OVERHANG = 44.5;

/**
 * The edges (by index) that, printed upright, would need support: facing down, flatter than 45°, in front of the
 * plate and off the bed. The profile is anticlockwise, so an edge faces down where it runs out from the board.
 */
export function overhangs(p: readonly Vec2[]): number[] {
  const T = CUSTOM.plate;
  const tan = Math.tan((OVERHANG * Math.PI) / 180);
  const out: number[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = next(p as Vec2[], i);
    const dz = b[0] - a[0];
    if (dz <= 1e-6) continue;
    // In the plate (or on its face) it's no surface at all.
    if (b[0] <= T + 1e-6) continue;
    if (Math.max(a[1], b[1]) <= 0.05) continue;
    if (Math.abs(b[1] - a[1]) < dz * tan - 1e-6) out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Walls: rays in from the faces
// ---------------------------------------------------------------------------

/**
 * How far a ray from `s` along `d` (unit) runs through solid (the profile and the back plate, `h` tall) before it
 * comes out; 0 when it doesn't start in it.
 */
export function exitAlong(p: readonly Vec2[], h: number, s: Vec2, d: Vec2): number {
  const T = CUSTOM.plate;
  const events: number[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = next(p as Vec2[], i);
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - s[0]) * ey - (a[1] - s[1]) * ex) / den;
    const u = ((a[0] - s[0]) * d[1] - (a[1] - s[1]) * d[0]) / den;
    if (t > 1e-6 && u >= 0 && u < 1) events.push(t);
  }
  // The plate: where the ray is in its rectangle.
  let t0 = 0;
  let t1 = Infinity;
  for (const [k, lo, hi] of [
    [0, 0, T],
    [1, 0, h],
  ] as const) {
    if (Math.abs(d[k]) < 1e-12) {
      if (s[k] < lo - 1e-9 || s[k] > hi + 1e-9) t1 = -1;
    } else {
      const a = (lo - s[k]) / d[k];
      const b = (hi - s[k]) / d[k];
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
  }
  const plate = t1 > t0 + 1e-9 && t1 > 1e-6 ? ([t0, t1] as const) : null;
  if (plate) events.push(plate[0], plate[1]);
  events.sort((a, b) => a - b);
  const at = (t: number): Vec2 => [s[0] + d[0] * t, s[1] + d[1] * t];
  const solid = (t: number) => insidePolygon(p, at(t)) || (!!plate && t > plate[0] && t < plate[1]);
  if (!solid(1e-4)) return 0;
  for (let k = 0; k < events.length; k++) {
    const t = events[k];
    const after = k + 1 < events.length ? (t + events[k + 1]) / 2 : t + 1;
    if (t > 1e-4 && !solid(after)) return t;
  }
  return events[events.length - 1] ?? 0;
}

/** An edge's direction (unit) and its outward normal, anticlockwise. */
export function edgeFrame(a: Vec2, b: Vec2): { e: Vec2; n: Vec2; len: number } {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const e: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  return { e, n: [e[1], -e[0]], len };
}

/** The thinnest wall in front of the plate, mm, and where it is (null: no wall to measure). */
export function thinnest(p: readonly Vec2[], h: number): { t: number; at: Vec2 } | null {
  const T = CUSTOM.plate;
  let best: { t: number; at: Vec2 } | null = null;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = next(p as Vec2[], i);
    const { e, n, len } = edgeFrame(a, b);
    // From a wall's thickness in from each end (nearer, a corner of 45° or more would read thin), or the middle.
    const span = Math.max(0, len - 2 * CUSTOM.wall);
    const steps = Math.max(1, Math.round(span));
    for (let k = 0; k < steps; k++) {
      const s = span ? CUSTOM.wall + ((k + 0.5) / steps) * span : len / 2;
      const at: Vec2 = [a[0] + e[0] * s, a[1] + e[1] * s];
      if (at[0] <= T + 0.01) continue;
      const t = exitAlong(p, h, at, [-n[0], -n[1]]);
      if (t > 0 && (!best || t < best.t)) best = { t, at };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

/**
 * A flat face features can go on: from `a` to `b` in the profile (the face's "along"), across the part's width,
 * facing `n` (outward); id: the profile edge, or -1 for the back plate's front.
 */
export interface Face {
  id: number;
  a: Vec2;
  b: Vec2;
  len: number;
  e: Vec2;
  n: Vec2;
}

/**
 * The plate's front where nothing is in front of it: its longest free stretch (y0..y1), `covered` being more
 * that stands on it (add-ons); null when none is 6 mm long.
 */
export function plateFree(p: readonly Vec2[], h: number, covered: [number, number][] = []): [number, number] | null {
  const taken = [...spanAt(p, CUSTOM.plate + 0.05), ...covered].sort((a, b) => a[0] - b[0]);
  let best: [number, number] | null = null;
  let y = 0;
  for (const [a, b] of [...taken, [h, h] as [number, number]]) {
    if (a - y >= 6 && (!best || a - y > best[1] - best[0])) best = [r1(y), r1(Math.min(a, h))];
    y = Math.max(y, b);
  }
  return best;
}

/** Every face that takes features: the profile's edges in front of the plate (the part of them that is), and the plate's free front. */
export function profileFaces(p: readonly Vec2[], h: number, covered: [number, number][] = []): Face[] {
  const T = CUSTOM.plate;
  const out: Face[] = [];
  for (let i = 0; i < p.length; i++) {
    let a = p[i];
    let b = next(p as Vec2[], i);
    if (a[0] <= T + 1e-6 && b[0] <= T + 1e-6) continue;
    // Just the part in front of the plate.
    const cut = (q: Vec2, r: Vec2): Vec2 => [T, q[1] + ((T - q[0]) / (r[0] - q[0])) * (r[1] - q[1])];
    if (a[0] < T) a = cut(a, b);
    else if (b[0] < T) b = cut(b, a);
    const f = edgeFrame(a, b);
    if (f.len >= CUSTOM.face) out.push({ id: i, a, b, ...f });
  }
  const free = plateFree(p, h, covered);
  if (free) out.push({ id: -1, a: [T, free[0]], b: [T, free[1]], len: free[1] - free[0], e: [0, 1], n: [1, 0] });
  return out;
}

/** What a face is, in words: which way it faces. */
export function faceName(f: Pick<Face, 'id' | 'n'>): string {
  if (f.id === -1) return 'Back plate';
  const [nz, ny] = f.n;
  if (ny > 0.9) return 'Top';
  if (ny < -0.9) return 'Underside';
  if (nz > 0.9) return 'Front';
  if (nz < -0.9) return 'Back';
  return ny > 0 ? (nz > 0 ? 'Sloping top' : 'Sloping top (back)') : nz > 0 ? 'Sloping front' : 'Sloping underside';
}

// ---------------------------------------------------------------------------
// Features: where each one goes, and its outline
// ---------------------------------------------------------------------------

/** A feature's half sizes across and along its face. */
export function featureHalf(f: Pick<Feature, 'k' | 'a' | 'b'>): [number, number] {
  if (f.k === 'round' || f.k === 'notch') return [f.a / 2, f.a / 2];
  if (f.k === 'hex') return [f.a / Math.sqrt(3), f.a / Math.sqrt(3)];
  return [f.a / 2, f.b / 2];
}

/** The centres of a feature's group on a face `w` wide (u across from the left, v along from the face's start). */
export function featureCentres(f: Feature, w: number, len: number): Vec2[] {
  const out: Vec2[] = [];
  for (let j = 0; j < f.m; j++) for (let i = 0; i < f.n; i++) out.push([w / 2 + f.u + (i - (f.n - 1) / 2) * f.su, len / 2 + f.v + (j - (f.m - 1) / 2) * f.sv]);
  return out;
}

const circle = (c: Vec2, r: number, n = 32): Vec2[] =>
  Array.from({ length: n }, (_, k) => [c[0] + r * Math.cos((2 * Math.PI * k) / n), c[1] + r * Math.sin((2 * Math.PI * k) / n)] as Vec2);

/** Convex hull, anticlockwise (monotone chain). */
export function hull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const half = (list: Vec2[]) => {
    const h: Vec2[] = [];
    for (const q of list) {
      while (h.length >= 2 && crossO(h[h.length - 2], h[h.length - 1], q) <= 1e-12) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}

/**
 * A hole's outline in its face's (u, v), centred at `c`: round, a slot (rounded ends, along its longer side), a
 * rectangle, a hex (a corner toward `tear`, else across), a notch (a slot from `c` out past the face's nearer
 * end, at `end` along). With `tear` (the way up as printed, when the hole lies on its side), round ends get a 45°
 * point that way, so they print without support.
 */
export function holeOutline(f: Pick<Feature, 'k' | 'a' | 'b'>, c: Vec2, tear: Vec2 | null, end?: number): Vec2[] {
  const tip = (q: Vec2, r: number): Vec2[] => (tear ? [[q[0] + tear[0] * r * Math.SQRT2, q[1] + tear[1] * r * Math.SQRT2]] : []);
  if (f.k === 'rect' || f.k === 'text') {
    const [hu, hv] = [f.a / 2, f.b / 2];
    return [
      [c[0] - hu, c[1] - hv],
      [c[0] + hu, c[1] - hv],
      [c[0] + hu, c[1] + hv],
      [c[0] - hu, c[1] + hv],
    ];
  }
  if (f.k === 'hex') {
    const r = f.a / Math.sqrt(3);
    const a0 = tear ? Math.atan2(tear[1], tear[0]) : 0;
    return Array.from({ length: 6 }, (_, k) => [c[0] + r * Math.cos(a0 + (k * Math.PI) / 3), c[1] + r * Math.sin(a0 + (k * Math.PI) / 3)] as Vec2);
  }
  if (f.k === 'round') return tear ? hull([...circle(c, f.a / 2), ...tip(c, f.a / 2)]) : circle(c, f.a / 2);
  // Slots and notches: two round ends.
  let c0 = c;
  let c1 = c;
  let r = f.a / 2;
  if (f.k === 'notch') c1 = [c[0], end ?? c[1]];
  else if (f.a >= f.b) {
    r = f.b / 2;
    c0 = [c[0] - (f.a - f.b) / 2, c[1]];
    c1 = [c[0] + (f.a - f.b) / 2, c[1]];
  } else {
    c0 = [c[0], c[1] - (f.b - f.a) / 2];
    c1 = [c[0], c[1] + (f.b - f.a) / 2];
  }
  return hull([...circle(c0, r), ...circle(c1, r), ...tip(c0, r), ...tip(c1, r)]);
}
