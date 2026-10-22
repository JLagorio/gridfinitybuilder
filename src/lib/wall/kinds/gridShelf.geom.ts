import type { Vec2 } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { GRID } from '../../geometry/spec';
import { prismX } from '../mount';
import type { AttachmentBuilder } from '../build';
import { GRID_TOP } from './grid';
import { receptacleCuts } from './grid.geom';
import { SHELF, shelfSide, type GridShelfOptions } from './gridShelf';

/** Side views are in (z out from the board, y up); prismX takes (d, y), d = −z. */
const side = (pts: Vec2[]): Vec2[] => pts.map(([z, y]) => [-z, y]);

export const gridShelfBuilder: AttachmentBuilder<GridShelfOptions> = {
  body(w, s, o, layout) {
    const W = layout.w;
    const H = layout.h;
    const P = SHELF.plate;
    const T = GRID_TOP;
    const L = o.cellsY * GRID;
    const sd = shelfSide(o);
    const { s: sn, c: cs, run, y0, top } = sd;

    // The shelf laid flat, its back-bottom edge at the origin: x across, y up, z out along it.
    let slab = s.t(boxAt(w, 0, 0, 0, W, T, run));
    // Receptacles cut in the XY plane open up +Z; turned so they open up +y, cells from z = root.
    const cuts = receptacleCuts(w, s, o.cellsX, o.cellsY, SHELF.cheek, -SHELF.root - L, o.magnets);
    slab = s.t(slab.subtract(s.t(cuts.rotate([-90, 0, 0]))));
    slab = s.t(w.Manifold.union([slab, s.t(boxAt(w, 0, 0, SHELF.root + L, W, T + o.lip, run))]));
    // Tilted about its back-bottom edge (front down), on the back plate's face.
    if (o.tilt) slab = s.t(slab.rotate([o.tilt, 0, 0]));
    slab = s.t(slab.translate([0, y0, P]));

    // Under and behind it down to the bed, and a 45° fillet along its root: reaching 0.5 mm into it, so no faces meet edge on.
    const zFront = P + run * cs;
    const at = (u: number, v: number): Vec2 => [P + u * cs + v * sn, y0 - u * sn + v * cs];
    const under: Vec2[] = o.tilt ? [[zFront, 0], at(run - 0.5, 0.5)] : [];
    const fill: Vec2[] = [[0, 0], ...under, at(0.5, 0.5), at(SHELF.root, T), [P, top + SHELF.root], [0, top + SHELF.root]];
    // Cheeks: from the top of the back plate down to the top of the front lip.
    const cheek: Vec2[] = [
      [0, 0],
      [zFront, 0],
      [sd.depth, (T + o.lip) * cs],
      [P, H],
      [0, H],
    ];
    return s.t(
      w.Manifold.union([
        s.t(boxAt(w, 0, 0, 0, W, H, P)),
        slab,
        prismX(w, s, side(fill), 0, W),
        prismX(w, s, side(cheek), 0, SHELF.cheek),
        prismX(w, s, side(cheek), W - SHELF.cheek, SHELF.cheek),
      ]),
    );
  },
};
