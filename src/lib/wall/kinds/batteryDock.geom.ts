import { Scope, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { boxAt, roundedRectRing } from '../../geometry/shapes';
import { prismX, prismY, prismZ } from '../mount';
import { posed, type AttachmentBuilder } from '../build';
import { cornerGusset } from './shelf.geom';
import { BATTERY, dockSize, railSection, type BatteryDockOptions } from './batteryDock';

/** Lead-in at the top of the rails' tips and of the channel's walls, 45°; mm. */
const LEAD = { rail: 3, channel: 2 } as const;

/** A box as a prism along y (x0..x1, z0..z1, from y0 up to y1). */
const column = (w: Wasm, s: Scope, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) =>
  prismY(
    w,
    s,
    [
      [x0, -z0],
      [x1, -z0],
      [x1, -z1],
      [x0, -z1],
    ],
    y0,
    y1 - y0,
  );

/**
 * One bay's rail receiver, centred at cx, from y0 (its foot) to y1 (its open top): the solid round the
 * channel, and what is cut from it (the channel and the gap between the rails, 45° lead-ins at the top).
 */
function receiver(w: Wasm, s: Scope, o: BatteryDockOptions, c: number, cx: number, y0: number, y1: number): { add: Manifold; cut: Manifold[] } {
  const r = railSection(o, c);
  const B = BATTERY.back;
  const add = column(w, s, cx - r.width / 2, cx + r.width / 2, B - 0.5, r.front, 0, y1);
  const cut: Manifold[] = [
    column(w, s, cx - r.channel / 2, cx + r.channel / 2, B, B + r.room, y0, y1 + 1),
    column(w, s, cx - r.gap / 2, cx + r.gap / 2, B, r.front + 1, y0, y1 + 1),
  ];
  for (const side of [-1, 1]) {
    const lead = (x: number, a: number, z0: number, z1: number) => {
      const pts: Vec2[] = [
        [x, y1 - a],
        [x, y1 + 1],
        [x + side * (a + 1), y1 + 1],
      ];
      cut.push(prismZ(w, s, pts, z0, z1));
    };
    lead(cx + (side * r.gap) / 2, LEAD.rail, B + r.room - 0.01, r.front + 1);
    lead(cx + (side * r.channel) / 2, LEAD.channel, B, B + r.room + 0.01);
  }
  return { add, cut };
}

/** A fit coupon: a short length of the receiver on a strip of back plate, one to three notches in its top. */
function coupon(w: Wasm, s: Scope, o: BatteryDockOptions & { marks: number }): Manifold {
  const r = railSection(o);
  const H = BATTERY.coupon;
  const cx = r.width / 2;
  const { add, cut } = receiver(w, s, o, o.clearance, cx, -1, H);
  const plate = s.t(boxAt(w, 0, 0, 0, r.width, H, BATTERY.back));
  for (let i = 0; i < o.marks; i++) {
    const x = cx - r.gap / 2 + 2 + 3 * i;
    cut.push(s.t(boxAt(w, x, H - 1.5, -1, x + 1.5, H + 1, BATTERY.back + 1)));
  }
  return s.t(s.t(w.Manifold.union([plate, add])).subtract(s.t(w.Manifold.union(cut))));
}

export const batteryDockBuilder: AttachmentBuilder<BatteryDockOptions> = {
  body(w, s, o, layout, ctx) {
    const W = layout.w;
    const H = layout.h;
    const D = layout.depth;
    const B = BATTERY.back;
    const c = o.clearance;
    const z = dockSize(o, ctx);
    const add: Manifold[] = [s.t(boxAt(w, 0, 0, 0, W, H, B))];
    const cut: Manifold[] = [];
    if (o.mode === 'body') {
      // A block, the pockets cut from it, open at the top; the front lower than the sides.
      const top = BATTERY.floor + z.cover;
      const lip = BATTERY.floor + Math.min(z.cover, BATTERY.lip);
      add.push(s.t(boxAt(w, 0, 0, 0, W, top, D)));
      for (let k = 0; k < o.count; k++) {
        const x0 = z.x0 + BATTERY.side + k * (z.bay + BATTERY.side);
        cut.push(s.t(boxAt(w, x0, BATTERY.floor, B, x0 + z.bay, top + 1, B + o.packD + 2 * c)));
        cut.push(s.t(boxAt(w, x0, lip, B + 1, x0 + z.bay, top + 1, D + 1)));
      }
    } else if (o.mode === 'stem') {
      // A ledge on the bed, a socket through it for each stem, gussets at the ends and between the bays.
      const T = BATTERY.stemLedge;
      add.push(s.t(boxAt(w, 0, 0, 0, W, T, D)));
      const g = Math.min(D - B, H - T, 40);
      add.push(cornerGusset(w, s, B, T, g, 0, 3), cornerGusset(w, s, B, T, g, W - 3, 3));
      for (let k = 1; k < o.count; k++) add.push(cornerGusset(w, s, B, T, g, z.x0 + k * z.bay - 1.5, 3));
      const sw = o.stemW + 2 * c;
      const sd = o.stemD + 2 * c;
      const zc = B + (D - B - BATTERY.edge) / 2;
      for (let k = 0; k < o.count; k++) {
        const cx = z.x0 + (k + 0.5) * z.bay;
        const ring = roundedRectRing(cx - sw / 2, zc - sd / 2, cx + sw / 2, zc + sd / 2, Math.min(3, sw / 2 - 0.01, sd / 2 - 0.01));
        cut.push(
          prismY(
            w,
            s,
            ring.map(([x, zz]) => [x, -zz] as Vec2),
            -1,
            T + 2,
          ),
        );
      }
    } else {
      // Rails up the board from the stop at the bottom; the stop reaches out under the pack's end.
      const S = BATTERY.stop;
      for (let k = 0; k < o.count; k++) {
        const cx = z.x0 + (k + 0.5) * z.bay;
        const rc = receiver(w, s, o, c, cx, S, H);
        add.push(rc.add, s.t(boxAt(w, cx - z.bay / 2 + BATTERY.gap / 2, 0, 0, cx + z.bay / 2 - BATTERY.gap / 2, S, D)));
        cut.push(...rc.cut);
        if (o.latch === 'recess') {
          // A recess in the deck between the rails; its top rises at 45° into the deck, so it needs no support.
          const r = railSection(o);
          const hw = Math.min(BATTERY.latchW, r.gap - 4) / 2;
          const y0 = S + o.latchAt - BATTERY.latchL / 2;
          const y1 = S + o.latchAt + BATTERY.latchL / 2;
          const d = BATTERY.latchD;
          const zy: Vec2[] = [
            [B - d, y0],
            [B + 0.01, y0],
            [B + 0.01, y1],
            [B - d, y1 - d],
          ];
          cut.push(
            prismX(
              w,
              s,
              zy.map(([zz, y]) => [-zz, y] as Vec2),
              cx - hw,
              2 * hw,
            ),
          );
        }
      }
    }
    const body = s.t(w.Manifold.union(add));
    return cut.length ? s.t(body.subtract(s.t(w.Manifold.union(cut)))) : body;
  },
  part(w, spec: BatteryDockOptions & { marks: number }) {
    const s = new Scope();
    try {
      return posed(s, coupon(w, s, spec), { pose: 'upright' }, 'battery rail coupon');
    } finally {
      s.dispose();
    }
  },
};
