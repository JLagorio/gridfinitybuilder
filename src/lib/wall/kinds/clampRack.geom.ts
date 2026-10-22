import type { Manifold, Vec2 } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismY } from '../mount';
import type { AttachmentBuilder } from '../build';
import { cornerGusset } from './shelf.geom';
import { CLAMP, clampPlan, type ClampRackOptions } from './clampRack';

export const clampRackBuilder: AttachmentBuilder<ClampRackOptions> = {
  body(w, s, o, layout) {
    const W = layout.w;
    const H = layout.h;
    const p = clampPlan(o);
    const D = p.D;
    const B = CLAMP.back;
    const L = CLAMP.ledge;
    const size = Math.min(D - B - 2, H - L - 2, 50);
    const parts: Manifold[] = [
      s.t(boxAt(w, 0, 0, 0, W, H, B)),
      s.t(boxAt(w, 0, 0, 0, W, L, D)),
      cornerGusset(w, s, B, L, CLAMP.fillet, 0, W),
      ...p.gussets.map((x) => cornerGusset(w, s, B, L, size, x, CLAMP.gusset)),
    ];
    // The spring clamps' rail along the front, room behind it for their back jaws.
    if (p.rail) parts.push(s.t(boxAt(w, p.rail.x0, 0, D - o.edge, p.rail.x1, L + CLAMP.rail, D)));
    const body = s.t(w.Manifold.union(parts));
    // Slots open at the front, their mouths flared at 45°; prismY's polygon is in (x, d), d behind the board's front.
    const m = CLAMP.mouth;
    const cuts = p.slots.map((x) => {
      const h = p.slotW / 2;
      const pts: Vec2[] = [
        [x - h, -p.z0],
        [x + h, -p.z0],
        [x + h, -(D - m)],
        [x + h + m + 1, -(D + 1)],
        [x - h - m - 1, -(D + 1)],
        [x - h, -(D - m)],
      ];
      return prismY(w, s, pts, -1, L + 2);
    });
    return s.t(body.subtract(s.t(w.Manifold.union(cuts))));
  },
};
