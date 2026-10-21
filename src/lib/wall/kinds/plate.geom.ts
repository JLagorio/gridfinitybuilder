import type { Manifold } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import { mountBox, siteAt } from '../mount';
import type { AttachmentBuilder } from '../build';
import { PLATE_SCREWS, screwGrid, tiePairs, tieRow, type PlateOptions } from './plate';

/**
 * Magnet pockets (6 × 2 mm with room, their centres in from the corners), zip-tie slots (a tie 5 mm wide, its
 * pair of slots apart, the channel behind) and the tape recess (in from the edges, deep); mm.
 */
export const PLATE = {
  magnet: 6.3,
  magnetDepth: 2.2,
  magnetIn: 8,
  slotW: 2.4,
  slotH: 5.5,
  tieSpan: 16,
  tiePitch: 30,
  channel: 1.8,
  tapeIn: 3,
  tapeDepth: 0.6,
} as const;

export const plateBuilder: AttachmentBuilder<PlateOptions> = {
  body(w, s, o, layout, ctx) {
    const W = layout.w;
    const H = layout.h;
    const T = o.thick;
    const cuts: Manifold[] = [];
    // Keep-outs for the screw holes: the mounts, the magnets, the zip-tie slots (x0, y0, x1, y1).
    const keep: [number, number, number, number][] = layout.mounts.map((m) => {
      const b = mountBox(m.kind, siteAt(layout, m, ctx), ctx);
      return [b.x0, b.y0, b.x1, b.y1];
    });
    if (o.magnets) {
      const r = PLATE.magnet / 2;
      const i = PLATE.magnetIn;
      for (const [x, y] of [
        [i, i],
        [W - i, i],
        [i, H - i],
        [W - i, H - i],
      ]) {
        cuts.push(s.t(cylinderAt(w, x, y, T - PLATE.magnetDepth, T + 1, r)));
        keep.push([x - r, y - r, x + r, y + r]);
      }
    }
    const ty = tieRow(layout, ctx);
    const n = tiePairs(W);
    if (o.ties && ty !== null && n) {
      const hw = PLATE.slotW / 2;
      const hh = PLATE.slotH / 2;
      for (let k = 0; k < n; k++) {
        const xc = W / 2 + (k - (n - 1) / 2) * PLATE.tiePitch;
        const xa = xc - PLATE.tieSpan / 2;
        const xb = xc + PLATE.tieSpan / 2;
        // Two slots through, and a channel across the back between them for the tie to pass behind.
        cuts.push(s.t(boxAt(w, xa - hw, ty - hh, -1, xa + hw, ty + hh, T + 1)), s.t(boxAt(w, xb - hw, ty - hh, -1, xb + hw, ty + hh, T + 1)));
        cuts.push(s.t(boxAt(w, xa - hw, ty - hh, -1, xb + hw, ty + hh, PLATE.channel)));
        keep.push([xa - hw, ty - hh, xb + hw, ty + hh]);
      }
    }
    if (o.screws !== 'none') {
      const [hole, head] = PLATE_SCREWS[o.screws];
      const r = hole / 2;
      const R = head / 2;
      const { edge: m, ni, nj } = screwGrid(o, H);
      const P = o.pitch;
      // A grid centred on the plate, each hole clear of the edges and everything above.
      for (let i = -ni; i <= ni; i++) {
        for (let j = -nj; j <= nj; j++) {
          const x = W / 2 + i * P;
          const y = H / 2 + j * P;
          if (keep.some(([x0, y0, x1, y1]) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m)) continue;
          // Countersunk from the back: the head sits flush where the plate meets the board.
          cuts.push(s.t(cylinderAt(w, x, y, -1, T + 1, r)), s.t(cylinderAt(w, x, y, -0.01, R - r, R + 0.01, r)));
        }
      }
    }
    if (o.tape) cuts.push(s.t(boxAt(w, PLATE.tapeIn, PLATE.tapeIn, T - PLATE.tapeDepth, W - PLATE.tapeIn, H - PLATE.tapeIn, T + 1)));
    const plate = s.t(boxAt(w, 0, 0, 0, W, H, T));
    return cuts.length ? s.t(plate.subtract(s.t(w.Manifold.union(cuts)))) : plate;
  },
};
