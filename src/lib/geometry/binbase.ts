/**
 * Hollow bin bases: the inside of the bin reaches down into each foot.
 *
 * - lite (gridfinity-rebuilt-lite): the foot becomes a shell, offset 0.95 mm
 *   in from the base profile, with a 1 mm bottom. The bridge between feet is
 *   chamfered up to a thin ridge at the floor line.
 * - efficient (Gridfinity Extended efficient_floor): a pocket per cell with
 *   ~1 mm walls low down, a 0.7 mm bottom, and 5.7 mm ridges between cells.
 *
 * Compartments are cut from the hollow's bottom up, then clipped to the foot
 * pockets below the floor line, so dividers continue down into the feet
 * instead of floating over a pocket, and every surface faces up or sideways.
 */
import type { Manifold, Scope, Wasm } from './kernel';
import { BASE_HEIGHT, BASE_PROFILE, BASE_PROFILE_HEIGHT, BASE_TOP, BASE_TOP_RADIUS, GRID, WALL } from './spec';
import { boxAt, loftRings, roundedRectRing } from './shapes';
import { cellRects, EFFICIENT_FLOOR, LITE_FLOOR, type BaseStyle } from './variants';

export interface PocketLevel {
  z: number;
  /** Inset from the cell's top outline (41.5 mm for a full cell). */
  inset: number;
  /** Corner radius at this level. */
  r: number;
}

const vertTop = BASE_PROFILE.chamfer1 + BASE_PROFILE.vertical; // 2.6

/** Pocket shape per cell, bottom to top. The top level sits above the floor line. */
export function pocketLevels(base: BaseStyle): PocketLevel[] {
  if (base === 'lite') {
    const i0 = BASE_PROFILE.chamfer2 + WALL; // 3.1: the vertical band of the profile, one wall in
    return [
      { z: LITE_FLOOR, inset: i0, r: BASE_TOP_RADIUS - i0 },
      { z: vertTop, inset: i0, r: BASE_TOP_RADIUS - i0 },
      { z: BASE_PROFILE_HEIGHT, inset: WALL, r: BASE_TOP_RADIUS - WALL },
      { z: BASE_HEIGHT, inset: 0, r: BASE_TOP_RADIUS },
      { z: BASE_HEIGHT + 0.5, inset: 0, r: BASE_TOP_RADIUS },
    ];
  }
  // efficient: Extended's pad (16.5 mm corner centers, r = 1) and taper top (17 mm, r = 1.15).
  return [
    { z: EFFICIENT_FLOOR, inset: 3.25, r: 1 },
    { z: 3.5, inset: 3.25, r: 1 },
    { z: 3.65, inset: 2.6, r: 1.15 },
    { z: BASE_HEIGHT + 0.5, inset: 2.6, r: 1.15 },
  ];
}

/** Bottom of the hollow. */
export function hollowFloor(base: BaseStyle): number {
  return base === 'lite' ? LITE_FLOOR : EFFICIENT_FLOOR;
}

export const isHollowBase = (base: BaseStyle) => base === 'lite' || base === 'efficient';

function cellPocket(w: Wasm, cx: number, cy: number, hx: number, hy: number, levels: PocketLevel[]): Manifold | null {
  if (levels.some((l) => Math.min(hx, hy) - l.inset < l.r + 0.5)) return null; // too small a cell
  const rings = levels.map((l) => roundedRectRing(cx - hx + l.inset, cy - hy + l.inset, cx + hx - l.inset, cy + hy - l.inset, l.r));
  return loftRings(
    w,
    rings,
    levels.map((l) => l.z),
  );
}

/**
 * Clip an interior cut that was built down to `hollowFloor` so that below the
 * floor line it only opens the foot pockets, and keep `keep` (bosses around
 * holes) solid. Cells too small for a pocket stay solid.
 */
export function clipToHollow(
  w: Wasm,
  s: Scope,
  base: BaseStyle,
  cells: { x: number[]; y: number[] },
  W: number,
  D: number,
  zFloor: number,
  cut: Manifold,
  keep: Manifold[],
): Manifold {
  const levels = pocketLevels(base);
  const gap = GRID - BASE_TOP;
  const parts: Manifold[] = [];
  for (const c of cellRects(cells)) {
    const p = cellPocket(w, c.cx, c.cy, (c.cw - gap) / 2, (c.cd - gap) / 2, levels);
    if (p) parts.push(s.t(p));
  }
  // Everything above the floor line is cut as usual.
  parts.push(s.t(boxAt(w, -W / 2 - 1, -D / 2 - 1, zFloor - 0.01, W / 2 + 1, D / 2 + 1, 10000)));
  let region = s.t(w.Manifold.union(parts));
  if (keep.length) region = s.t(region.subtract(s.t(w.Manifold.union(keep))));
  return s.t(cut.intersect(region));
}
