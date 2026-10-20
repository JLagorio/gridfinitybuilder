/**
 * Outer-wall features.
 *
 * - Wall cutouts (Gridfinity Extended `wallcutout`): a U-shaped notch from the
 *   top of a wall down, with rounded bottom corners, for reaching in from the
 *   side.
 * - Finger slides (Extended `fingerslide`): a concave quarter-round where the
 *   floor meets a wall, so small parts slide up and out.
 */
import type { Manifold, Scope, Wasm } from './kernel';
import { BASE_TOP_RADIUS, LIP_DEPTH, WALL } from './spec';
import { boxAt } from './shapes';
import type { Wall, WallMask } from './variants';

const SEGS = 48;

/** Placement of a wall-local frame: u along the wall, v inward from the outer face. */
interface WallFrame {
  wall: Wall;
  /** Length of the wall's outer face. */
  length: number;
  /** Rotation about Z and offset that map the front-wall frame (u = +X, inward = +Y, face at y = 0) onto this wall. */
  rot: number;
  at: [number, number];
}

function frames(mask: WallMask, W: number, D: number): WallFrame[] {
  const all: WallFrame[] = [
    { wall: 'f', length: W, rot: 0, at: [0, -D / 2] },
    { wall: 'b', length: W, rot: 180, at: [0, D / 2] },
    { wall: 'l', length: D, rot: -90, at: [-W / 2, 0] },
    { wall: 'r', length: D, rot: 90, at: [W / 2, 0] },
  ];
  return all.filter((f) => mask.includes(f.wall));
}

const place = (s: Scope, m: Manifold, f: WallFrame) => s.t(s.t(m.rotate([0, 0, f.rot])).translate([f.at[0], f.at[1], 0]));

/** Cylinder along the wall's inward axis (local +Y), from v0 to v1, centered at (u, z). */
function rod(w: Wasm, s: Scope, u: number, z: number, r: number, v0: number, v1: number): Manifold {
  // cylinder along +Z, rotated so +Z points along +Y
  return s.t(s.t(w.Manifold.cylinder(v1 - v0, r, r, SEGS)).rotate([-90, 0, 0]).translate([u, v0, z]));
}

export interface CutoutOpts {
  cutoutWalls: WallMask;
  cutoutWidth: number;
  cutoutDepth: number;
}

/** Width and bottom of each cutout, after clamping to the wall. */
export function cutoutSize(o: CutoutOpts, length: number, top: number, zMin: number) {
  const width = Math.min(o.cutoutWidth * (length - 2 * WALL), length - 2 * BASE_TOP_RADIUS - 2);
  const bottom = Math.max(zMin, top - o.cutoutDepth);
  return { width, bottom };
}

/**
 * Cutters for the selected walls. `zMin` is the lowest the cutout may reach
 * (above the floor or the top of a pocket fill).
 */
export function wallCutouts(w: Wasm, s: Scope, o: CutoutOpts, W: number, D: number, top: number, zMin: number): Manifold[] {
  const out: Manifold[] = [];
  for (const f of frames(o.cutoutWalls, W, D)) {
    const { width, bottom } = cutoutSize(o, f.length, top, zMin);
    const depth = top - bottom;
    if (width < 4 || depth < 1) continue;
    const r = Math.min(width / 2, depth) - 0.01;
    // Deep enough to clear the lip support and any lip notch cusps on the inside.
    const v0 = -1;
    const v1 = Math.max(LIP_DEPTH, BASE_TOP_RADIUS) + 0.6;
    const hw = width / 2;
    const parts: Manifold[] = [
      rod(w, s, -hw + r, bottom + r, r, v0, v1),
      rod(w, s, hw - r, bottom + r, r, v0, v1),
      s.t(boxAt(w, -hw, v0, bottom + r, hw, v1, top + 1)),
    ];
    out.push(place(s, s.t(w.Manifold.hull(parts)), f));
  }
  return out;
}

export interface SlideOpts {
  slideWalls: WallMask;
  slideRadius: number;
}

/**
 * Finger-slide material for the selected walls: a block along the inside of
 * the wall with a quarter-cylinder taken out, sitting on `zFloor`. Callers
 * take it out of the interior cut, so it only appears where the bin is open.
 */
export function fingerSlides(w: Wasm, s: Scope, o: SlideOpts, W: number, D: number, zFloor: number, maxR: number): Manifold[] {
  const out: Manifold[] = [];
  for (const f of frames(o.slideWalls, W, D)) {
    const r = Math.min(o.slideRadius, maxR);
    if (r < 1) continue;
    const hl = f.length / 2;
    const v0 = WALL - 0.5; // overlap into the wall
    const v1 = WALL + r;
    const block = s.t(boxAt(w, -hl, v0, zFloor - 1, hl, v1, zFloor + r));
    const cyl = s.t(s.t(w.Manifold.cylinder(f.length + 2, r, r, SEGS * 2)).rotate([0, 90, 0]).translate([-hl - 1, v1, zFloor + r]));
    out.push(place(s, s.t(block.subtract(cyl)), f));
  }
  return out;
}
