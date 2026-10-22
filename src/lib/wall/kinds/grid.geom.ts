import type { Manifold, Scope, Wasm } from '../../geometry/kernel';
import { cylinderAt, loftRoundedRect } from '../../geometry/shapes';
import { BP_BOTTOM_CLEARANCE, BP_CELL_RADIUS, GRID, HOLE_OFFSET } from '../../geometry/spec';
import { DEFAULT_BASEPLATE, receptacleKnots } from '../../geometry/baseplate';
import { GRID_FLOOR } from './grid';

/**
 * What to cut for `nx` × `ny` baseplate receptacles (baseplate.ts's own
 * profile), cells from (x0, y0) in the XY plane, opening up +Z from a floor
 * GRID_FLOOR thick at Z = 0; with 6 × 2 mm magnet pockets in each corner.
 */
export function receptacleCuts(w: Wasm, s: Scope, nx: number, ny: number, x0: number, y0: number, magnets: boolean): Manifold {
  const F = GRID_FLOOR;
  const knots = receptacleKnots(F, F + BP_BOTTOM_CLEARANCE);
  const { magnetDiameter, magnetFit, magnetHeight } = DEFAULT_BASEPLATE;
  const r = (magnetDiameter + magnetFit) / 2;
  const cuts: Manifold[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const cx = x0 + (i + 0.5) * GRID;
      const cy = y0 + (j + 0.5) * GRID;
      cuts.push(s.t(loftRoundedRect(w, cx, cy, GRID, GRID, BP_CELL_RADIUS, knots)));
      if (!magnets) continue;
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ])
        cuts.push(s.t(cylinderAt(w, cx + dx * HOLE_OFFSET, cy + dy * HOLE_OFFSET, F - magnetHeight - 0.2, F + 0.5, r)));
    }
  }
  return s.t(w.Manifold.union(cuts));
}
