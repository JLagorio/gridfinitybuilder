import type { Manifold, Vec2, Vec3 } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX } from '../mount';
import type { AttachmentBuilder } from '../build';
import { tiltedPrism } from './bottleRack.geom';
import { HOLSTER, holsterGeometry, obround, type HolsterOptions } from './holster';

/** Far enough along the ring's axis to be past the bed, mm. */
const FAR = 400;

/** A rectangle in the ring's plane: across u0..u1, toward the board v0..v1. */
const rect = (u0: number, v0: number, u1: number, v1: number): Vec2[] => [
  [u0, v0],
  [u1, v0],
  [u1, v1],
  [u0, v1],
];

/** How far toward the board an obround's edge is at `u` across (its back edge; the front is the same forward). */
function edgeAt(wid: number, dep: number, u: number): number {
  const r = Math.min(wid, dep) / 2;
  const off = Math.max(0, Math.abs(u) - (wid / 2 - r));
  return dep / 2 - r + Math.sqrt(Math.max(0, r * r - off * off));
}

export const holsterBuilder: AttachmentBuilder<HolsterOptions> = {
  body(w, s, o, layout, ctx) {
    const g = holsterGeometry(o, ctx);
    const W = layout.w;
    const H = layout.h;
    const D = layout.depth;
    const B = HOLSTER.back;
    const xc = W / 2;
    const at: Vec3 = [xc, g.oy, g.oz];
    const deg = -o.tilt;
    // Along the axis from the ring's top (t = 0) down past the bed.
    const prism = (pts: Vec2[], t0 = -FAR, t1 = 0) => tiltedPrism(w, s, [pts], t0, t1, at, deg);
    const solids: Manifold[] = [
      s.t(boxAt(w, 0, 0, 0, W, H, B)),
      prism(obround(g.ow, g.od)),
      // The ring's back half joined to the plate.
      prism(rect(-g.ow / 2, 0, g.ow / 2, FAR)),
    ];
    // A 45° gusset each side, from the bed, on the part joining the ring to the plate.
    const tan = Math.tan(o.tilt * (Math.PI / 180));
    const top = (z: number) => o.ring + (z - B) * tan;
    const gs = Math.max(0, Math.min(H - o.ring - 2, 0.75 * (g.oz - B), 60));
    if (gs > 2) {
      const pts: Vec2[] = [
        [-(B - 1), 0],
        [-(B + gs), 0],
        [-(B + gs), top(B + gs)],
        [-B, o.ring + gs],
        [-(B - 1), o.ring + gs],
      ];
      for (const x of [xc - g.ow / 2, xc + g.ow / 2 - HOLSTER.gusset]) solids.push(prismX(w, s, pts, x, HOLSTER.gusset));
    }
    let body = s.t(s.t(w.Manifold.union(solids)).intersect(s.t(boxAt(w, 0, 0, 0, W, H, D))));
    // The opening and the slot, up through the top (not on up into the plate), and the cord notch at the back.
    const cuts = [prism(obround(g.cw, g.cd), -FAR, 1)];
    if (g.slot > 0) cuts.push(prism(rect(-g.slot / 2, -FAR, g.slot / 2, 0), -FAR, 1));
    const notch = Math.min(HOLSTER.cord, g.gap - 2);
    if (o.cord && notch > 1) cuts.push(prism(rect(-HOLSTER.cord / 2, 0, HOLSTER.cord / 2, g.cd / 2 + notch), -FAR, 1));
    const holes = s.t(s.t(w.Manifold.union(cuts)).intersect(s.t(boxAt(w, -1, -1, B, W + 1, H + 1, D + 1))));
    body = s.t(body.subtract(holes));
    if (!o.heat) return body;
    // Heat-safe: ribs the tool rests against, back to the opening's size, air between; none in the slot or the notch.
    const { ribW, rib } = HOLSTER;
    const c = g.cw / 2;
    // One each side, two at the back and two at the front, each from the grown opening's edge in to the tool's size.
    const side = c - rib;
    const ribs = [prism(rect(-c - 0.5, -ribW / 2, -side, ribW / 2)), prism(rect(side, -ribW / 2, c + 0.5, ribW / 2))];
    for (const u of [-c / 2, c / 2]) {
      // Its face where the tool's outline is furthest out across the rib, its root past the grown opening's edge.
      const near = Math.abs(u) - ribW / 2;
      const face = edgeAt(o.width, o.depth, near);
      const root = edgeAt(g.cw, g.cd, near) + 0.5;
      const x0 = u - ribW / 2;
      const x1 = u + ribW / 2;
      if (!o.cord || near > HOLSTER.cord / 2) ribs.push(prism(rect(x0, face, x1, root)));
      if (near > g.slot / 2) ribs.push(prism(rect(x0, -root, x1, -face)));
    }
    const r = s.t(s.t(w.Manifold.union(ribs)).intersect(s.t(boxAt(w, 0, 0, B, W, H, D))));
    return s.t(w.Manifold.union([body, r]));
  },
};
