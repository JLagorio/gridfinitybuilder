import { boxAt } from '../../geometry/shapes';
import type { AttachmentBuilder } from '../build';
import { GRID_TOP } from './grid';
import { receptacleCuts } from './grid.geom';
import { PLATE_LEDGE, type GridPlateOptions } from './gridPlate';

/** A baseplate facing out of the board (+z), the ledge under its bottom row. */
export const gridPlateBuilder: AttachmentBuilder<GridPlateOptions> = {
  body(w, s, o, layout) {
    const y0 = o.ledge ? PLATE_LEDGE.t : 0;
    const plate = s.t(boxAt(w, 0, 0, 0, layout.w, layout.h, GRID_TOP));
    const cut = s.t(plate.subtract(receptacleCuts(w, s, o.cellsX, o.cellsY, 0, y0, o.magnets)));
    if (!o.ledge) return cut;
    return s.t(w.Manifold.union([cut, s.t(boxAt(w, 0, 0, 0, layout.w, PLATE_LEDGE.t, GRID_TOP + PLATE_LEDGE.out))]));
  },
};
