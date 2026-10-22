import { boxAt } from '../../geometry/shapes';
import { prismX } from '../mount';
import type { AttachmentBuilder } from '../build';
import { BIN_BACK, binFront, type BinOptions } from './bin';

export const binBuilder: AttachmentBuilder<BinOptions> = {
  body(w, s, o, layout) {
    const W = layout.w;
    const H = layout.h;
    const D = o.depth;
    const t = o.wall;
    const frontH = binFront(o, H);
    let box = s.t(boxAt(w, 0, 0, 0, W, H, D));
    // Hollow: walls, floor and the thicker back.
    box = s.t(box.subtract(s.t(boxAt(w, t, o.floor, BIN_BACK, W - t, H + 1, D - t))));
    // Sides slope from the back's height down to the front's, at the front wall's inside face: the front's top is
    // flat (sloped across it, its top would taper to an edge too thin to print).
    if (frontH < H - 0.01) {
      const slope = prismX(
        w,
        s,
        [
          [-BIN_BACK, H],
          [-(D - t), frontH],
          [-D - 1, frontH],
          [-D - 1, H + 1],
          [-BIN_BACK, H + 1],
        ],
        -1,
        W + 2,
      );
      box = s.t(box.subtract(slope));
    }
    const parts = [box];
    // Dividers: as high as the slope where they stand (they stand across the whole depth).
    for (let k = 1; k <= o.dividers; k++) {
      const x = t + ((W - 2 * t) * k) / (o.dividers + 1);
      const div = prismX(
        w,
        s,
        [
          [-BIN_BACK + 0.1, o.floor - 0.1],
          [-D + t - 0.1, o.floor - 0.1],
          [-D + t - 0.1, Math.max(o.floor + 1, frontH - 1)],
          [-BIN_BACK + 0.1, H - 1],
        ],
        x - t / 2,
        t,
      );
      parts.push(div);
    }
    if (o.label) {
      // A ledge sloping out at 45° under the front's top edge: prints without support.
      const ly = frontH;
      const y0 = Math.max(0, ly - 12);
      parts.push(
        prismX(
          w,
          s,
          [
            [-D + 0.1, y0],
            [-D - 2, y0 + 2],
            [-D - 2, ly],
            [-D + 0.1, ly],
          ],
          0,
          W,
        ),
      );
    }
    return s.t(w.Manifold.union(parts));
  },
};
