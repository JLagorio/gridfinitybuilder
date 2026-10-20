import type { Manifold, Vec2, Vec3, Wasm } from './kernel';

/** Arc segments per 90° corner. 8 keeps chord error < 0.02 mm on a 4 mm radius. */
export const CORNER_SEGMENTS = 8;
/** Segments for round holes. */
export const HOLE_SEGMENTS = 40;

/** Corner radii in CCW order starting bottom-left: [BL, BR, TR, TL]. */
export type CornerRadii = [number, number, number, number];

/**
 * Points of an axis-aligned rectangle with per-corner radii, CCW (viewed from +Z).
 * A radius of 0 yields a sharp corner.
 */
export function roundedRectRing(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radii: number | CornerRadii,
  segs = CORNER_SEGMENTS,
): Vec2[] {
  const r: CornerRadii = typeof radii === 'number' ? [radii, radii, radii, radii] : radii;
  const maxR = Math.min(x1 - x0, y1 - y0) / 2;
  const corners: [number, number, number, number][] = [
    // cx, cy, radius, start angle (deg)
    [x0, y0, r[0], 180],
    [x1, y0, r[1], 270],
    [x1, y1, r[2], 0],
    [x0, y1, r[3], 90],
  ];
  const pts: Vec2[] = [];
  for (const [x, y, rr, a0] of corners) {
    const rad = Math.min(Math.max(rr, 0), maxR);
    if (rad < 1e-6) {
      pts.push([x, y]);
      continue;
    }
    const cx = x + (x === x0 ? rad : -rad);
    const cy = y + (y === y0 ? rad : -rad);
    for (let i = 0; i <= segs; i++) {
      const a = ((a0 + (90 * i) / segs) * Math.PI) / 180;
      pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
    }
  }
  return pts;
}

export interface LoftKnot {
  z: number;
  /** Inset from the reference outline (negative = grow). */
  inset: number;
}

/**
 * Loft a centered rounded rectangle through a series of (z, inset) knots.
 * Every ring has the same vertex count, so the result is built directly as a
 * mesh (no booleans) — fast and exact for Gridfinity's 45°/vertical profiles.
 */
export function loftRoundedRect(
  w: Wasm,
  cx: number,
  cy: number,
  width: number,
  depth: number,
  radius: number,
  knots: LoftKnot[],
  segs = CORNER_SEGMENTS,
): Manifold {
  const rings: Vec2[][] = knots.map((k) => {
    const r = radius - k.inset;
    if (r <= 0.01) throw new Error(`loft: inset ${k.inset} exceeds corner radius ${radius}`);
    const hw = width / 2 - k.inset;
    const hd = depth / 2 - k.inset;
    return roundedRectRing(cx - hw, cy - hd, cx + hw, cy + hd, r, segs);
  });
  return loftRings(
    w,
    rings,
    knots.map((k) => k.z),
  );
}

/** Build a closed solid from convex CCW rings of equal length stacked at increasing z. */
export function loftRings(w: Wasm, rings: Vec2[][], zs: number[]): Manifold {
  const n = rings[0].length;
  const nr = rings.length;
  for (let i = 1; i < nr; i++) {
    if (rings[i].length !== n) throw new Error('loftRings: ring length mismatch');
    if (!(zs[i] > zs[i - 1])) throw new Error('loftRings: z must increase');
  }
  const verts = new Float32Array(n * nr * 3);
  for (let j = 0; j < nr; j++) {
    for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 3;
      verts[o] = rings[j][i][0];
      verts[o + 1] = rings[j][i][1];
      verts[o + 2] = zs[j];
    }
  }
  const tris: number[] = [];
  for (let j = 0; j < nr - 1; j++) {
    const a = j * n;
    const b = (j + 1) * n;
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      tris.push(a + i, a + i1, b + i1);
      tris.push(a + i, b + i1, b + i);
    }
  }
  // caps (rings are convex => fan triangulation)
  const top = (nr - 1) * n;
  for (let i = 1; i < n - 1; i++) {
    tris.push(0, i + 1, i);
    tris.push(top, top + i, top + i + 1);
  }
  const mesh = new w.Mesh({ numProp: 3, vertProperties: verts, triVerts: new Uint32Array(tris) });
  return w.Manifold.ofMesh(mesh);
}

/** Extrude a CCW polygon between two heights. */
export function extrudePolygon(w: Wasm, pts: Vec2[], z0: number, z1: number): Manifold {
  return w.Manifold.extrude([pts], z1 - z0).translate([0, 0, z0]);
}

export function cylinderAt(
  w: Wasm,
  x: number,
  y: number,
  z0: number,
  z1: number,
  r0: number,
  r1 = r0,
  segs = HOLE_SEGMENTS,
): Manifold {
  return w.Manifold.cylinder(z1 - z0, r0, r1, segs).translate([x, y, z0]);
}

export function boxAt(w: Wasm, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Manifold {
  return w.Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);
}

/** Convex hull of the given points. */
export function hullOf(w: Wasm, pts: Vec3[]): Manifold {
  return w.Manifold.hull(pts);
}

export function ringAt(ring: Vec2[], z: number): Vec3[] {
  return ring.map(([x, y]) => [x, y, z] as Vec3);
}
