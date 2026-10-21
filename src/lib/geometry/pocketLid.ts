/**
 * Pocket-grid lid: a stacking lid (lid.ts) whose top is a pocket grid instead
 * of the receptacles, so bits, batteries or drill bits sit on top of a closed
 * bin. It has the same feet, seated in the bin's lip, and a solid block from
 * the top of the feet up to the pocket depth, with the pockets cut by the
 * pocket engine (pockets.ts: presets, graduated sets, bottoms, lean, grips,
 * magnets). Its pocket settings are the bin's own pocket fields with the
 * lid's overrides (`lidPockets`) on top, like a pocket compartment's.
 *
 * Prints feet down, like a bin; the pockets open upward.
 *
 * Must not import lid.ts (lid.ts imports this module).
 */
import { Scope, assertValid, toMeshData, type MeshData, type Wasm } from './kernel';
import { BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS } from './spec';
import { extrudePolygon, roundedRectRing } from './shapes';
import { binCells, binSize, buildFeet, type BinCells, type BinOptions } from './bin';
import { compartmentPocketOpts, type PocketSettings } from './compartments';
import { pocketKeyPart, sanitizePocketFields, type PocketFields } from './variants';
import { pocketFill, regionPocketCutters, regionPocketLayout, type PocketLayout } from './pockets';

export const POCKET_LID = {
  /** Solid plate between the top of the feet and the pocket floors (as the stacking lid's). */
  plate: 1.25,
  /** Rim around the pocket grid. */
  rim: 1.5,
  /** Nothing is cut closer than this to the outside. */
  keep: 0.8,
  /** Magnet recesses keep this much above the bottom of the plate. */
  magnetFloor: 0.6,
  /** Tallest fill. */
  maxDepth: 200,
} as const;

type LidOpts = Pick<BinOptions, 'unitsX' | 'unitsY'> & Partial<BinOptions>;

/** The lid's top is a pocket grid. */
export const isPocketLid = (o: Partial<Pick<BinOptions, 'lidStyle'>>) => o.lidStyle === 'pockets';

/** The pocket-grid lid's pocket settings: the bin's pocket fields, then the lid's own. */
export function lidPocketOpts(o: LidOpts): PocketFields {
  return sanitizePocketFields(compartmentPocketOpts(o as BinOptions, { pockets: o.lidPockets }) as PocketSettings);
}

/** Pocket floors' height in the lid. */
const LID_POCKET_FLOOR = BASE_PROFILE_HEIGHT + POCKET_LID.plate;

/** The lid's pocket grid (bin-centered mm), laid out on top of a W × D lid. */
export function pocketLidLayout(o: LidOpts, cells?: Partial<BinCells> | null): PocketLayout {
  const { w: W, d: D } = binSize(o, cells);
  const r = POCKET_LID.rim;
  const zf = LID_POCKET_FLOOR;
  return regionPocketLayout(lidPocketOpts(o), { x0: -W / 2 + r, y0: -D / 2 + r, x1: W / 2 - r, y1: D / 2 - r }, zf, zf + POCKET_LID.maxDepth, BASE_PROFILE_HEIGHT + POCKET_LID.magnetFloor);
}

/** Overall height of a pocket-grid lid: the top of its fill (it doesn't depend on the footprint). */
export function pocketLidHeight(o: LidOpts): number {
  const zf = LID_POCKET_FLOOR;
  return pocketFill(lidPocketOpts(o), zf, zf + POCKET_LID.maxDepth, BASE_PROFILE_HEIGHT + POCKET_LID.magnetFloor).fillTop;
}

/** Mesh-key part for the lid's pockets. */
export function pocketLidKeyPart(o: LidOpts): string {
  return `P{${pocketKeyPart(lidPocketOpts(o))}}`;
}

/** Build a pocket-grid lid centered on the origin in XY with its bottom at z = 0. */
export function buildPocketLid(w: Wasm, o: LidOpts, cellsIn?: Partial<BinCells> | null): MeshData {
  const cells = binCells(o, cellsIn);
  const { w: W, d: D } = binSize(o, { x: cells.x, y: cells.y });
  const s = new Scope();
  try {
    const L = pocketLidLayout(o, { x: cells.x, y: cells.y });
    const top = L.fillTop;
    const ring = (inset: number) => roundedRectRing(-W / 2 + inset, -D / 2 + inset, W / 2 - inset, D / 2 - inset, BASE_TOP_RADIUS - inset);
    let block = s.t(extrudePolygon(w, ring(0), BASE_PROFILE_HEIGHT, top));
    const cut = regionPocketCutters(w, s, lidPocketOpts(o), L, LID_POCKET_FLOOR, top + 1);
    if (cut.length) {
      const keep = s.t(extrudePolygon(w, ring(POCKET_LID.keep), BASE_PROFILE_HEIGHT + 0.3, top + 2));
      block = s.t(block.subtract(s.t(s.t(w.Manifold.union(cut)).intersect(keep))));
    }
    const lid = s.t(w.Manifold.union([block, ...buildFeet(w, s, { ...o, base: 'standard' }, { x: cells.x, y: cells.y })]));
    assertValid(lid, 'pocket lid');
    return toMeshData(lid);
  } finally {
    s.dispose();
  }
}
