import type { Manifold } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import type { AttachmentBuilder } from '../build';
import { CUP_BACK, type CupOptions } from './cup';

export const cupBuilder: AttachmentBuilder<CupOptions> = {
  body(w, s, o, layout) {
    const R = o.diameter / 2 + o.wall;
    const H = layout.h;
    const parts = [s.t(boxAt(w, 0, 0, 0, layout.w, H, CUP_BACK))];
    const holes: Manifold[] = [];
    for (let k = 0; k < o.count; k++) {
      const cx = R + k * (2 * R + o.gap);
      const cz = CUP_BACK + R - o.wall;
      // A web joins each cup to the strip.
      const upright = (m: Manifold) => s.t(s.t(s.t(m).rotate([-90, 0, 0])).translate([cx, 0, cz]));
      parts.push(upright(cylinderAt(w, 0, 0, 0, H, R, R, 64)));
      parts.push(s.t(boxAt(w, cx - R * 0.6, 0, 0, cx + R * 0.6, H, cz)));
      const z0 = o.bottom === 'open' ? -1 : Math.min(2, H / 4);
      holes.push(upright(cylinderAt(w, 0, 0, z0, H + 1, o.diameter / 2, o.diameter / 2, 64)));
    }
    const body = s.t(w.Manifold.union(parts));
    return s.t(body.subtract(s.t(w.Manifold.union(holes))));
  },
};
