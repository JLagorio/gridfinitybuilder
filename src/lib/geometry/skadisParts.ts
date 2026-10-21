/**
 * A Skådis board's parts besides its tiles, joint plates and spacers
 * (skadis.ts plans them all): the frame strips round its front, and the parts
 * it hangs from when it isn't screwed to the wall: French cleats, door hooks,
 * desk feet and desk clamps. Built by the geometry worker, each with its min
 * corner at the origin in its print pose.
 *
 * A frame strip prints front face down, its pins up. A hanging part is a
 * profile in (z, y) (z out from the wall, y up it) run along x: the board's
 * cleat prints as it hangs, its wall side on the bed, so its 45° edge faces
 * up; the wall's cleat prints face down for the same reason, its countersinks
 * opening toward the bed like the tiles'; hooks, feet and clamps print on
 * their side, the profile flat on the bed, so the layers run round their bends.
 */
import type { CrossSection } from 'manifold-3d';
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec2, type Wasm } from './kernel';
import { cylinderAt, roundedRectRing } from './shapes';
import type { SkadisHangPart, SkadisRimPart } from './skadis';

/** Its min corner to the origin, checked, as a mesh. */
function placed(s: Scope, m: Manifold, what: string): MeshData {
  const b = m.boundingBox();
  const out = s.t(m.translate([-b.min[0], -b.min[1], -b.min[2]]));
  assertValid(out, what);
  return toMeshData(out);
}

/**
 * A frame strip: built where it sits on the board's front (its pins down into
 * the border), then turned face down, its box's corner (not the rounded end
 * of a corner strip's) at the origin, so it goes where it's planned.
 */
export function buildSkadisRim(w: Wasm, p: SkadisRimPart): MeshData {
  const s = new Scope();
  try {
    // Its box, inside the board's rounded corners.
    const board = s.t(new w.CrossSection([roundedRectRing(0, 0, p.W, p.H, p.R)], 'NonZero'));
    const box: Vec2[] = [
      [p.x0, p.y0],
      [p.x1, p.y0],
      [p.x1, p.y1],
      [p.x0, p.y1],
    ];
    const parts: Manifold[] = [s.t(s.t(board.intersect([box])).extrude(p.height))];
    const tip = Math.min(0.3, p.pinH / 3);
    for (const [x, y] of p.pins) {
      parts.push(s.t(cylinderAt(w, x, y, -p.pinH + tip, 0.01, p.pinD / 2, p.pinD / 2, 24)));
      parts.push(s.t(cylinderAt(w, x, y, -p.pinH, -p.pinH + tip + 0.01, p.pinD / 2 - tip, p.pinD / 2, 24)));
    }
    // (x, y, z) → (x, −y, −z), then the box's corner to the origin.
    const down = s.t(s.t(s.t(w.Manifold.union(parts)).rotate([180, 0, 0])).translate([-p.x0, p.y1, p.height]));
    assertValid(down, 'Skådis frame strip');
    return toMeshData(down);
  } finally {
    s.dispose();
  }
}

/** A polygon in (z, y) run along x from x0 to x1 (profile z stays z). */
function alongX(s: Scope, cs: CrossSection, x0: number, x1: number): Manifold {
  // (−z, y) extruded up, then turned a quarter about y: (X, Y, Z) → (Z, Y, −X).
  return s.t(s.t(s.t(cs.extrude(x1 - x0)).rotate([0, 90, 0])).translate([x0, 0, 0]));
}

const mirrored = (pts: Vec2[]): Vec2[] => pts.map(([z, y]) => [-z, y] as Vec2).reverse();

/** A part the board hangs from (SkadisHangPart), in its print pose. */
export function buildSkadisHang(w: Wasm, p: SkadisHangPart): MeshData {
  const s = new Scope();
  try {
    let body = alongX(s, s.t(new w.CrossSection([mirrored(p.profile)], 'Positive')), 0, p.len);
    const cuts: Manifold[] = [];
    for (const h of p.holes) {
      cuts.push(s.t(cylinderAt(w, h.x, h.y, h.z0, h.z1, h.d / 2, h.d / 2, 32)));
      // Countersunk at the face it ends 1 mm past.
      if (h.sink) cuts.push(s.t(cylinderAt(w, h.x, h.y, h.z1 - 1 - (h.sink - h.d) / 2, h.z1 - 0.7, h.d / 2, h.sink / 2 + 0.3, 48)));
    }
    if (p.bolt) {
      // M6: the bolt up through the lower jaw, its nut in a pocket at the top (a corner up as printed, so it needs no support).
      const b = p.bolt;
      const up = (r: number, y0: number, y1: number, segs: number) =>
        s.t(s.t(s.t(w.Manifold.cylinder(y1 - y0, r, r, segs)).rotate([-90, 0, 0])).translate([b.x, y0, b.z]));
      cuts.push(up(3.3, b.y0 - 1, b.y1 + 1, 32), up(10.4 / Math.sqrt(3), b.y1 - 5.5, b.y1 + 1, 6));
    }
    if (p.window) {
      // A window through a foot, leaving 6 mm walls.
      const win = s.t(s.t(new w.CrossSection([mirrored(p.window)], 'Positive')).offset(-6, 'Round', 2, 16));
      if (!win.isEmpty()) cuts.push(alongX(s, win, -1, p.len + 1));
    }
    if (cuts.length) body = s.t(body.subtract(s.t(w.Manifold.union(cuts))));
    const turned = p.pose === 'back' ? body : s.t(body.rotate(p.pose === 'front' ? [180, 0, 0] : [0, 90, 0]));
    return placed(s, turned, `Skådis ${p.kind}`);
  } finally {
    s.dispose();
  }
}
