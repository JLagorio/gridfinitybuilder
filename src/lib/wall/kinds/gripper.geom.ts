import type { CrossSection } from 'manifold-3d';
import type { Vec2 } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { ccw } from '../mount';
import type { AttachmentBuilder } from '../build';
import { GRIP, gripGeometry, type GripperOptions } from './gripper';

/** Segments round the C (a multiple of 4). */
const SEGS = 96;

/** Points round a circle, from straight out (+v) toward +u. */
const circle = (cu: number, cv: number, rad: number, n: number): Vec2[] =>
  Array.from({ length: n }, (_, i) => [cu + rad * Math.sin((2 * Math.PI * i) / n), cv + rad * Math.cos((2 * Math.PI * i) / n)] as Vec2);

export const gripperBuilder: AttachmentBuilder<GripperOptions> = {
  body(w, s, o, layout, ctx) {
    const g = gripGeometry(o, ctx);
    const side = o.axis === 'horizontal';
    const W = layout.w;
    const H = layout.h;
    // The C's section in (u across the C, v out from the board), drawn in the plane it's extruded from.
    const map = (u: number, v: number): Vec2 => (side ? [-v, u] : [u, -v]);
    const cs = (pts: Vec2[]) => s.t(new w.CrossSection([ccw(pts.map(([u, v]) => map(u, v)))], 'Positive'));
    const solid: CrossSection[] = [];
    const inside: CrossSection[] = [];
    const ribs: CrossSection[] = [];
    const tip = g.r + o.arm / 2;
    const stem = Math.min(2 * g.R, Math.max(6, 0.6 * g.R));
    const span = side ? H : W;
    // Grip ribs round the back half, clear of the tips.
    const reach = Math.min(85, 180 - g.half / (Math.PI / 180) - 20);
    const ribAt = [...new Set([180, 135, 225, 180 - reach, 180 + reach])].map((d) => (d * Math.PI) / 180);
    for (let k = 0; k < o.count; k++) {
      const uc = (span - g.run) / 2 + g.R + k * g.pitch;
      // The C: the ring but for the mouth, round ends on the tips, and the stem back to the plate.
      const n = Math.round((SEGS * (2 * Math.PI - 2 * g.half)) / (2 * Math.PI));
      const arc: Vec2[] = [];
      for (let i = 0; i <= n; i++) {
        const a = g.half + ((2 * Math.PI - 2 * g.half) * i) / n;
        arc.push([uc + g.R * Math.sin(a), g.zc + g.R * Math.cos(a)]);
      }
      for (let i = n; i >= 0; i--) {
        const a = g.half + ((2 * Math.PI - 2 * g.half) * i) / n;
        arc.push([uc + g.r * Math.sin(a), g.zc + g.r * Math.cos(a)]);
      }
      solid.push(cs(arc));
      for (const a of [g.half, -g.half]) solid.push(cs(circle(uc + tip * Math.sin(a), g.zc + tip * Math.cos(a), o.arm / 2, 32)));
      solid.push(
        cs([
          [uc - stem / 2, GRIP.back - 0.5],
          [uc + stem / 2, GRIP.back - 0.5],
          [uc + stem / 2, g.zc - g.r],
          [uc - stem / 2, g.zc - g.r],
        ]),
      );
      inside.push(cs(circle(uc, g.zc, g.r, SEGS)));
      if (o.ribs)
        for (const a of ribAt)
          ribs.push(cs(circle(uc + (g.r - GRIP.rib + GRIP.ribR) * Math.sin(a), g.zc + (g.r - GRIP.rib + GRIP.ribR) * Math.cos(a), GRIP.ribR, 16)));
    }
    let c = s.t(s.t(w.CrossSection.union(solid)).subtract(s.t(w.CrossSection.union(inside))));
    if (ribs.length) c = s.t(w.CrossSection.union([c, ...ribs]));
    const e = s.t(w.Manifold.extrude(c, o.length));
    // Upright: (u, -v, e) → (u, e, v). On its side: (-v, u, e) → (e, u, v).
    const C = side ? s.t(e.rotate([0, 90, 0])) : s.t(e.rotate([-90, 0, 0]));
    return s.t(w.Manifold.union([s.t(boxAt(w, 0, 0, 0, W, H, GRIP.back)), C]));
  },
};
