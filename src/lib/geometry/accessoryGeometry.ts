/**
 * Accessory geometry entry points: what buildBin adds to and cuts from a bin,
 * and the builder for each printed accessory part.
 *
 * Must not import bin.ts at runtime (bin.ts imports this module).
 */
import type { Manifold, MeshData, Scope, Wasm } from './kernel';
import { planAccessories, wantsRails, wantsSlideLid, wantsTray, type AccessoryOpts, type AccessoryPart } from './accessories';
import { buildTray, trayLedges } from './trays';
import { buildSlideLid, slideLidBinParts } from './slidingLid';
import { buildRailPlate, railBinParts } from './rails';

export interface AccessoryGeometry {
  /** Unioned onto the bin (ledges, wall band, ribs). */
  add: Manifold[];
  /** Taken out of the finished bin, with the wall cutouts (grooves, front cut, plate paths). */
  cut: Manifold[];
  /**
   * Last step, keeping the bin one solid: a plate path parallel to a wall can
   * cut the front off a label tab it runs through (that loose piece is
   * dropped), and a low ledge can close off a pocket against a rounded
   * compartment corner (that void is filled).
   */
  finish(bin: Manifold): Manifold;
}

/** The bin-side geometry of a bin's accessories (bin-centered, W × D outer size). Empty for bins without any. */
export function binAccessoryGeometry(w: Wasm, s: Scope, o: AccessoryOpts, W: number, D: number): AccessoryGeometry {
  const out: AccessoryGeometry = { add: [], cut: [], finish: (bin) => bin };
  if (!wantsTray(o) && !wantsSlideLid(o) && !wantsRails(o)) return out;
  const p = planAccessories(o, W, D);
  if (p.tray || p.slide || p.rails) out.finish = (bin) => largestPiece(s, bin);
  if (p.tray) out.add.push(...trayLedges(w, s, p.tray, W, D, p.zFloor));
  if (p.slide) {
    const g = slideLidBinParts(w, s, p.slide, W, D, p.H, p.zFloor);
    out.add.push(...g.add);
    out.cut.push(...g.cut);
  }
  if (p.rails) {
    const g = railBinParts(w, s, p.rails, W, D, p.zFloor);
    out.add.push(...g.add);
    out.cut.push(...g.cut);
  }
  return out;
}

/** The biggest connected piece of a solid, without inner voids (the solid itself when it is one piece). */
function largestPiece(s: Scope, m: Manifold): Manifold {
  const pieces = m.decompose().map((x) => s.t(x));
  if (pieces.length <= 1) return m;
  return pieces.reduce((a, b) => (b.volume() > a.volume() ? b : a));
}

/** Build a printed accessory part, min corner at the origin, bottom at z = 0. */
export function buildAccessoryPart(w: Wasm, part: AccessoryPart): MeshData {
  if (part.type === 'tray') return buildTray(w, part);
  if (part.type === 'slideLid') return buildSlideLid(w, part);
  return buildRailPlate(w, part);
}
