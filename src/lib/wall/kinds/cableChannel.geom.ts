import type { Manifold } from '../../geometry/kernel';
import { Scope } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import type { AttachmentBuilder } from '../build';
import { CH, channelExits, channelSize, type CableChannelOptions } from './cableChannel';
import { extrudeX, rectZY, sideSection, turnedX } from './ledBar.geom';

export const cableChannelBuilder: AttachmentBuilder<CableChannelOptions> = {
  body(w, s, o, _l, ctx) {
    const { back, gTop, gH, gD } = CH;
    const { H, Z } = channelSize(o, ctx);
    const zf = back + o.width;
    const fl = H - o.height;
    let side = sideSection(w, s, [
      [
        [0, 0],
        [Z, 0],
        [Z, H],
        [zf, H],
        [zf, fl],
        [back, fl],
        [back, H],
        [0, H],
      ],
    ]);
    if (o.lid) {
      // Grooves for the lid's beads, and a lead-in on the walls' inside top edges.
      const g = H - gTop;
      const cut = [rectZY(back - gD, g - gH, back + 0.5, g), rectZY(zf - 0.5, g - gH, zf + gD, g)];
      cut.push(
        [
          [back - 0.6, H + 0.01],
          [back + 0.01, H - 0.6],
          [back + 0.01, H + 0.01],
        ],
        [
          [zf - 0.01, H + 0.01],
          [zf - 0.01, H - 0.6],
          [zf + 0.6, H + 0.01],
        ],
      );
      side = s.t(side.subtract(sideSection(w, s, cut)));
    }
    let m = extrudeX(w, s, side, 0, o.length);
    const notches = channelExits(o).map((x) => s.t(boxAt(w, x - CH.exit / 2, fl + 2, zf - 1, x + CH.exit / 2, H + 1, Z + 1)));
    if (notches.length) m = s.t(m.subtract(s.t(w.Manifold.union(notches))));
    return m;
  },
  part(w, spec: { length: number; H: number; Z: number; width: number; exits: number[] }) {
    const s = new Scope();
    try {
      const { back, c, plate, leg, gTop, gH, gD } = CH;
      const { H, Z } = spec;
      const zf = back + spec.width;
      // Built where it sits: the plate over the walls, a leg inside each, a bead at each leg's end.
      const top = H + c + plate;
      const y0 = H - gTop - gH + c;
      const y1 = H - gTop - c;
      const b = gD - c;
      const side = sideSection(w, s, [
        rectZY(0, H + c, Z, top),
        rectZY(back + c, y0, back + c + leg, top),
        rectZY(zf - c - leg, y0, zf - c, top),
        // Flat on top (the catch), sloping underneath (the lead-in).
        [
          [back + c + 0.2, y0],
          [back + c + 0.2, y1],
          [back - b, y1],
          [back - b, y1 - 0.3],
        ],
        [
          [zf - c - 0.2, y0],
          [zf + b, y1 - 0.3],
          [zf + b, y1],
          [zf - c - 0.2, y1],
        ],
      ]);
      let m: Manifold = extrudeX(w, s, side, 0, spec.length);
      const notches = spec.exits.map((x) => s.t(boxAt(w, x - CH.exit / 2 - 0.5, y0 - 1, zf - c - leg - 1, x + CH.exit / 2 + 0.5, H + c, Z + 1)));
      if (notches.length) m = s.t(m.subtract(s.t(w.Manifold.union(notches))));
      // Printed upside down, its plate on the bed.
      return turnedX(s, m, -90, 'cable channel lid');
    } finally {
      s.dispose();
    }
  },
};
