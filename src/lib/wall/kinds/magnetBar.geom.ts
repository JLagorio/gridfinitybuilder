import type { Manifold, Vec2 } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX, prismZ } from '../mount';
import type { AttachmentBuilder } from '../build';
import { MAG, magnetPlan, type MagnetBarOptions } from './magnetBar';
import { zy } from './saddle.geom';

/** A round pocket with a 45° roof (it prints upright without support), radius `r` about (x, y), its tip `r`√2 above. */
function teardrop(x: number, y: number, r: number): Vec2[] {
  const pts: Vec2[] = [[x, y + r * Math.SQRT2]];
  for (let i = 0; i <= 36; i++) {
    const a = ((135 + (270 * i) / 36) * Math.PI) / 180;
    pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
  }
  return pts;
}

export const magnetBarBuilder: AttachmentBuilder<MagnetBarOptions> = {
  body(w, s, o, layout, ctx) {
    const p = magnetPlan(o, ctx);
    const W = layout.w;
    const H = layout.h;
    const parts: Manifold[] = [
      prismX(
        w,
        s,
        zy([
          [0, 0],
          [p.Tb, 0],
          [p.Tt, H],
          [0, H],
        ]),
        0,
        W,
      ),
    ];
    if (o.lip > 0) {
      // A ledge along the foot with its front edge standing up.
      const z = p.Tb + o.lip;
      const t = MAG.lipT;
      parts.push(
        prismX(
          w,
          s,
          zy([
            [p.Tb - 1, 0],
            [z, 0],
            [z, t + MAG.lipUp],
            [z - 2, t + MAG.lipUp],
            [z - 2, t],
            [p.Tb - 1, t],
          ]),
          0,
          W,
        ),
      );
    }
    const body = s.t(w.Manifold.union(parts));
    const cuts: Manifold[] = [];
    for (const x of p.xs) {
      const rect: Vec2[] = [
        [x - p.px, p.yc - p.py0],
        [x + p.px, p.yc - p.py0],
        [x + p.px, p.yc + p.py1],
        [x - p.px, p.yc + p.py1],
      ];
      if (p.glue) cuts.push(prismZ(w, s, p.disc ? teardrop(x, p.yc, p.px) : rect, -1, p.zf));
      else {
        // Sealed: a closed pocket behind the skin, and a pin-hole down to the underside.
        cuts.push(prismZ(w, s, rect, p.zf - p.mt, p.zf));
        const v = MAG.vent / 2;
        const zm = p.zf - p.mt / 2;
        cuts.push(s.t(boxAt(w, x - v, -1, zm - v, x + v, p.yc - p.py0 + 0.5, zm + v)));
      }
    }
    return s.t(body.subtract(s.t(w.Manifold.union(cuts))));
  },
};
