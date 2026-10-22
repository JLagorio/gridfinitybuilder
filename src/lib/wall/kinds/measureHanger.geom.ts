import type { Manifold } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import type { AttachmentBuilder } from '../build';
import { MEASURE, measurePlan, type MBox, type MeasureHangerOptions } from './measureHanger';

export const measureHangerBuilder: AttachmentBuilder<MeasureHangerOptions> = {
  body(w, s, o, layout) {
    const W = layout.w;
    const H = layout.h;
    const p = measurePlan(o);
    const box = (b: MBox) => s.t(boxAt(w, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1));
    const t = MEASURE.wall;
    const parts: Manifold[] = [s.t(boxAt(w, 0, 0, 0, W, H, MEASURE.back)), s.t(boxAt(w, 0, 0, 0, W, p.floor, p.d))];
    const cuts: Manifold[] = p.slots.map(box);
    if (p.pocket) {
      const q = p.pocket;
      // Walls round the pocket, the front one lower.
      parts.push(box({ x0: Math.max(0, q.x0 - t), x1: Math.min(W, q.x1 + t), y0: 0, y1: p.top, z0: 0, z1: p.d }));
      cuts.push(box(q), box({ x0: q.x0, x1: q.x1, y0: p.front, y1: p.top + 1, z0: q.z1 - 0.5, z1: p.d + 1 }));
    }
    return s.t(s.t(w.Manifold.union(parts)).subtract(s.t(w.Manifold.union(cuts))));
  },
};
