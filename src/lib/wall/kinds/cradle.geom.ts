import type { Manifold } from '../../geometry/kernel';
import { boxAt, cylinderAt, roundedRectRing } from '../../geometry/shapes';
import { prismX, prismY } from '../mount';
import type { AttachmentBuilder } from '../build';
import { CRADLE, cradlePocket, type CradleOptions } from './cradle';

/** Front lip height (share of the pocket, at least 8 mm), the corners an open front keeps, the wall under a U cut-out and a notch; mm. */
const LIP = { share: 0.25, min: 8, corner: 8, under: 4 } as const;

export const cradleBuilder: AttachmentBuilder<CradleOptions> = {
  body(w, s, o, layout) {
    const W = layout.w;
    const H = layout.h;
    const D = layout.depth;
    const p = cradlePocket(o);
    const top = p.y0 + p.h;
    const iw = p.x1 - p.x0;
    const id = p.z1 - p.z0;
    const body = s.t(w.Manifold.union([s.t(boxAt(w, 0, 0, 0, W, H, CRADLE.back)), s.t(boxAt(w, 0, 0, 0, W, top, D))]));
    const cuts: Manifold[] = [s.t(boxAt(w, p.x0, p.y0, p.z0, p.x1, top + 1, p.z1))];
    // The front: the corners only, a low lip, or a U cut-out down to near the floor.
    const fz = p.z1 - 1;
    if (o.front === 'lip') cuts.push(s.t(boxAt(w, p.x0, p.y0 + Math.min(p.h, Math.max(LIP.min, LIP.share * p.h)), fz, p.x1, top + 1, D + 1)));
    else if (o.front === 'open') {
      const c = Math.min(LIP.corner, iw / 4);
      cuts.push(s.t(boxAt(w, p.x0 + c, p.y0, fz, p.x1 - c, top + 1, D + 1)));
    } else {
      const r = Math.max(3, Math.min(0.3 * iw, iw / 2 - 4));
      const cy = p.y0 + LIP.under + r;
      const cx = W / 2;
      cuts.push(s.t(cylinderAt(w, cx, cy, fz, D + 1, r)));
      if (cy < top + 1) cuts.push(s.t(boxAt(w, cx - r, cy, fz, cx + r, top + 1, D + 1)));
    }
    if (o.cable) {
      // A slot through the floor for a charging cable, its ends round.
      const cw = Math.max(6, Math.min(14, iw - 4));
      const cl = Math.max(6, Math.min(30, id - 4));
      const zm = (p.z0 + p.z1) / 2;
      const ring = roundedRectRing(W / 2 - cw / 2, zm - cl / 2, W / 2 + cw / 2, zm + cl / 2, Math.min(cw, cl) / 2 - 0.01);
      cuts.push(
        prismY(
          w,
          s,
          ring.map(([x, z]) => [x, -z]),
          -1,
          p.y0 + 2,
        ),
      );
    }
    if (o.notches && id >= 8) {
      // A U notch in each side wall, halfway out, down to near the floor.
      const r = Math.min(5, id / 2 - 2);
      const zm = (p.z0 + p.z1) / 2;
      const cy = p.y0 + LIP.under + r;
      for (const [x0, x1] of [
        [-1, p.x0 + 1],
        [p.x1 - 1, W + 1],
      ]) {
        cuts.push(
          prismX(
            w,
            s,
            [
              [-zm - r, cy],
              [-zm - r, top + 1],
              [-zm + r, top + 1],
              [-zm + r, cy],
            ],
            x0,
            x1 - x0,
          ),
        );
        cuts.push(s.t(s.t(s.t(cylinderAt(w, 0, 0, x0, x1, r)).rotate([0, 90, 0])).translate([0, cy, zm])));
      }
    }
    return s.t(body.subtract(s.t(w.Manifold.union(cuts))));
  },
};
