import type { Manifold, Vec2 } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX, prismY, prismZ } from '../mount';
import type { AttachmentBuilder } from '../build';
import { cornerGusset } from './shelf.geom';
import { TOOL_DOCK, type ToolDockOptions } from './toolDock';

const SEGS = 48;

export const toolDockBuilder: AttachmentBuilder<ToolDockOptions> = {
  body(w, s, o, layout) {
    const W = layout.w;
    const H = layout.h;
    const R = o.reach;
    const { back: B, ledge: T, vee: V, flare: F, gusset: G } = TOOL_DOCK;
    const k = Math.tan((o.tilt * Math.PI) / 180);
    const top = T + R * k;
    // The fork: flat on the bed, its top rising toward the tips (profile in (d, y), d = -z).
    const ledge = prismX(
      w,
      s,
      [
        [0, 0],
        [-R, 0],
        [-R, top],
        [0, T],
      ],
      0,
      W,
    );
    const g = Math.min(R - B, H - T, 50);
    const add: Manifold[] = [s.t(boxAt(w, 0, 0, 0, W, H, B)), ledge, cornerGusset(w, s, B, T, 4, 0, W)];
    add.push(cornerGusset(w, s, B, T, g, 0, G), cornerGusset(w, s, B, T, g, W - G, G));
    // The forks centred on the back (it can be wider, for the clips).
    const x0 = (W - o.count * o.pitch) / 2;
    for (let i = 1; i < o.count; i++) add.push(cornerGusset(w, s, B, T, g, x0 + i * o.pitch - G / 2, G));
    const cut: Manifold[] = [];
    const r = o.gap / 2;
    for (let i = 0; i < o.count; i++) {
      const cx = x0 + (i + 0.5) * o.pitch;
      // The slot: a round end where the handle sits, open through the front, its mouth flared at 45°.
      const xz: Vec2[] = [];
      for (let j = 0; j <= SEGS; j++) {
        const a = (-Math.PI * j) / SEGS;
        xz.push([cx + r * Math.cos(a), o.setback + r * Math.sin(a)]);
      }
      xz.push([cx - r, R + 1], [cx + r, R + 1]);
      cut.push(
        prismY(
          w,
          s,
          xz.map(([x, z]) => [x, -z] as Vec2),
          -1,
          top + 2,
        ),
      );
      for (const side of [-1, 1]) {
        const xe = cx + side * r;
        cut.push(
          prismY(
            w,
            s,
            [
              [xe, -(R - F)],
              [xe + side * (F + 1), -(R + 1)],
              [xe, -(R + 1)],
            ],
            -1,
            top + 2,
          ),
        );
        // Battery down: a 45° V along the slot's top edges cradles the head; it follows the slope.
        if (o.battery === 'down') {
          const vee = prismZ(
            w,
            s,
            [
              [xe, T - V],
              [xe, T + 1],
              [xe + side * (V + 1), T + 1],
            ],
            o.setback,
            R + 1,
          );
          cut.push(
            s.t(
              vee.warp((v) => {
                v[1] += k * v[2];
              }),
            ),
          );
        }
      }
    }
    return s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(cut))));
  },
};
