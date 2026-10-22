import type { Manifold, Vec2 } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX } from '../mount';
import type { AttachmentBuilder } from '../build';
import { TAB, tabPlan, type ClipTabOptions } from './clipTab';
import { zy } from './saddle.geom';

export const clipTabBuilder: AttachmentBuilder<ClipTabOptions> = {
  body(w, s, o, layout, ctx) {
    const p = tabPlan(o, ctx);
    const B = TAB.back;
    const z0 = B + o.gap;
    const z1 = z0 + o.thick;
    const top = TAB.foot + o.length;
    const c = Math.min(1.2, o.thick / 2 - 0.4);
    // The tongue's side view: a foot back to the back plate, the chamfered top, the bump into the gap.
    const pts: Vec2[] = [
      [B - 0.5, 0],
      [z1, 0],
      [z1, top - c],
      [z1 - c, top],
      [z0 + c, top],
      [z0, top - c],
    ];
    if (p.bump > 0) pts.push([z0, p.bumpY + p.bump], [z0 - p.bump, p.bumpY], [z0, p.bumpY - p.bump]);
    pts.push([z0, TAB.foot], [B - 0.5, TAB.foot]);
    const parts: Manifold[] = [s.t(boxAt(w, 0, 0, 0, layout.w, layout.h, B))];
    for (const x of p.xs) parts.push(prismX(w, s, zy(pts), x - o.width / 2, o.width));
    return s.t(w.Manifold.union(parts));
  },
};
