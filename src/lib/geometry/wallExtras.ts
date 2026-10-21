/**
 * Extras on divider walls (src/lib/dividers), hooked into compartments.ts:
 *
 * - Finger notches: a U-shaped cut down from a wall's top (rounded bottom),
 *   one centered in each segment of the wall between the walls that cross or
 *   meet it.
 * - Shaped tops: the top edges of a wall chamfered or rounded.
 * - Diagonal / curved walls (`layout.free`): a DIVIDER-thick wall along a
 *   segment or circular arc, from the floor to the top of the infill (minus its
 *   `lower`). It's made by leaving its footprint uncut, so it's clipped to the
 *   cavity and, on lite / efficient bases, goes down into the feet the same way
 *   straight dividers do. Simplification: these walls don't split compartments,
 *   so scoops, label tabs and per-compartment options ignore them (a wall
 *   through a scoop or a tab just stands in it).
 *
 * Removable walls get no notch or top shape in the bin (they're slots there):
 * those go on the printed plate (`shapeInsert`).
 * Label tabs and scoop ramps (`keep`) are never cut by notches or top shapes.
 */
import type { Manifold, Vec2, Vec3, Wasm } from './kernel';
import type { Scope } from './kernel';
import { DIVIDER } from './spec';
import { extrudePolygon } from './shapes';
import {
  SLOT_DEPTH,
  freeWallOutline,
  wallSpans,
  type ResolvedLayout,
  type ResolvedWall,
  type WallNotch,
  type WallTop,
} from '../dividers';

const T = DIVIDER;
/** How far cutters reach past what they cut (mm). */
const E = 0.05;
/** Chamfer on each top edge (mm, 45°). Leaves a flat on top of a 1.2 mm wall. */
export const TOP_CHAMFER = 0.45;
/** Radius of the rounded top edges: almost a full half round on a 1.2 mm wall. */
export const TOP_ROUND = T / 2 - 0.05;
/** Solid wall left on each side of a notch, and under it (mm). */
const NOTCH_MARGIN = 1;
/** Narrowest notch worth cutting (mm). */
const NOTCH_MIN = 3;

/** Default notch for a wall `height` mm tall: 20 mm wide, 40% of the height deep. */
export function defaultNotch(height: number): WallNotch {
  return { width: 20, depth: Math.max(1, Math.round(Math.max(0, height) * 0.4 * 2) / 2) };
}

/**
 * A notch clamped to the room it has: `span` mm of clear wall along the run and
 * `height` mm of wall. Null when it doesn't fit.
 */
export function fitNotch(n: WallNotch | undefined, span: number, height: number): WallNotch | null {
  if (!n) return null;
  const width = Math.min(n.width, span - 2 * NOTCH_MARGIN);
  const depth = Math.min(n.depth, height - NOTCH_MARGIN);
  return width >= NOTCH_MIN && depth >= 0.5 ? { width, depth } : null;
}

/** Where a wall's notches go: centers along its run (cavity mm) and their clamped sizes. */
export function notchPlacements(r: ResolvedLayout, W: ResolvedWall, height: number): { center: number; notch: WallNotch }[] {
  if (!W.wall.notch || W.removable) return [];
  const out: { center: number; notch: WallNotch }[] = [];
  for (const sp of wallSpans(r, W.id)) {
    const n = fitNotch(W.wall.notch, sp.b - sp.a, height);
    if (n) out.push({ center: (sp.a + sp.b) / 2, notch: n });
  }
  return out;
}

/**
 * Cross-section of what a top shape removes from a wall `th` thick, in
 * (across, z) with the wall centered on across = 0 and its top at z = 0.
 * CCW polygons; none for a flat top.
 */
export function topProfile(top: WallTop | undefined, th = T): Vec2[][] {
  if (top === 'chamfer') {
    const c = Math.min(TOP_CHAMFER, th / 2 - 0.1);
    const lo: Vec2[] = [
      [-th / 2 - E, -c - E],
      [-th / 2 + c + E, E],
      [-th / 2 - E, E],
    ];
    return [lo, mirror(lo)];
  }
  if (top === 'round') {
    const r = Math.min(TOP_ROUND, th / 2 - 0.02);
    const cx = -th / 2 + r;
    const lo: Vec2[] = [[-th / 2 - E, -r]];
    const segs = 8;
    for (let i = 0; i <= segs; i++) {
      const a = Math.PI - (Math.PI / 2) * (i / segs);
      lo.push([cx + r * Math.cos(a), -r + r * Math.sin(a)]);
    }
    lo.push([cx, E], [-th / 2 - E, E]);
    return [lo, mirror(lo)];
  }
  return [];
}

