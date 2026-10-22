import type { Manifold, Vec2 } from '../../geometry/kernel';
import { boxAt, roundedRectRing } from '../../geometry/shapes';
import { prismX, prismY } from '../mount';
import type { AttachmentBuilder } from '../build';
import { CHARGER, chargerPocket, type ChargerCradleOptions } from './chargerCradle';

export const chargerCradleBuilder: AttachmentBuilder<ChargerCradleOptions> = {
  body(w, s, o, layout, ctx) {
    const W = layout.w;
    const H = layout.h;
    const D = layout.depth;
    const { back: B, floor: F, side: S, front: Fr, cord: C, cordL } = CHARGER;
    const p = chargerPocket(o, ctx);
    const lip = F + p.lip;
    // Side walls from the back plate's top down to the lip at the front (profile in (d, y), d = -z).
    const side: Vec2[] = [
      [0, 0],
      [-D, 0],
      [-D, lip],
      [0, H],
    ];
    const add: Manifold[] = [
      s.t(boxAt(w, 0, 0, 0, W, H, B)),
      s.t(boxAt(w, 0, 0, 0, W, F, D)),
      s.t(boxAt(w, 0, 0, D - Fr, W, lip, D)),
      prismX(w, s, side, 0, S),
      prismX(w, s, side, W - S, S),
    ];
    const cut: Manifold[] = [];
    if (o.cord === 'floor') {
      // A slot through the floor along the back, its ends round.
      const ring = roundedRectRing(W / 2 - C / 2, B + 2, W / 2 + C / 2, B + 2 + cordL, C / 2 - 0.01);
      cut.push(
        prismY(
          w,
          s,
          ring.map(([x, z]) => [x, -z] as Vec2),
          -1,
          F + 2,
        ),
      );
    } else if (o.cord === 'side') cut.push(s.t(boxAt(w, p.x1 - 1, F + 2, B + 6, W + 1, H + 1, B + 6 + C)));
    const body = s.t(w.Manifold.union(add));
    return cut.length ? s.t(body.subtract(s.t(w.Manifold.union(cut)))) : body;
  },
};
