/**
 * Pins and hinges, geometry (planning in hinge.ts): holes and knuckles along
 * x drawn in side view (wall z out, y up), and the printed pin. A hole along
 * x in a part printed upright is a teardrop, its point up, so its top rises at
 * 45° and needs no support; the pin still turns in its round lower part.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec2, type Wasm } from '../../geometry/kernel';
import { cylinderAt } from '../../geometry/shapes';
import { prismX } from '../mount';
import { PIN, type PinSpec } from './hinge';

/** Points in side view (z, y) to prismX's (d, y). */
export const zy = (pts: Vec2[]): Vec2[] => pts.map(([z, y]) => [-z, y]);

/** A circle in side view, `n` sides. */
export function circleZY(zc: number, yc: number, r: number, n = 40): Vec2[] {
  return Array.from({ length: n }, (_, k) => [zc + r * Math.cos((2 * Math.PI * k) / n), yc + r * Math.sin((2 * Math.PI * k) / n)] as Vec2);
}

/** A teardrop in side view: a circle with a 45° point toward `dir` (degrees from +z toward +y; 90: up). */
export function teardropZY(zc: number, yc: number, r: number, dir = 90, n = 40): Vec2[] {
  const d = (dir * Math.PI) / 180;
  const pts: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const a = d - Math.PI / 4 - (k * 1.5 * Math.PI) / n;
    pts.push([zc + r * Math.cos(a), yc + r * Math.sin(a)]);
  }
  pts.push([zc + r * Math.SQRT2 * Math.cos(d), yc + r * Math.SQRT2 * Math.sin(d)]);
  return pts;
}

/** A round bar along x, x0..x1, its axis at (z, y). */
export const barX = (w: Wasm, s: Scope, z: number, y: number, r: number, x0: number, x1: number): Manifold => prismX(w, s, zy(circleZY(z, y, r)), x0, x1 - x0);

/** A round post along y, y0..y1, its axis at (x, z), radius r0 at the bottom and r1 at the top. */
export const postY = (w: Wasm, s: Scope, x: number, z: number, y0: number, y1: number, r0: number, r1 = r0): Manifold =>
  s.t(s.t(cylinderAt(w, x, -z, y0, y1, r0, r1, 48)).rotate([-90, 0, 0]));

/** A teardrop hole along x, x0..x1, its axis at (z, y), its point toward `dir` (up as the part prints; 90: up the wall). */
export const holeX = (w: Wasm, s: Scope, z: number, y: number, r: number, x0: number, x1: number, dir = 90): Manifold =>
  prismX(w, s, zy(teardropZY(z, y, r, dir)), x0, x1 - x0);

/** A part built in the wall frame, turned (degrees about x, y, z) into its print pose, its min corner at the origin. */
export function posedBy(s: Scope, m: Manifold, turn: [number, number, number], what: string): MeshData {
  const p = s.t(m.rotate(turn));
  const b = p.boundingBox();
  const out = s.t(p.translate([-b.min[0], -b.min[1], -b.min[2]]));
  assertValid(out, what);
  return toMeshData(out);
}

/**
 * Knuckles along x for a hinge `width` wide: an odd number of segments, about 20 mm each, 0.5 mm apart; the
 * fixed part has the even ones (both ends), the moving part the odd ones.
 */
export function knuckles(width: number): { fixed: [number, number][]; moving: [number, number][] } {
  const n = Math.max(3, Math.min(9, 2 * Math.floor(width / 40) + 1));
  const seg = (width - (n - 1) * PIN.gap) / n;
  const out = { fixed: [] as [number, number][], moving: [] as [number, number][] };
  for (let k = 0; k < n; k++) (k % 2 ? out.moving : out.fixed).push([k * (seg + PIN.gap), k * (seg + PIN.gap) + seg]);
  return out;
}

/** A printed pin in its print pose: along x from its head (x = 0), cut flat underneath, its axis PIN.d / 2 − PIN.flat up. */
export function pinSolid(w: Wasm, s: Scope, len: number): Manifold {
  const r = PIN.d / 2;
  const rh = PIN.head / 2;
  const L = PIN.headT + len;
  // Along z first: the head, the shaft, a 0.4 mm chamfer at the tip so it starts into its hole; then laid along x.
  const along = s.t(
    w.Manifold.union([
      s.t(w.Manifold.cylinder(PIN.headT, rh, rh, 48)),
      s.t(s.t(w.Manifold.cylinder(L - 0.4 - PIN.headT + 0.01, r, r, 32)).translate([0, 0, PIN.headT - 0.01])),
      s.t(s.t(w.Manifold.cylinder(0.4, r, r - 0.4, 32)).translate([0, 0, L - 0.4])),
    ]),
  );
  const laid = s.t(s.t(along.rotate([0, 90, 0])).translate([0, rh, r - PIN.flat]));
  return s.t(laid.intersect(s.t(s.t(w.Manifold.cube([L + 1, 2 * rh + 1, 2 * rh])).translate([-0.5, -0.5, 0]))));
}

/** A printed rod ⌀d along x, `len` long, its ends chamfered 0.5 mm, cut flat `flat` up from its bottom, which is on the bed. */
export function rodSolid(w: Wasm, s: Scope, len: number, d: number, flat: number): Manifold {
  const r = d / 2;
  const along = s.t(
    w.Manifold.union([
      s.t(w.Manifold.cylinder(0.5, r - 0.5, r, 48)),
      s.t(s.t(w.Manifold.cylinder(len - 1, r, r, 48)).translate([0, 0, 0.5])),
      s.t(s.t(w.Manifold.cylinder(0.5, r, r - 0.5, 48)).translate([0, 0, len - 0.5])),
    ]),
  );
  const laid = s.t(s.t(along.rotate([0, 90, 0])).translate([0, r, r - flat]));
  return s.t(laid.intersect(s.t(s.t(w.Manifold.cube([len + 1, d + 1, d])).translate([-0.5, -0.5, 0]))));
}

/** A printed pin's mesh, min corner at the origin. */
export function pinMesh(w: Wasm, spec: PinSpec): MeshData {
  const s = new Scope();
  try {
    const m = pinSolid(w, s, spec.len);
    const b = m.boundingBox();
    const out = s.t(m.translate([-b.min[0], -b.min[1], -b.min[2]]));
    assertValid(out, 'pin');
    return toMeshData(out);
  } finally {
    s.dispose();
  }
}
