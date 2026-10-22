import type { CrossSection } from 'manifold-3d';
import type { Manifold, Scope, Vec2, Vec3, Wasm } from '../../geometry/kernel';
import { boxAt, roundedRectRing } from '../../geometry/shapes';
import { ccw, prismX } from '../mount';
import type { AttachmentBuilder } from '../build';
import type { AttachmentLayout } from '../registry';
import { RACK, bottleSpec, neckRadius, rackLip, rackPlan, type BottleRackOptions, type RackSpec } from './bottleRack';

/** Segments round a cup (a multiple of 4, so its front, back and sides are vertices). */
const SEGS = 48;
/** Far enough along a cup to be past the bed or the top, mm. */
const FAR = 400;

/**
 * A prism along a tilted axis: `cs` (its +y toward the board) extruded from `t0` to `t1` along the axis, which goes
 * through `at` and leans `deg` toward the front (+z) from straight up (negative: toward the board).
 */
export function tiltedPrism(w: Wasm, s: Scope, cs: CrossSection | Vec2[][], t0: number, t1: number, at: Vec3, deg: number): Manifold {
  const e = s.t(w.Manifold.extrude(Array.isArray(cs) ? cs.map(ccw) : cs, t1 - t0));
  return s.t(s.t(s.t(e.translate([0, 0, t0])).rotate([deg - 90, 0, 0])).translate(at));
}

/** A cone (radius r0 at t0 to r1 at t1) along the same tilted axis. */
function tiltedCone(w: Wasm, s: Scope, r0: number, r1: number, t0: number, t1: number, at: Vec3, deg: number): Manifold {
  const c = s.t(w.Manifold.cylinder(t1 - t0, r0, r1, SEGS));
  return s.t(s.t(s.t(c.translate([0, 0, t0])).rotate([deg - 90, 0, 0])).translate(at));
}

/** A cup's section, half-size `r` (a circle, or a square with its corners rounded). */
function cupSection(w: Wasm, s: Scope, spec: RackSpec, r: number, corner: number): CrossSection {
  if (spec.shape === 'round') return s.t(w.CrossSection.circle(r, SEGS));
  return s.t(new w.CrossSection([ccw(roundedRectRing(-r, -r, r, r, Math.min(Math.max(corner, 0), r - 0.01)))], 'Positive'));
}

/**
 * The hollow under a floor: the tube's inside, closing in at 45° (a cone about the upright through the axis at
 * `top`) to a flat top of radius `rt` at `top`, so it prints like a pointed arch.
 */
function hollow(w: Wasm, s: Scope, inside: Manifold, x: number, z: number, top: number, rt: number): Manifold {
  const h = top + FAR / 4;
  const cone = s.t(s.t(s.t(w.Manifold.cylinder(h, rt + h, rt, SEGS)).rotate([-90, 0, 0])).translate([x, top - h, z]));
  return s.t(inside.intersect(cone));
}

/** The rack in its frame: the back plate, the tubes, their floors and the label strip. */
export function rackBody(w: Wasm, s: Scope, spec: RackSpec, layout: AttachmentLayout): Manifold {
  const p = rackPlan(spec, layout.w);
  const W = layout.w;
  const H = layout.h;
  const D = layout.depth;
  const B = RACK.back;
  const t = spec.tilt * (Math.PI / 180);
  const [cos, tan] = [Math.cos(t), Math.tan(t)];
  const deg = spec.tilt;
  const wall = spec.wall;
  const solids: Manifold[] = [s.t(boxAt(w, 0, 0, 0, W, H, B))];
  const cuts: Manifold[] = [];
  for (const c of p.cups) {
    const at: Vec3 = [c.x, c.y, c.z];
    // Down past the bed from the seat, along the cup.
    const down = -(c.y + c.r + wall + 2) / cos - 2;
    solids.push(tiltedPrism(w, s, cupSection(w, s, spec, c.r + wall, spec.corner + wall), down, spec.cup, at, deg));
    const inside = cupSection(w, s, spec, c.r, spec.corner);
    cuts.push(tiltedPrism(w, s, inside, 0, FAR, at, deg));
    // Where the axis meets height y.
    const axisZ = (y: number) => c.z + (y - c.y) * tan;
    if (spec.floor === 'ring') {
      cuts.push(tiltedPrism(w, s, inside, down, 0.01, at, deg));
      continue;
    }
    const below = tiltedPrism(w, s, inside, down, 0, at, deg);
    if (spec.floor === 'neck') {
      // A 45° funnel down to the neck hole, which goes on down through.
      const rn = neckRadius(spec, c.r);
      const tn = -(c.r - rn);
      cuts.push(tiltedCone(w, s, rn, c.r, tn, 0.01, at, deg));
      cuts.push(tiltedPrism(w, s, s.t(w.CrossSection.circle(rn, SEGS)), down, tn + 0.01, at, deg));
      const top = c.y + tn * cos - RACK.floor - rn * tan;
      cuts.push(hollow(w, s, below, c.x, axisZ(top), top, rn));
      continue;
    }
    // Closed: the hollow's 10 mm top is bridged. A hole: a lip round it, the hole on through to the hollow.
    const rt = spec.floor === 'closed' ? Math.min(RACK.bridge, c.r) : c.r - rackLip(c.r);
    const top = c.y - RACK.floor - rt * tan;
    cuts.push(hollow(w, s, below, c.x, axisZ(top), top, rt));
    if (spec.floor === 'hole') cuts.push(tiltedPrism(w, s, s.t(w.CrossSection.circle(rt, SEGS)), down, 0.01, at, deg));
  }
  if (spec.label) {
    // A strip along the front, its face at 45° (a label reads from above), standing on the bed in front of the front
    // row and no higher than its rims.
    const front = p.cups.filter((c) => c.z === p.cups[0].z);
    const rimLow = Math.min(...front.map((c) => c.y + spec.cup * cos - (c.r + wall) * Math.sin(t))) - 0.5;
    const yc = Math.max(1, Math.min(p.zf - p.zl, rimLow));
    const pts: Vec2[] = [
      [-p.zl, 0],
      [-p.zf, 0],
      [-(p.zf - yc), yc],
      [-p.zl, yc],
    ];
    solids.push(prismX(w, s, pts, 0, W));
  }
  const body = s.t(s.t(w.Manifold.union(solids)).intersect(s.t(boxAt(w, 0, 0, 0, W, H, D))));
  // Nothing cuts into the back plate.
  const holes = s.t(s.t(w.Manifold.union(cuts)).intersect(s.t(boxAt(w, -1, -1, B, W + 1, H + 1, D + 1))));
  return s.t(body.subtract(holes));
}

export const bottleRackBuilder: AttachmentBuilder<BottleRackOptions> = {
  body: (w, s, o, layout) => rackBody(w, s, bottleSpec(o), layout),
};
