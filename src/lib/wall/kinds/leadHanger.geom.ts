/**
 * Lead hanger geometry (planning in leadHanger.ts): a ledge at the foot of a
 * back plate, braced by gussets, with a keyhole per lead cut straight down
 * through it: a hole for the cable, a slot from it out through the front,
 * and a pocket round the hole for the plug, its mouth chamfered.
 */
import type { Manifold, Scope, Wasm } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import type { AttachmentBuilder } from '../build';
import { cornerGusset } from './shelf.geom';
import { LEAD, leadPlan, type LeadHangerOptions } from './leadHanger';

/** The pocket's chamfer, mm. */
const CHAMFER = 1;

/** Upright cylinder (along y) at (x, z) from y0 to y1, radius r0 at the bottom and r1 at the top. */
function upright(w: Wasm, s: Scope, x: number, z: number, y0: number, y1: number, r0: number, r1: number): Manifold {
  return s.t(s.t(s.t(cylinderAt(w, 0, 0, 0, y1 - y0, r0, r1, 48)).rotate([-90, 0, 0])).translate([x, y0, z]));
}

export const leadHangerBuilder: AttachmentBuilder<LeadHangerOptions> = {
  body(w, s, o, layout) {
    const p = leadPlan(o);
    const H = layout.h;
    const { W, D, t, zc } = p;
    const B = LEAD.back;
    const g = Math.min(D - B, H - t, 40);
    const body = s.t(
      w.Manifold.union([
        s.t(boxAt(w, 0, 0, 0, W, H, B)),
        s.t(boxAt(w, 0, 0, 0, W, t, D)),
        cornerGusset(w, s, B, t, Math.min(LEAD.fillet, H - t - 0.5), 0, W),
        cornerGusset(w, s, B, t, g, 0, LEAD.end),
        cornerGusset(w, s, B, t, g, W - LEAD.end, LEAD.end),
      ]),
    );
    const cuts: Manifold[] = [];
    const r = o.pocket / 2;
    const h = o.slot / 2;
    for (const x of p.xs) {
      cuts.push(
        upright(w, s, x, zc, t - o.depth, t + 1, r, r),
        upright(w, s, x, zc, t - CHAMFER, t + 0.01, r, r + CHAMFER + 0.01),
        upright(w, s, x, zc, -1, t + 1, h, h),
        s.t(boxAt(w, x - h, -1, zc, x + h, t + 1, D + 1)),
      );
    }
    return s.t(body.subtract(s.t(w.Manifold.union(cuts))));
  },
};
