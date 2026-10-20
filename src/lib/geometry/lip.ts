/**
 * Stacking lip shapes.
 *
 * - normal: the spec lip (0.7 / 1.8 / 1.9 mm) with rebuilt's 1.2 mm support
 *   under the inner tip and a 45° support taper down to the wall.
 * - reduced: Gridfinity Extended's "reduced" lip: no lower chamfer and no
 *   support; the wall runs straight up and a short 45° taper meets the riser.
 *   Bins still stack on it, and the opening is 1.3 mm wider per side.
 * - notches (Extended `lip_top_notches`): at each line between cells the lip
 *   keeps the cusp a baseplate has there, so a smaller bin stacked on top
 *   locks into one cell instead of sliding around.
 */
import type { Manifold, Scope, Wasm } from './kernel';
import { BASE_TOP, BASE_TOP_RADIUS, GRID, LIP_DEPTH, LIP_HEIGHT, LIP_PROFILE, LIP_SUPPORT_HEIGHT, WALL } from './spec';
import { hullOf, loftRoundedRect, type LoftKnot } from './shapes';
import { cellLines, cellRects, type LipStyle } from './variants';

type LipOpts = { lip: boolean; lipStyle: LipStyle };

/**
 * Knots of the cavity inside the outer wall and lip, measured from the bin's
 * outer outline. The cavity starts at `zStart` (classic bins: half a mm above
 * the wall's bottom, inside the floor).
 */
export function lipCavityKnots(o: LipOpts, H: number, wallBottom: number, zStart = wallBottom + 0.5): LoftKnot[] {
  if (!o.lip) {
    return [
      { z: zStart, inset: WALL },
      { z: H + 1, inset: WALL },
    ];
  }
  const upper: LoftKnot[] = [
    { z: H + LIP_PROFILE.chamfer1 + LIP_PROFILE.vertical, inset: LIP_PROFILE.chamfer2 },
    { z: H + LIP_HEIGHT, inset: 0 },
    { z: H + LIP_HEIGHT + 1, inset: -1 },
  ];
  if (o.lipStyle === 'reduced') {
    return [
      { z: zStart, inset: WALL },
      { z: H + LIP_PROFILE.chamfer1, inset: WALL },
      { z: H + LIP_PROFILE.chamfer1 + (LIP_PROFILE.chamfer2 - WALL), inset: LIP_PROFILE.chamfer2 },
      ...upper,
    ];
  }
  return [
    { z: zStart, inset: WALL },
    { z: H - LIP_SUPPORT_HEIGHT - (LIP_DEPTH - WALL), inset: WALL },
    { z: H - LIP_SUPPORT_HEIGHT, inset: LIP_DEPTH },
    { z: H, inset: LIP_DEPTH },
    { z: H + LIP_PROFILE.chamfer1, inset: LIP_PROFILE.chamfer2 },
    ...upper,
  ];
}

/** How far a cusp reaches in from the wall: the corner radius of a cell. */
const CUSP_DEPTH = BASE_TOP_RADIUS;
/** Half-width of the band searched for a cusp around each cell line. */
const CUSP_HALF = BASE_TOP_RADIUS + 1.5;

/**
 * Cusps on the lip at every line between cells along the outer walls: the
 * part of the lip opening near the wall that no single cell's receptacle
 * covers, with a 45° underside so it prints without support. Returned as the
 * region to take out of the lip cavity (null for a single-cell bin).
 */
export function lipNotches(
  w: Wasm,
  s: Scope,
  o: LipOpts,
  cells: { x: number[]; y: number[] },
  W: number,
  D: number,
  H: number,
  top: number,
): Manifold | null {
  if (!o.lip) return null;
  const xs = cellLines(cells.x);
  const ys = cellLines(cells.y);
  if (!xs.length && !ys.length) return null;
  // Where the underside starts: the lip's innermost line (normal), or just above the
  // reduced lip's taper (offset so the faces don't coincide).
  const zb = o.lipStyle === 'reduced' ? H + LIP_PROFILE.chamfer1 - WALL + 0.1 : H - LIP_DEPTH;
  const zTop = top;

  /** Wedge band on the front wall (inward = +Y), centered on x = 0. */
  const band = () => {
    const pts: [number, number, number][] = [];
    for (const x of [-CUSP_HALF, CUSP_HALF]) {
      pts.push([x, -1, zb - 1], [x, CUSP_DEPTH, zb + CUSP_DEPTH], [x, CUSP_DEPTH, zTop], [x, -1, zTop]);
    }
    return s.t(hullOf(w, pts));
  };
  const bands: Manifold[] = [];
  for (const x of xs) {
    bands.push(s.t(band().translate([x, -D / 2, 0])));
    bands.push(s.t(band().rotate([0, 0, 180]).translate([x, D / 2, 0])));
  }
  for (const y of ys) {
    bands.push(s.t(band().rotate([0, 0, -90]).translate([-W / 2, y, 0])));
    bands.push(s.t(band().rotate([0, 0, 90]).translate([W / 2, y, 0])));
  }

  // Each cell's own receptacle (the room a stacked foot can take), for cells on the outside.
  const gap = GRID - BASE_TOP;
  const nx = cells.x.length;
  const ny = cells.y.length;
  const receptacles: Manifold[] = [];
  for (const c of cellRects(cells)) {
    if (c.i !== 0 && c.j !== 0 && c.i !== nx - 1 && c.j !== ny - 1) continue;
    const knots: LoftKnot[] = [
      { z: zb - 2, inset: LIP_PROFILE.chamfer2 },
      { z: H + LIP_PROFILE.chamfer1 + LIP_PROFILE.vertical, inset: LIP_PROFILE.chamfer2 },
      { z: H + LIP_HEIGHT, inset: 0 },
      { z: H + LIP_HEIGHT + 1, inset: -1 },
    ];
    receptacles.push(s.t(loftRoundedRect(w, c.cx, c.cy, c.cw - gap, c.cd - gap, BASE_TOP_RADIUS, knots)));
  }
  return s.t(s.t(w.Manifold.union(bands)).subtract(s.t(w.Manifold.union(receptacles))));
}
