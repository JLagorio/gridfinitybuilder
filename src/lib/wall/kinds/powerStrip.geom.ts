import type { Manifold } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import type { AttachmentBuilder } from '../build';
import { PS, stripSize, type PowerStripOptions } from './powerStrip';
import { extrudeX, sideSection } from './ledBar.geom';

export const powerStripBuilder: AttachmentBuilder<PowerStripOptions> = {
  body(w, s, o, _l, ctx) {
    const { back, floor, front, end, bracket: B } = PS;
    const { L, H, Z } = stripSize(o, ctx);
    const parts: Manifold[] = [s.t(boxAt(w, 0, 0, 0, L, H, back))];
    // The cradle's side view: floor and front lip.
    const cradle = sideSection(w, s, [
      [
        [0, 0],
        [Z, 0],
        [Z, floor + o.lip],
        [Z - front, floor + o.lip],
        [Z - front, floor],
        [0, floor],
      ],
    ]);
    const tray = o.style === 'tray' || L < 2 * B + 20;
    if (tray) parts.push(extrudeX(w, s, cradle, 0, L));
    else parts.push(extrudeX(w, s, cradle, 0, B), extrudeX(w, s, cradle, L - B, B));
    const cuts: Manifold[] = [];
    if (o.cable !== 'open') {
      // End walls up to the lip at the front and the back plate's top at the back; a notch for the cable.
      const wall = sideSection(w, s, [
        [
          [0, 0],
          [Z, 0],
          [Z, floor + o.lip],
          [back, H],
          [0, H],
        ],
      ]);
      parts.push(extrudeX(w, s, wall, 0, end), extrudeX(w, s, wall, L - end, end));
      const zm = back + (o.width + PS.c) / 2;
      const x0 = o.cable === 'left' ? -1 : L - end - 1;
      cuts.push(s.t(boxAt(w, x0, floor + 4, zm - 7, x0 + end + 2, H + 1, zm + 7)));
    }
    if (o.strap) {
      // A slot by the back and one inside the lip, at each end, for a strap round the strip and the floor.
      for (const xc of [B / 2, L - B / 2]) {
        for (const z0 of [back + 0.8, Z - front - 0.8 - PS.slot])
          cuts.push(s.t(boxAt(w, xc - PS.strap / 2, -1, z0, xc + PS.strap / 2, floor + 1, z0 + PS.slot)));
      }
    }
    const body = s.t(w.Manifold.union(parts));
    return cuts.length ? s.t(body.subtract(s.t(w.Manifold.union(cuts)))) : body;
  },
};
