import { Scope, assertValid, toMeshData, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX } from '../mount';
import type { AttachmentBuilder } from '../build';
import { ROD, ROD_FLAT, rodGeometry, type RodOptions } from './rod';

const SEGS = 48;

/** A round bar along x from x0, `length` long, its axis at (y, z). */
function bar(w: Wasm, s: Scope, x0: number, length: number, r: number, y: number, z: number): Manifold {
  return s.t(s.t(s.t(w.Manifold.cylinder(length, r, r, SEGS)).rotate([0, 90, 0])).translate([x0, y, z]));
}

export const rodBuilder: AttachmentBuilder<RodOptions> = {
  body(w, s, o, layout) {
    const W = layout.w;
    const H = layout.h;
    const g = rodGeometry(o);
    const top = g.y + g.pocket;
    // The arm's side: flat on the bed, up to the pocket's top at the tip, then up at 45° to the strip.
    const back = g.z - g.pocket;
    const profile: Vec2[] = [
      [0, 0],
      [-g.reach, 0],
      [-g.reach, top],
      [-back, top],
    ];
    if (back > H - top) profile.push([-(back - (H - top)), H], [0, H]);
    else profile.push([0, top + back]);
    const arm = (x0: number) => prismX(w, s, profile, x0, ROD.arm);
    const body = s.t(w.Manifold.union([s.t(boxAt(w, 0, 0, 0, W, H, ROD.back)), arm(0), arm(W - ROD.arm)]));
    // Open U pockets from the arms' inner faces, a stop left on the outside.
    const pocket = (x0: number, x1: number) =>
      s.t(w.Manifold.union([bar(w, s, x0, x1 - x0, g.pocket, g.y, g.z), s.t(boxAt(w, x0, g.y, g.z - g.pocket, x1, H + 1, g.z + g.pocket))]));
    return s.t(body.subtract(s.t(w.Manifold.union([pocket(ROD.stop, ROD.arm + 1), pocket(W - ROD.arm - 1, W - ROD.stop)]))));
  },
  part(w, spec: { r: number; length: number }) {
    const s = new Scope();
    try {
      // Lying along x, cut flat underneath so it needs no support.
      const flat = ROD_FLAT * spec.r;
      const rod = bar(w, s, 0, spec.length, spec.r, spec.r, flat);
      const cut = s.t(rod.subtract(s.t(boxAt(w, -1, -1, -spec.r - 1, spec.length + 1, 2 * spec.r + 1, 0))));
      const b = cut.boundingBox();
      const out = s.t(cut.translate([-b.min[0], -b.min[1], -b.min[2]]));
      assertValid(out, 'roll holder rod');
      return toMeshData(out);
    } finally {
      s.dispose();
    }
  },
};
