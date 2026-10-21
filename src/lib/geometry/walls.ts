/**
 * Outer-wall features.
 *
 * - Wall cutouts (Gridfinity Extended `wallcutout`): a U-shaped notch from the
 *   top of a wall down, with rounded bottom corners, for reaching in from the
 *   side.
 * - Finger slides (Extended `fingerslide`): a concave quarter-round where the
 *   floor meets a wall, so small parts slide up and out.
 * - Hex wall pattern (Extended `wallpattern` hexgrid): staggered hexagonal
 *   holes through the wall, points up so they print without support.
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

/** How far a cutout reaches in from the wall's outer face: deep enough to clear the lip support and any lip notch cusps on the inside. */
export const CUTOUT_REACH = Math.max(LIP_DEPTH, BASE_TOP_RADIUS) + 0.6;

/** Width and bottom of each cutout, after clamping to the wall. */
export function cutoutSize(o: CutoutOpts, length: number, top: number, zMin: number) {
  const width = Math.min(o.cutoutWidth * (length - 2 * WALL), length - 2 * BASE_TOP_RADIUS - 2);
  const bottom = Math.max(zMin, top - o.cutoutDepth);
  return { width, bottom };
}

/** The back wall's cutout as `wallCutouts` cuts it (same arguments, W = the bin's outer width): its span along X and its bottom. */
export function backCutout(o: CutoutOpts, W: number, top: number, zMin: number): { x0: number; x1: number; z: number } | null {
  if (!o.cutoutWalls.includes('b')) return null;
  const { width, bottom } = cutoutSize(o, W, top, zMin);
  if (width < 4 || top - bottom < 1) return null;
  return { x0: -width / 2, x1: width / 2, z: bottom };
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
    const v0 = -1;
    const v1 = CUTOUT_REACH;
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

export interface PatternOpts extends CutoutOpts {
  patternWalls: WallMask;
  patternSize: number;
  patternWeb: number;
}

/**
 * Hex holes through the selected walls between `zLow` and `zHigh`, staggered
 * rows with `patternWeb` of plastic between holes, clear of the corners and of
 * any wall cutout on the same wall.
 */
export function wallPattern(
  w: Wasm,
  s: Scope,
  o: PatternOpts,
  W: number,
  D: number,
  top: number,
  zLow: number,
  zHigh: number,
  /** Areas left solid (a front label): wall, u range along it from its middle, z range. */
  keepOut: { wall: Wall; u0: number; u1: number; z0: number; z1: number }[] = [],
): Manifold[] {
  const out: Manifold[] = [];
  const af = o.patternSize; // across flats, horizontal
  const R = af / Math.sqrt(3); // circumradius = half the hole's height
  const px = af + o.patternWeb;
  const pz = (px * Math.sqrt(3)) / 2;
  const v0 = -1;
  const v1 = WALL + 0.3;
  for (const f of frames(o.patternWalls, W, D)) {
    const half = f.length / 2 - BASE_TOP_RADIUS - o.patternWeb - af / 2; // furthest hole center from the middle
    const z0 = zLow + o.patternWeb + R;
    const z1 = zHigh - o.patternWeb - R;
    if (half < 0 || z1 < z0) continue;
    const rows = Math.floor((z1 - z0) / pz + 1e-9) + 1;
    const zOff = (z1 - z0 - (rows - 1) * pz) / 2;
    const cut = f.wall && o.cutoutWalls.includes(f.wall) ? cutoutSize(o, f.length, top, zLow) : null;
    const holes: Manifold[] = [];
    for (let j = 0; j < rows; j++) {
      const z = z0 + zOff + j * pz;
      // Rows centered on the middle of the wall; odd rows shifted half a pitch.
      const off = j % 2 ? px / 2 : 0;
      const kMax = Math.floor((half - off) / px + 1e-9);
      for (let k = -kMax - (off ? 1 : 0); k <= kMax; k++) {
        const u = k * px + off;
        if (Math.abs(u) > half + 1e-9) continue;
        // Skip holes that would run into a cutout on this wall.
        if (cut && Math.abs(u) < cut.width / 2 + o.patternWeb + af / 2 && z + R > cut.bottom - o.patternWeb) continue;
        if (keepOut.some((k) => k.wall === f.wall && u + af / 2 > k.u0 && u - af / 2 < k.u1 && z + R > k.z0 && z - R < k.z1)) continue;
        holes.push(s.t(s.t(s.t(w.Manifold.cylinder(v1 - v0, R, R, 6)).rotate([0, 0, 90]).rotate([-90, 0, 0])).translate([u, v0, z])));
      }
    }
    if (holes.length) out.push(place(s, s.t(w.Manifold.union(holes)), f));
  }
  return out;
}
