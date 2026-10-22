/**
 * Box sleeve geometry (planning in boxSleeve.ts): back, floor, sides and a
 * front, all standing on the floor; the openings cut from the front (a U
 * open at the top, or a notch with a round bottom) and down through the
 * floor, so nothing is left hanging.
 */
import type { Manifold, Vec2 } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismY, prismZ } from '../mount';
import type { AttachmentBuilder } from '../build';
import { BOX, boxPlan, type BoxSleeveOptions } from './boxSleeve';

/** Cutter teeth: pitch and how far they reach into the slot, mm. */
const TOOTH = { p: 3, h: 1.5 } as const;

export const boxSleeveBuilder: AttachmentBuilder<BoxSleeveOptions> = {
  body(w, s, o, layout) {
    const p = boxPlan(o);
    const H = layout.h;
    const { W, D } = p;
    const parts: Manifold[] = [
      s.t(boxAt(w, 0, 0, 0, W, H, BOX.back)),
      s.t(boxAt(w, 0, 0, 0, W, BOX.floor, D)),
      s.t(boxAt(w, 0, 0, 0, o.wall, H, D)),
      s.t(boxAt(w, W - o.wall, 0, 0, W, H, D)),
    ];
    const cuts: Manifold[] = [];
    const xm = W / 2;
    if (o.open === 'top') {
      // A low front with a round-bottomed notch for a thumb.
      const hf = Math.max(BOX.floor + 5, BOX.floor + (o.height * o.front) / 100);
      parts.push(s.t(boxAt(w, 0, 0, p.z1, W, Math.min(hf, H), D)));
      const r = Math.min(20, 0.2 * o.width);
      const yb = Math.max(BOX.floor + 3, hf - r - 10);
      const notch: Vec2[] = [];
      for (let i = 0; i <= 16; i++) {
        const a = Math.PI + (Math.PI * i) / 16;
        notch.push([xm + r * Math.cos(a), yb + r + r * Math.sin(a)]);
      }
      notch.push([xm + r, H + 1], [xm - r, H + 1]);
      if (yb < hf - 1) cuts.push(prismZ(w, s, notch, p.z1 - 1, D + 1));
    } else {
      // A U frame: open from the rim up.
      parts.push(s.t(boxAt(w, 0, 0, p.z1, W, H, D)));
      cuts.push(s.t(boxAt(w, p.x0 + o.rim, BOX.floor + o.rim, p.z1 - 1, p.x1 - o.rim, H + 1, D + 1)));
    }
    let body = s.t(w.Manifold.union(parts));
    if (o.open === 'bottom') {
      // The slot through the floor, across the middle.
      const zm = (p.z0 + p.z1) / 2;
      const za = zm - o.slot / 2;
      const zb = zm + o.slot / 2;
      const xa = p.x0 + o.rim;
      const xb = p.x1 - o.rim;
      cuts.push(s.t(boxAt(w, xa, -1, za, xb, BOX.floor + 1, zb)));
      body = s.t(body.subtract(s.t(w.Manifold.union(cuts))));
      if (o.cutter) {
        // Teeth along its front edge, pointing back into it (in plan; prismY's polygon is (x, d), d = -z).
        const n = Math.floor((xb - xa) / TOOTH.p);
        const x0 = (xa + xb - n * TOOTH.p) / 2;
        const t: Vec2[] = [
          [x0 + n * TOOTH.p, -(zb + 0.5)],
          [x0, -(zb + 0.5)],
          [x0, -zb],
        ];
        for (let i = 0; i < n; i++) t.push([x0 + (i + 0.5) * TOOTH.p, -(zb - TOOTH.h)], [x0 + (i + 1) * TOOTH.p, -zb]);
        body = s.t(body.add(prismY(w, s, t, 0, BOX.floor)));
      }
      return body;
    }
    return cuts.length ? s.t(body.subtract(s.t(w.Manifold.union(cuts)))) : body;
  },
};
