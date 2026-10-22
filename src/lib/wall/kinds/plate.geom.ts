import type { Manifold, Vec2 } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import { prismZ } from '../mount';
import type { AttachmentBuilder } from '../build';
import { PI_STANDOFF, PLATE, PLATE_SCREWS, gridHoles, magnetSpots, patternHoles, tieBoxes, type PlateOptions } from './plate';

/** A circle `r` round (x, y) drawn to a point at the top, so it prints standing up without support. */
export function teardrop(x: number, y: number, r: number, n = 24): Vec2[] {
  const pts: Vec2[] = [[x, y + r * Math.SQRT2]];
  for (let k = 0; k <= n; k++) {
    const a = (3 * Math.PI) / 4 + ((k / n) * (3 * Math.PI)) / 2;
    pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
  }
  return pts;
}

export const plateBuilder: AttachmentBuilder<PlateOptions> = {
  body(w, s, o, layout, ctx) {
    const W = layout.w;
    const H = layout.h;
    const T = o.thick;
    const cuts: Manifold[] = [];
    if (o.magnets) for (const [x, y] of magnetSpots(W, H)) cuts.push(s.t(cylinderAt(w, x, y, T - PLATE.magnetDepth, T + 1, PLATE.magnet / 2)));
    for (const [x0, y0, x1, y1] of tieBoxes(o, layout, ctx)) {
      // Two slots through, and a channel across the back between them for the tie to pass behind.
      cuts.push(s.t(boxAt(w, x0, y0, -1, x0 + PLATE.slotW, y1, T + 1)), s.t(boxAt(w, x1 - PLATE.slotW, y0, -1, x1, y1, T + 1)));
      cuts.push(s.t(boxAt(w, x0, y0, -1, x1, y1, PLATE.channel)));
    }
    const adds: Manifold[] = [];
    const pilots: Manifold[] = [];
    const pat = patternHoles(o, W, H);
    if (o.pattern === 'pi' || o.pattern === 'piZero') {
      // Standoffs on the front, pointed at the top (no overhang), each with a blind pilot hole for an M2.5 screw.
      const r = PI_STANDOFF.d / 2;
      for (const [x, y] of pat.at) {
        adds.push(prismZ(w, s, teardrop(x, y, r), T - 1.5, T + PI_STANDOFF.h));
        pilots.push(s.t(cylinderAt(w, x, y, 1.2, T + PI_STANDOFF.h + 1, PI_STANDOFF.pilot / 2)));
      }
    } else if (o.pattern !== 'grid') {
      // A device's holes, countersunk from the back like the grid's.
      const [hole, head] = PLATE_SCREWS[/vesa/.test(o.pattern) ? 'm4' : 'm3'];
      for (const [x, y] of pat.at)
        cuts.push(s.t(cylinderAt(w, x, y, -1, T + 1, hole / 2)), s.t(cylinderAt(w, x, y, -0.01, (head - hole) / 2, head / 2 + 0.01, hole / 2)));
    } else if (o.screws !== 'none') {
      const [hole, head] = PLATE_SCREWS[o.screws];
      const r = hole / 2;
      const R = head / 2;
      // A grid centred on the plate, each hole clear of the edges, the mounts, the magnets and the zip-tie slots;
      // countersunk from the back: the head sits flush where the plate meets the board.
      for (const [x, y] of gridHoles(o, ctx)) cuts.push(s.t(cylinderAt(w, x, y, -1, T + 1, r)), s.t(cylinderAt(w, x, y, -0.01, R - r, R + 0.01, r)));
    }
    if (o.tape) cuts.push(s.t(boxAt(w, PLATE.tapeIn, PLATE.tapeIn, T - PLATE.tapeDepth, W - PLATE.tapeIn, H - PLATE.tapeIn, T + 1)));
    let plate = s.t(boxAt(w, 0, 0, 0, W, H, T));
    if (cuts.length) plate = s.t(plate.subtract(s.t(w.Manifold.union(cuts))));
    // Standoffs go on after the tape recess, their pilot holes through them.
    if (adds.length) plate = s.t(s.t(w.Manifold.union([plate, ...adds])).subtract(s.t(w.Manifold.union(pilots))));
    return plate;
  },
};
