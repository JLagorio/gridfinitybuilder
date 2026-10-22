/**
 * DIN rail geometry (planning in dinRail.ts): the plate, and on it the
 * rail's two halves, each a wall and its flange in one L (out from the board
 * z, up y), centred up the plate; the end stops two teeth in front of the
 * walls and flanges at each end, a flat top and a 45° ramp down to the
 * flanges (the one at the top of the print leans out 45°, the other stands
 * on the bed).
 */
import type { Manifold, Vec2 } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX, prismY } from '../mount';
import type { AttachmentBuilder } from '../build';
import { DIN, type DinRailOptions } from './dinRail';

/** The rail's upper half (a wall and its flange) in (z, y), the rail's middle at y = 0, its foot at z = DIN.plate. */
export function dinHalf(o: DinRailOptions): Vec2[] {
  const z0 = DIN.plate;
  const z1 = z0 + +o.depth;
  const hat = DIN.hat / 2;
  const tip = DIN.width / 2;
  return [
    [z0 - 0.5, hat - DIN.wall],
    [z1, hat - DIN.wall],
    [z1, tip],
    [z1 - DIN.flange, tip],
    [z1 - DIN.flange, hat],
    [z0 - 0.5, hat],
  ];
}

export const dinRailBuilder: AttachmentBuilder<DinRailOptions> = {
  body(w, s, o, layout) {
    const L = layout.w;
    const yc = layout.h / 2;
    const zy = (pts: Vec2[], dir: number): Vec2[] => pts.map(([z, y]) => [-z, yc + dir * y]);
    const add: Manifold[] = [s.t(boxAt(w, 0, 0, 0, L, layout.h, DIN.plate))];
    for (const dir of [1, -1]) add.push(prismX(w, s, zy(dinHalf(o), dir), 0, L));
    if (o.stops) {
      const z1 = DIN.plate + +o.depth;
      const { stop: S, ramp: R, stopOut: U } = DIN;
      const tooth = (x: number, d: number): Vec2[] =>
        [
          [x, z1 - 1],
          [x + d * (S + R), z1 - 1],
          [x + d * (S + R), z1],
          [x + d * S, z1 + U],
          [x, z1 + U],
        ].map(([px, z]) => [px, -z]);
      const band = DIN.width / 2 - (DIN.hat / 2 - DIN.wall);
      for (const [x, d] of [
        [0, 1],
        [L, -1],
      ])
        for (const y0 of [yc + DIN.hat / 2 - DIN.wall, yc - DIN.width / 2]) add.push(prismY(w, s, tooth(x, d), y0, band));
    }
    return s.t(w.Manifold.union(add));
  },
};