/** Mirror a CCW polygon across x = 0 (still CCW). */
const mirror = (p: Vec2[]): Vec2[] => p.map(([x, y]) => [-x, y] as Vec2).reverse();

/** Place a solid built in local (x, y, z) with x → ex, y → ey, z → ez, then translate by t. */
function place(m: Manifold, ex: Vec3, ey: Vec3, ez: Vec3, t: Vec3): Manifold {
  return m.transform([ex[0], ex[1], ex[2], 0, ey[0], ey[1], ey[2], 0, ez[0], ez[1], ez[2], 0, t[0], t[1], t[2], 1]);
}

/**
 * A prism with cross-section `polys` in (across, z) — across relative to the
 * wall's centerline, z relative to `z0` — running along a straight wall from
 * r0 to r1 (cavity mm), in bin coordinates.
 */
function alongWall(w: Wasm, s: Scope, W: ResolvedWall, r0: number, r1: number, polys: Vec2[][], z0: number, ix0: number, iy0: number) {
  const m = s.t(w.Manifold.extrude(polys, r1 - r0));
  return W.orient === 'v'
    ? s.t(place(m, [1, 0, 0], [0, 0, 1], [0, -1, 0], [ix0 + W.pos, iy0 + r1, z0]))
    : s.t(place(m, [0, 1, 0], [0, 0, 1], [1, 0, 0], [ix0 + r0, iy0 + W.pos, z0]));
}

/** A U-shaped notch cutter across a straight wall: `center` along its run, top at `top`. */
function notchCutter(w: Wasm, s: Scope, W: ResolvedWall, center: number, n: WallNotch, top: number, ix0: number, iy0: number) {
  const hw = n.width / 2;
  const r = Math.min(hw, n.depth);
  const zc = top - n.depth + r;
  const prof: Vec2[] = [
    [center - hw, top + 1],
    [center + hw, top + 1],
  ];
  const segs = 24;
  for (const cx of [center - hw + r, center + hw - r]) {
    for (let i = 0; i < segs; i++) {
      const a = (2 * Math.PI * i) / segs;
      prof.push([cx + r * Math.cos(a), zc + r * Math.sin(a)]);
    }
  }
  const pts: Vec3[] = [];
  for (const [run, z] of prof) {
    for (const c of [W.pos - T / 2 - E, W.pos + T / 2 + E]) pts.push(W.orient === 'v' ? [ix0 + c, iy0 + run, z] : [ix0 + run, iy0 + c, z]);
  }
  return s.t(w.Manifold.hull(pts));
}

export interface WallExtraParts {
  /** Interior cutters (unioned and subtracted from the infill). May be replaced by their union. */
  cut: Manifold[];
  /** Solids no cut may remove (label tabs, scoop ramps, raised floors). */
  keep: Manifold[];
}

/**
 * The hook in compartments.ts `layoutCuts`: adds notch and top-shape cutters to
 * `parts.cut`, then (with diagonal / curved walls) replaces it by its union
 * minus those walls. Call it after every compartment cutter is in, before the
 * removable-wall slots (so slots still cut through a free wall).
 */
export function applyWallExtras(
  w: Wasm,
  s: Scope,
  r: ResolvedLayout,
  ix0: number,
  iy0: number,
  zFloor: number,
  topInfill: number,
  parts: WallExtraParts,
): void {
  const innerH = topInfill - zFloor;
  const maxLower = Math.max(0, innerH - 2);
  const cutters: Manifold[] = [];
  for (const W of r.walls) {
    if (W.removable || (!W.wall.notch && !(W.wall.top && W.wall.top !== 'flat'))) continue;
    const top = topInfill - Math.min(W.lower, maxLower);
    const runSize = W.orient === 'v' ? r.innerD : r.innerW;
    const prof = topProfile(W.wall.top);
    if (prof.length) {
      for (const sp of wallSpans(r, W.id)) {
        // Past the cavity edge (the outer wall is added back later); just short of a wall's face.
        const r0 = sp.aEdge ? Math.min(sp.a, 0) - 0.01 : sp.a + 0.01;
        const r1 = sp.bEdge ? Math.max(sp.b, runSize) + 0.01 : sp.b - 0.01;
        if (r1 - r0 > 0.1) cutters.push(alongWall(w, s, W, r0, r1, prof, top, ix0, iy0));
      }
    }
    for (const { center, notch } of notchPlacements(r, W, top - zFloor)) cutters.push(notchCutter(w, s, W, center, notch, top, ix0, iy0));
  }
  if (cutters.length) {
    let c = s.t(w.Manifold.union(cutters));
    if (parts.keep.length) c = s.t(c.subtract(s.t(w.Manifold.union(parts.keep))));
    parts.cut.push(c);
  }

  const free = freeWallSolids(w, s, r, ix0, iy0, zFloor, topInfill);
  if (free.length && parts.cut.length) {
    const all = s.t(w.Manifold.union(parts.cut));
    parts.cut.length = 0;
    parts.cut.push(s.t(all.subtract(s.t(w.Manifold.union(free)))));
  }
}

