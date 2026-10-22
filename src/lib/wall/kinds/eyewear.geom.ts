import type { Manifold, Vec2 } from '../../geometry/kernel';
import { prismX } from '../mount';
import type { AttachmentBuilder } from '../build';
import { EYE, eyeShape, type EyewearOptions } from './eyewear';
import { frontCut, zy } from './saddle.geom';

export const eyewearBuilder: AttachmentBuilder<EyewearOptions> = {
  body(w, s, o, layout, ctx) {
    const B = EYE.back;
    const a = EYE.arm;
    const W = layout.w;
    const H = layout.h;
    const e = eyeShape(o, ctx);
    const { R, t } = e;
    const side = (pts: Vec2[]) => prismX(w, s, zy(pts), 0, W);
    const parts: Manifold[] = [
      side([
        [0, 0],
        [B, 0],
        [B, H],
        [0, H],
      ]),
    ];
    const gz = e.brace / (1 - t);
    for (const yb of e.arms) {
      const y = (z: number) => yb + (z - B) * t;
      // The arm, and a 45° brace under it from the back.
      parts.push(
        side([
          [B - 0.5, yb],
          [R, y(R)],
          [R, y(R) + a],
          [B - 0.5, yb + a],
        ]),
        side([
          [B - 0.5, yb - e.brace],
          [B + gz, y(B + gz)],
          [B + gz, y(B + gz) + 1],
          [B - 0.5, yb + 1],
        ]),
      );
      const top = e.tipTop(yb);
      if (o.style === 'temple') {
        // The lip in front of the slot, its inner top edge chamfered to guide the temple in.
        const z0 = R - EYE.lipT;
        const c = Math.min(1.5, EYE.lipT / 2);
        parts.push(
          side([
            [z0, yb + 0.5],
            [R, yb + 0.5],
            [R, top],
            [z0 + c, top],
            [z0, top - c],
          ]),
        );
        continue;
      }
      // A nose (its sides at 45°, a flat crest) or a lip at the end of the arm.
      const z0 = R - EYE.tipT;
      const tip = side([
        [z0, y(z0) + a - 1],
        [R, y(R) + a - 1],
        [R, top - 1],
        [R - 1, top],
        [z0 + 1, top],
        [z0, top - 1],
      ]);
      if (o.style === 'strap') parts.push(tip);
      else parts.push(s.t(tip.intersect(frontCut(w, s, W, (x) => top - Math.max(0, Math.abs(x - W / 2) - EYE.crest), z0 - 1, R + 1))));
    }
    return s.t(w.Manifold.union(parts));
  },
};
