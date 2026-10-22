/**
 * French cleat geometry (planning in cleatStrip.ts). The strip's profile
 * (out from the board z, up y): the back up to `hb`, the bevel rising at
 * the angle to a 1 mm flat at the front, the front down to the bed.
 *
 * The hanger, drawn where it hangs on the strip: its cleat's underside the
 * bevel moved 0.3 mm off it (square to the bevel), its back on the board,
 * its plate 0.3 clear of the strip's front, two M4 holes through it.
 */
import { Scope, assertValid, toMeshData, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import { prismX } from '../mount';
import type { AttachmentBuilder } from '../build';
import type { MountCtx } from '../registry';
import { HANGER, cleatProfile, hangerAt, type CleatStripOptions } from './cleatStrip';

/** Points in (z, y) to prismX's (d, y). */
const zy = (pts: Vec2[]): Vec2[] => pts.map(([z, y]) => [-z, y]);

/** The strip's profile in (z, y). */
export function cleatSection(o: CleatStripOptions, ctx: MountCtx): Vec2[] {
  const { hb, h, rise, tan } = cleatProfile(o, ctx);
  return [
    [0, 0],
    [o.size, 0],
    [o.size, h],
    [rise / tan, h],
    [0, hb],
  ];
}

/** The hanger where it hangs, in the strip's frame. */
export function cleatHanger(w: Wasm, s: Scope, o: CleatStripOptions, ctx: MountCtx): Manifold {
  const { hb, tan } = cleatProfile(o, ctx);
  const a = hangerAt(o, ctx);
  const { gap: g, plate: P, height: Hh } = HANGER;
  const D = o.size;
  const top = a.y + Hh;
  // The bevel moved g square to it: g / cos up.
  const lift = g * Math.sqrt(1 + tan * tan);
  const zp = D + g;
  const cleat = prismX(
    w,
    s,
    zy([
      [0, hb + lift],
      [zp, hb + zp * tan + lift],
      [zp + 0.5, hb + zp * tan + lift],
      [zp + 0.5, top],
      [0, top],
    ]),
    a.x,
    a.w,
  );
  const plate = s.t(boxAt(w, a.x, a.y, zp, a.x + a.w, top, zp + P));
  const holes = [-1, 1].map((d) => s.t(cylinderAt(w, a.x + a.w / 2 + (d * a.w) / 4, a.y + 10, -1, zp + P + 1, 2.25)));
  return s.t(s.t(cleat.add(plate)).subtract(s.t(w.Manifold.union(holes))));
}

export const cleatStripBuilder: AttachmentBuilder<CleatStripOptions> = {
  body(w, s, o, layout, ctx) {
    return prismX(w, s, zy(cleatSection(o, ctx)), 0, layout.w);
  },
  part(w, spec: CleatStripOptions, ctx) {
    const s = new Scope();
    try {
      // Face down: half a turn about y, its front on the bed.
      const p = s.t(cleatHanger(w, s, spec, ctx).rotate([0, 180, 0]));
      const b = p.boundingBox();
      const out = s.t(p.translate([-b.min[0], -b.min[1], -b.min[2]]));
      assertValid(out, 'cleat hanger');
      return toMeshData(out);
    } finally {
      s.dispose();
    }
  },
};