/** Footprint solids of the diagonal / curved walls, from below the floor to their tops. */
export function freeWallSolids(
  w: Wasm,
  s: Scope,
  r: ResolvedLayout,
  ix0: number,
  iy0: number,
  zFloor: number,
  topInfill: number,
): Manifold[] {
  const innerH = topInfill - zFloor;
  const maxLower = Math.max(0, innerH - 2);
  return r.free.map((f) => {
    const ring = freeWallOutline(f).map(([x, y]) => [ix0 + x, iy0 + y] as Vec2);
    return s.t(extrudePolygon(w, ring, zFloor - 1, topInfill - Math.min(f.lower, maxLower)));
  });
}

// ---------------------------------------------------------------------------
// Removable divider plates
// ---------------------------------------------------------------------------

/** Notch and top shape of a removable wall's plate (fields only when set). */
export interface InsertExtras {
  notch?: WallNotch;
  top?: WallTop;
}

export function insertExtras(W: ResolvedWall | undefined): InsertExtras {
  const out: InsertExtras = {};
  if (W?.wall.notch) out.notch = { ...W.wall.notch };
  if (W?.wall.top && W.wall.top !== 'flat') out.top = W.wall.top;
  return out;
}

/** Mesh-key part for a plate's extras ('' without any, so plain plates keep their keys). */
export function insertExtrasKey(ins: InsertExtras): string {
  return `${ins.notch ? `|n${ins.notch.width}x${ins.notch.depth}` : ''}${ins.top ? `|t${ins.top}` : ''}`;
}

/**
 * The plate solid for `outline` (CCW, in X = along the wall × Y = up, the top
 * edge at y = height), `thickness` thick, with its notch cut into the top edge
 * and its top edges shaped. Without extras this is the plain extrusion.
 */
export function shapeInsert(
  w: Wasm,
  s: Scope,
  ins: InsertExtras & { length: number; height: number; thickness: number },
  outline: Vec2[],
): Manifold {
  const L = ins.length;
  const H = ins.height;
  let ring = outline;
  // Keep the bottom part (in the floor groove) and 1 mm above it.
  const n = fitNotch(ins.notch, L, H - SLOT_DEPTH - 1);
  if (n) {
    const top = ring.findIndex(([x, y], i) => x === L && y === H && ring[(i + 1) % ring.length][1] === H);
    if (top >= 0) {
      const c = L / 2;
      const hw = n.width / 2;
      const r = Math.min(hw, n.depth);
      const zc = H - n.depth + r;
      const u: Vec2[] = [[c + hw, H]];
      const segs = 12;
      for (let i = 0; i <= segs; i++) {
        const a = -(Math.PI / 2) * (i / segs);
        u.push([c + hw - r + r * Math.cos(a), zc + r * Math.sin(a)]);
      }
      for (let i = 0; i <= segs; i++) {
        const a = -Math.PI / 2 - (Math.PI / 2) * (i / segs);
        u.push([c - hw + r + r * Math.cos(a), zc + r * Math.sin(a)]);
      }
      u.push([c - hw, H]);
      ring = [...ring.slice(0, top + 1), ...dedupe(u), ...ring.slice(top + 1)];
    }
  }
  let m = s.t(extrudePolygon(w, ring, 0, ins.thickness));
  const prof = topProfile(ins.top, ins.thickness);
  if (prof.length) {
    const len = L + 0.02;
    const cut = s.t(place(s.t(w.Manifold.extrude(prof, len)), [0, 0, 1], [0, 1, 0], [-1, 0, 0], [L + 0.01, H, ins.thickness / 2]));
    m = s.t(m.subtract(cut));
  }
  return m;
}

/** Drop consecutive duplicate points (a full-radius notch has no flat bottom). */
function dedupe(p: Vec2[]): Vec2[] {
  return p.filter((q, i) => i === 0 || Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) > 1e-6);
}
