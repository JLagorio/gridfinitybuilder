/**
 * Gridfinity wall plate: a baseplate on the board, cells wide by cells high,
 * clips across the top of its back and studs below. Bins with magnets in
 * their bases stick to the magnets in its receptacles; a ledge along the
 * bottom carries the bottom row (and the bins stacked on it) so they can't
 * slide down.
 *
 * Printed upright, standing on its bottom edge, as it hangs: the clips need
 * it (lying on its back they'd point into the bed). The receptacles then
 * open sideways, and the baseplate profile prints without supports that way:
 * its 45° chamfers are self-supporting, and the only flat ceilings are the
 * 1.8 mm straight band and the 0.35 mm clearance at the top of each cell,
 * short ledges a printer bridges cleanly. The magnet pockets are 6.2 mm
 * round holes on their side.
 */
import { backMounts } from '../mount';
import { bool, int, obj, registerAttachment } from '../registry';
import { GRID } from '../../geometry/spec';
import { DEFAULT_WALL, WALL } from '../../geometry/wallmount';
import { GRID_TOP, gridMagnets } from './grid';

export interface GridPlateOptions {
  cellsX: number;
  cellsY: number;
  magnets: boolean;
  /** A ledge along the bottom for the bottom row to stand on. */
  ledge: boolean;
}

export const GRID_PLATE_DEFAULTS: GridPlateOptions = { cellsX: 3, cellsY: 2, magnets: true, ledge: true };

/** The ledge, as on a wall grid (geometry/wallmount.ts): its thickness under the bottom row, and how far it reaches out past the receptacles, mm. */
export const PLATE_LEDGE = { t: WALL.ledge, out: DEFAULT_WALL.ledgeHeight };

registerAttachment<GridPlateOptions>({
  type: 'gridPlate',
  defaults: GRID_PLATE_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = GRID_PLATE_DEFAULTS;
    return {
      cellsX: int(r.cellsX, 1, 8, d.cellsX),
      cellsY: int(r.cellsY, 1, 6, d.cellsY),
      magnets: bool(r.magnets, d.magnets),
      ledge: bool(r.ledge, d.ledge),
    };
  },
  layout(o, ctx) {
    const w = o.cellsX * GRID;
    const h = o.cellsY * GRID + (o.ledge ? PLATE_LEDGE.t : 0);
    const m = backMounts(w, h, ctx, { rows: 8 });
    return { w, h, depth: GRID_TOP + (o.ledge ? PLATE_LEDGE.out : 0), anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Gridfinity wall plate ${o.cellsX} × ${o.cellsY}`,
  notes: (o) =>
    o.magnets ? [] : [o.ledge ? 'Without magnets only the bottom row stays on, standing on the ledge.' : 'Without magnets or a ledge the bins fall off.'],
  hardware: (o) => gridMagnets(o.magnets, o.cellsX * o.cellsY, 'Gridfinity wall plate', 'bins need them too'),
});
