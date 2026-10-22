/**
 * Card and media block geometry (planning in mediaBlock.ts): a block stepped
 * down toward the front, one step per row, its slots cut leaning back. In the
 * side view (z out from the board, y up) a slot is a parallelogram: its
 * centre line runs from the middle of its opening on the row's top, back and
 * up along u = (-sin, cos); its foot, `depth` down that line, is square to it.
 */
import type { Manifold, Vec2 } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX } from '../mount';
import type { AttachmentBuilder } from '../build';
import { MEDIA, mediaPlan, type MediaBlockOptions } from './mediaBlock';

/** (z, y) points to prismX's (d, y). */
const zy = (pts: Vec2[]): Vec2[] => pts.map(([z, y]) => [-z, y]);

export const mediaBlockBuilder: AttachmentBuilder<MediaBlockOptions> = {
  body(w, s, o, _l, ctx) {
    const p = mediaPlan(o, ctx);
    const R = o.rows;
    // The block's side: a staircase down to the front.
    const side: Vec2[] = [
      [0, 0],
      [p.D, 0],
      [p.D, p.top(R - 1)],
    ];
    for (let r = R - 1; r > 0; r--) side.push([p.z0(r), p.top(r)], [p.z0(r), p.top(r - 1)]);
    side.push([0, p.top(0)]);
    const parts: Manifold[] = [prismX(w, s, zy(side), 0, p.W), s.t(boxAt(w, 0, 0, 0, p.W, p.H, MEDIA.back))];
    if (o.label) {
      // A ledge for a label under the front's top edge, its underside at 45°.
      const ly = p.top(R - 1);
      const y0 = Math.max(0, ly - 12);
      parts.push(
        prismX(
          w,
          s,
          zy([
            [p.D - 0.1, y0],
            [p.D + 2, y0 + 2],
            [p.D + 2, ly],
            [p.D - 0.1, ly],
          ]),
          0,
          p.W,
        ),
      );
    }
    const body = s.t(w.Manifold.union(parts));
    const h = p.st / 2;
    const slots: Manifold[] = [];
    for (let r = 0; r < R; r++) {
      const zc = p.zc(r);
      const yt = p.top(r);
      // Its foot, and its end over the top (square to it, so its lower corner is still 1 mm above the top).
      const bz = zc + o.depth * p.sin;
      const by = yt - o.depth * p.cos;
      const e = (1 + h * p.sin) / p.cos;
      const tz = zc - e * p.sin;
      const ty = yt + e * p.cos;
      const pts: Vec2[] = [
        [bz - h * p.cos, by - h * p.sin],
        [bz + h * p.cos, by + h * p.sin],
        [tz + h * p.cos, ty + h * p.sin],
        [tz - h * p.cos, ty - h * p.sin],
      ];
      for (let k = 0; k < o.count; k++) slots.push(prismX(w, s, zy(pts), MEDIA.side + k * (p.sx + MEDIA.wall), p.sx));
    }
    return s.t(body.subtract(s.t(w.Manifold.union(slots))));
  },
};
