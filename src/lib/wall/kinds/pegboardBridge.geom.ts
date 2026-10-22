/**
 * 1″ pegboard plate geometry (planning in pegboardBridge.ts): a box, the
 * back plate behind, the pegboard face in front, the cavity between them.
 * The floor closes the bottom, a roof whose underside rises 45° from the
 * back plate to the face closes the top (no bridge), side walls and a rib
 * between each two hole columns tie the face to the back. Teardrop holes.
 */
import type { Manifold, Vec2 } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX, prismZ } from '../mount';
import type { AttachmentBuilder } from '../build';
import { PEG, type PegboardBridgeOptions } from './pegboardBridge';
import { teardrop } from './plate.geom';

/** The holes' centres, bottom row first: half a pitch in from the left and the bottom, on the 1″ grid. */
export const pegHoles = (o: PegboardBridgeOptions): Vec2[] =>
  Array.from({ length: o.columns * o.rows }, (_, k) => [(0.5 + (k % o.columns)) * PEG.pitch, (0.5 + Math.floor(k / o.columns)) * PEG.pitch]);

export const pegboardBridgeBuilder: AttachmentBuilder<PegboardBridgeOptions> = {
  body(w, s, o, layout) {
    const W = layout.w;
    const H = layout.h;
    const D = layout.depth;
    const { back: B, rib: R } = PEG;
    const zf = B + o.cavity;
    const add: Manifold[] = [s.t(boxAt(w, 0, 0, 0, W, H, B)), s.t(boxAt(w, 0, 0, zf, W, H, D)), s.t(boxAt(w, 0, 0, 0, W, R, D))];
    // The roof: R thick at the face, its underside 45° down to the back plate.
    const roof: Vec2[] = [
      [B - 0.5, H],
      [zf + 0.5, H],
      [zf + 0.5, H - R],
      [zf, H - R],
      [B - 0.5, H - R - (zf - B) - 0.5],
    ];
    add.push(
      prismX(
        w,
        s,
        roof.map(([z, y]) => [-z, y]),
        0,
        W,
      ),
    );
    for (let i = 0; i <= o.columns; i++) {
      const x = Math.min(W - R, Math.max(0, i * PEG.pitch - R / 2));
      add.push(s.t(boxAt(w, x, 0, 0, x + R, H, D)));
    }
    const holes = pegHoles(o).map(([x, y]) => prismZ(w, s, teardrop(x, y, PEG.hole / 2), zf - 1, D + 1));
    return s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(holes))));
  },
};
