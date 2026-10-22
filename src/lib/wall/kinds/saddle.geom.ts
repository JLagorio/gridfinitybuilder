import type { Manifold, Scope, Vec2, Wasm } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX, prismZ } from '../mount';
import type { AttachmentBuilder } from '../build';
import { SADDLE, saddleSag, saddleStack, yokeShape, type SaddleOptions } from './saddle';

/** A side view in wall (z out, y up) as prismX takes it: (d, y) with d behind the board's front. */
export const zy = (pts: Vec2[]): Vec2[] => pts.map(([z, y]) => [-z, y] as Vec2);

/** Everything under a curve across x (its top `top(x)`, 0..W), from z0 to z1: cuts a profile's top to a saddle or a nose. */
export function frontCut(w: Wasm, s: Scope, W: number, top: (x: number) => number, z0: number, z1: number, steps = 48): Manifold {
  const pts: Vec2[] = [
    [0, -1],
    [W, -1],
  ];
  for (let i = steps; i >= 0; i--) pts.push([(W * i) / steps, top((W * i) / steps)]);
  return prismZ(w, s, pts, z0, z1);
}

function saddleBody(w: Wasm, s: Scope, o: SaddleOptions, W: number, H: number, ctx: Parameters<typeof saddleStack>[1]): Manifold {
  const B = SADDLE.back;
  const st = saddleStack(o, ctx);
  const D = st.D;
  const yc = st.crown;
  const yA = yc - o.arm - st.sag;
  const reach = Math.max(D, o.shelf) + 1;
  // The saddle's top `h` above the crown, dropping across it.
  const crown = (h: number) => frontCut(w, s, W, (x) => yc + h - saddleSag(x - W / 2, o.radius), -1, reach);
  const side = (pts: Vec2[]) => prismX(w, s, zy(pts), 0, W);
  const parts: Manifold[] = [
    side([
      [0, 0],
      [B, 0],
      [B, H],
      [0, H],
    ]),
    // A 45° brace under the arm, from the back.
    side([
      [B - 0.5, yA - st.brace - 0.5],
      [B - 0.5, yA + 0.5],
      [B + st.brace + 0.5, yA + 0.5],
    ]),
  ];
  const arm = side([
    [B - 0.5, yA],
    [D, yA],
    [D, yc + 1],
    [B - 0.5, yc + 1],
  ]);
  parts.push(s.t(arm.intersect(crown(0))));
  if (o.lip > 0) {
    const lip = side([
      [D - SADDLE.lipT, yA],
      [D, yA],
      [D, yc + o.lip + 1],
      [D - SADDLE.lipT, yc + o.lip + 1],
    ]);
    parts.push(s.t(lip.intersect(crown(o.lip))));
  }
  // Low 45° ridges between saddles.
  for (let k = 1; k < st.seats.length && st.rh > 0; k++) {
    const zc = (st.seats[k - 1][1] + st.seats[k][0]) / 2;
    const b = st.rh + st.sag + 1;
    const ridge = side([
      [zc - b, yc - st.sag - 1],
      [zc + b, yc - st.sag - 1],
      [zc, yc + st.rh],
    ]);
    parts.push(s.t(ridge.intersect(crown(st.rh))));
  }
  if (o.cleat) {
    // Two horns under the arm, on a post: wind the cable round them in a figure of eight.
    const z0 = B + st.brace + 4;
    const z1 = D - 2;
    const zm = (z0 + z1) / 2;
    const c = SADDLE.cleat;
    if (z1 - z0 >= 20)
      parts.push(
        side([
          [z0, yA - c],
          [z1, yA - c],
          [z1, yA - 8],
          [z1 - 3, yA - 8],
          [z1 - 4, yA - c + 5],
          [zm + 4, yA - c + 5],
          [zm + 4, yA + 0.5],
          [zm - 4, yA + 0.5],
          [zm - 4, yA - c + 5],
          [z0 + 4, yA - c + 5],
          [z0 + 3, yA - 8],
          [z0, yA - 8],
        ]),
      );
  }
  if (o.shelf > 0) {
    // A small shelf at the foot of the back: a floor, a lip and a gusset.
    const S = Math.max(o.shelf, B + 10);
    const F = SADDLE.floor;
    const g = Math.min(12, S - B - 4);
    parts.push(
      side([
        [B - 0.5, 0],
        [S, 0],
        [S, F + SADDLE.shelfLip],
        [S - 2.4, F + SADDLE.shelfLip],
        [S - 2.4, F],
        [B + g, F],
        [B, F + g],
        [B - 0.5, F + g],
      ]),
    );
  }
  return s.t(w.Manifold.union(parts));
}

function yokeBody(w: Wasm, s: Scope, o: SaddleOptions, W: number, H: number, ctx: Parameters<typeof yokeShape>[1]): Manifold {
  const B = SADDLE.back;
  const T = SADDLE.tipT;
  const y = yokeShape(o, ctx);
  const D = y.D;
  // Each prong's side view: on the bed from the back out, its top rising at the tilt, the tip at the front (its inner
  // top edge chamfered to guide the neck in), and a 45° gusset into the back.
  const pts: Vec2[] = [
    [B - 0.5, 0],
    [D, 0],
  ];
  if (o.tip > 0) {
    const c = Math.min(2.5, o.tip / 2);
    pts.push([D, y.tipTop], [D - T + c, y.tipTop], [D - T, y.tipTop - c], [D - T, y.top(D - T)]);
  } else pts.push([D, y.top(D)]);
  const gz = y.gusset / (1 + y.t);
  pts.push([B + gz, y.top(B + gz)], [B - 0.5, o.arm + y.gusset]);
  const parts: Manifold[] = [s.t(boxAt(w, 0, 0, 0, W, H, B))];
  const cuts: Manifold[] = [];
  for (const x0 of [0, W - o.prong]) {
    parts.push(prismX(w, s, zy(pts), x0, o.prong));
    if (o.pad) {
      // A groove along the top for a felt strip, from the gusset to the tip.
      const gw = Math.min(SADDLE.groove, o.prong - 4);
      const z0 = B + gz + 2;
      const z1 = o.tip > 0 ? D - T + 1 : D + 1;
      const d = SADDLE.grooveD;
      const groove: Vec2[] = [
        [z0, y.top(z0) - d],
        [z1, y.top(z1) - d],
        [z1, y.top(z1) + 0.6],
        [z0, y.top(z0) + 0.6],
      ];
      cuts.push(prismX(w, s, zy(groove), x0 + (o.prong - gw) / 2, gw));
    }
  }
  const body = s.t(w.Manifold.union(parts));
  return cuts.length ? s.t(body.subtract(s.t(w.Manifold.union(cuts)))) : body;
}

export const saddleBuilder: AttachmentBuilder<SaddleOptions> = {
  body(w, s, o, layout, ctx) {
    return o.mode === 'yoke' ? yokeBody(w, s, o, layout.w, layout.h, ctx) : saddleBody(w, s, o, layout.w, layout.h, ctx);
  },
};
