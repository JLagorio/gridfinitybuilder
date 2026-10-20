/**
 * Stacking lid for a bin: a plate that sits in the bin's stacking lip on
 * Gridfinity feet (one per cell, like a bin) and has a lip-style receptacle
 * per cell on top, so another bin stacks on the lid exactly as it would on a
 * bin. After Gridfinity Extended's baseplate lid. Prints feet down, like a bin.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from './kernel';
import { BASE_PROFILE, BASE_PROFILE_DEPTH, BASE_PROFILE_HEIGHT, BASE_TOP, BASE_TOP_RADIUS, GRID, LIP_HEIGHT, LIP_PROFILE, LIP_TOP_FLAT, LIP_DEPTH } from './spec';
import { extrudePolygon, loftRoundedRect, roundedRectRing } from './shapes';
import { binCells, binSize, type BinCells, type BinOptions } from './bin';
import { binBodyHeight, cellRects } from './variants';

/** Solid plate between the top of the feet and the bottom of the receptacles. */
export const LID_PLATE = 1.25;
/** Bottom of the receptacles on top of the lid. */
export const LID_FLOOR = BASE_PROFILE_HEIGHT + LID_PLATE;
/** Overall lid height. */
export const LID_HEIGHT = LID_FLOOR + LIP_HEIGHT - LIP_TOP_FLAT;
/**
 * A foot seated in a stacking lip sits this far below where the lip starts:
 * the 45° faces of the foot (2.15 mm) and the lip (1.9 mm) meet 0.35 mm lower.
 */
export const LID_SEAT_DROP = BASE_PROFILE_HEIGHT - LIP_HEIGHT;

type LidOpts = Pick<BinOptions, 'unitsX' | 'unitsY'>;

/** A lid is printed for a bin that asks for one and has a lip to hold it. */
export function hasLid(o: Pick<BinOptions, 'lid' | 'lip'>): boolean {
  return !!o.lid && !!o.lip;
}

/** Height of a bin with its lid on (the lid seats in the lip), from the bin's bottom. */
export function lidStackHeight(o: Pick<BinOptions, 'heightUnits' | 'lip'> & Partial<BinOptions>): number {
  return binBodyHeight(o) - LID_SEAT_DROP + LID_HEIGHT;
}

export function lidSize(o: LidOpts, cells?: Partial<BinCells> | null) {
  const { w, d } = binSize(o, cells);
  return { w, d, h: LID_HEIGHT };
}

/** Stable key: lids only depend on the footprint. */
export function lidKey(o: LidOpts, cells?: Partial<BinCells> | null): string {
  const c = binCells(o, cells);
  return `${c.x.join('/')}x${c.y.join('/')}`;
}

/** Build a lid centered on the origin in XY with its bottom at z = 0. */
export function buildBinLid(w: Wasm, o: LidOpts, cellsIn?: Partial<BinCells> | null): MeshData {
  const cells = binCells(o, cellsIn);
  const { w: W, d: D } = binSize(o, cells);
  const gap = GRID - BASE_TOP;
  const s = new Scope();
  try {
    const solids: Manifold[] = [];
    const receptacles: Manifold[] = [];
    for (const c of cellRects(cells)) {
      const cw = c.cw - gap;
      const cd = c.cd - gap;
      solids.push(
        s.t(
          loftRoundedRect(w, c.cx, c.cy, cw, cd, BASE_TOP_RADIUS, [
            { z: 0, inset: BASE_PROFILE_DEPTH },
            { z: BASE_PROFILE.chamfer1, inset: BASE_PROFILE.chamfer2 },
            { z: BASE_PROFILE.chamfer1 + BASE_PROFILE.vertical, inset: BASE_PROFILE.chamfer2 },
            { z: BASE_PROFILE_HEIGHT, inset: 0 },
            { z: BASE_PROFILE_HEIGHT + 0.25, inset: 0 },
          ]),
        ),
      );
      receptacles.push(
        s.t(
          loftRoundedRect(w, c.cx, c.cy, cw, cd, BASE_TOP_RADIUS, [
            { z: LID_FLOOR, inset: LIP_DEPTH },
            { z: LID_FLOOR + LIP_PROFILE.chamfer1, inset: LIP_PROFILE.chamfer2 },
            { z: LID_FLOOR + LIP_PROFILE.chamfer1 + LIP_PROFILE.vertical, inset: LIP_PROFILE.chamfer2 },
            { z: LID_FLOOR + LIP_HEIGHT, inset: 0 },
            { z: LID_FLOOR + LIP_HEIGHT + 1, inset: -1 },
          ]),
        ),
      );
    }
    const plate = s.t(extrudePolygon(w, roundedRectRing(-W / 2, -D / 2, W / 2, D / 2, BASE_TOP_RADIUS), BASE_PROFILE_HEIGHT, LID_HEIGHT));
    solids.push(s.t(plate.subtract(s.t(w.Manifold.union(receptacles)))));
    const lid = s.t(w.Manifold.union(solids));
    assertValid(lid, 'lid');
    return toMeshData(lid);
  } finally {
    s.dispose();
  }
}
