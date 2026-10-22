import type { Manifold } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import type { AttachmentBuilder } from '../build';
import { COMB, combSize, type CableCombOptions } from './cableComb';

export const cableCombBuilder: AttachmentBuilder<CableCombOptions> = {
  body(w, s, o, layout) {
    const { r, zc, Z, W } = combSize(o);
    const comb = s.t(w.Manifold.union([s.t(boxAt(w, 0, 0, 0, W, layout.h, COMB.back)), s.t(boxAt(w, 0, 0, 0, W, COMB.plate, Z))]));
    // Keyholes through the comb (up the wall): a round seat and a mouth 90% of the cable wide out to the front.
    const holes: Manifold[] = [];
    for (let k = 0; k < o.count; k++) {
      const x = (W - o.count * 2 * r - (o.count - 1) * o.gap) / 2 + r + k * (2 * r + o.gap);
      const seat = s.t(cylinderAt(w, 0, 0, -1, COMB.plate + 1, r, r, 48));
      holes.push(s.t(s.t(seat.rotate([-90, 0, 0])).translate([x, 0, zc])));
      holes.push(s.t(boxAt(w, x - 0.45 * o.diameter, -1, zc, x + 0.45 * o.diameter, COMB.plate + 1, Z + 1)));
    }
    return s.t(comb.subtract(s.t(w.Manifold.union(holes))));
  },
};
