/**
 * Spool rack geometry (planning in spoolRack.ts), in the part's frame: x
 * across, y up, z out from the board.
 *
 * An arm's side (z, y) is everything under one line, so nothing on it hangs
 * over: from the strip down at 45° to the pockets' height, level over the
 * pocket, then the guard's height out to the tip. The pocket is a round-
 * bottomed U cut down into it from the arm's inner face to a stop on the
 * outside. The guard's feed holes are teardrops (a 45° point on top) and its
 * teeth 45° on both flanks.
 */
import { Scope, assertValid, toMeshData, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import { prismX, prismZ } from '../mount';
import type { AttachmentBuilder } from '../build';
import { cornerGusset } from './shelf.geom';
import { SPOOL, SPOOL_FLAT, SPOOL_TEETH, pegPlan, spoolPlan, type SpoolRackOptions } from './spoolRack';

const SEGS = 48;
const TOOTH = SPOOL_TEETH;

/** (z, y) points to prismX's (d, y). */
const zy = (pts: Vec2[]): Vec2[] => pts.map(([z, y]) => [-z, y]);

/** A round bar along x from x0, `length` long, its axis at (y, z). */
function bar(w: Wasm, s: Scope, x0: number, length: number, r: number, y: number, z: number): Manifold {
  return s.t(s.t(s.t(w.Manifold.cylinder(length, r, r, SEGS)).rotate([0, 90, 0])).translate([x0, y, z]));
}

/** A teardrop (front view): a circle at (x, y) with a 45° point on top. */
function teardrop(x: number, y: number, r: number): Vec2[] {
  const pts: Vec2[] = [];
  // From 45° down round the bottom to 135°, then the point.
  for (let i = 0; i <= 24; i++) {
    const a = ((45 - (270 * i) / 24) * Math.PI) / 180;
    pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
  }
  pts.push([x, y + r * Math.SQRT2]);
  return pts;
}

function axleBody(w: Wasm, s: Scope, o: SpoolRackOptions, H: number): Manifold {
  const g = spoolPlan(o);
  const W = g.w;
  // The arm's side.
  const zf = Math.min(g.zc + g.pocket + SPOOL.lip, o.guard ? g.zg : Infinity);
  const zb = g.zc - g.pocket - SPOOL.lip;
  const side: Vec2[] = [[0, 0]];
  if (o.guard) side.push([g.reach, 0], [g.reach, g.hg], [zf, g.hg]);
  else side.push([zf, 0]);
  side.push([zf, g.yp], [zb, g.yp]);
  if (zb > H - g.yp) side.push([zb - (H - g.yp), H], [0, H]);
  else side.push([0, g.yp + zb]);
  const arm = (x0: number) => prismX(w, s, zy(side), x0, g.arm);
  const parts = [s.t(boxAt(w, 0, 0, 0, W, H, SPOOL.back)), arm(0), arm(W - g.arm)];
  const cuts: Manifold[] = [];
  // Open U pockets from the arms' inner faces, a stop left on the outside.
  const pocket = (x0: number, x1: number) =>
    cuts.push(bar(w, s, x0, x1 - x0, g.pocket, g.yc, g.zc), s.t(boxAt(w, x0, g.yc, g.zc - g.pocket, x1, H + 1, g.zc + g.pocket)));
  pocket(SPOOL.stop, g.arm + 1);
  pocket(W - g.arm - 1, W - SPOOL.stop);
  if (o.guard) {
    const z0 = g.zg;
    const z1 = g.reach;
    parts.push(s.t(boxAt(w, 0, 0, z0, W, g.hg, z1)));
    if (o.teeth) {
      // Teeth along the top between the arms, to tear tape on.
      const n = Math.floor((W - 2 * g.arm) / TOOTH.p);
      const xa = (W - n * TOOTH.p) / 2;
      const t: Vec2[] = [
        [xa, g.hg - 0.5],
        [xa + n * TOOTH.p, g.hg - 0.5],
        [xa + n * TOOTH.p, g.hg],
      ];
      for (let i = n - 1; i >= 0; i--) t.push([xa + (i + 0.5) * TOOTH.p, g.hg + TOOTH.h], [xa + i * TOOTH.p, g.hg]);
      parts.push(prismZ(w, s, t, z0, z1));
    }
    // A feed hole before each spool, at the axle's height.
    if (o.eyelet) for (const x of g.xs) cuts.push(prismZ(w, s, teardrop(x, g.yc, o.eyelet / 2), z0 - 1, z1 + 1));
  }
  return s.t(s.t(w.Manifold.union(parts)).subtract(s.t(w.Manifold.union(cuts))));
}

function pegBody(w: Wasm, s: Scope, o: SpoolRackOptions, H: number): Manifold {
  const g = pegPlan(o);
  const T = 3;
  const big = Math.min(g.d - SPOOL.back, H - T, 40);
  const parts = [
    s.t(boxAt(w, 0, 0, 0, g.w, H, SPOOL.back)),
    s.t(boxAt(w, 0, 0, 0, g.w, T, g.d)),
    cornerGusset(w, s, SPOOL.back, T, Math.min(3, H - T - 0.5), 0, g.w),
    cornerGusset(w, s, SPOOL.back, T, big, 0, 3),
    cornerGusset(w, s, SPOOL.back, T, big, g.w - 3, 3),
  ];
  // Pegs standing on the shelf, their tops chamfered at 45°.
  const c = Math.min(1, g.r / 2);
  for (let j = 0; j < o.rows; j++)
    for (let k = 0; k < o.count; k++) {
      const x = 3 + g.p / 2 + k * g.p;
      const z = g.z0 + j * g.p;
      const peg = s.t(
        w.Manifold.union([s.t(cylinderAt(w, 0, 0, T - 0.1, T + g.h - c, g.r, g.r, 32)), s.t(cylinderAt(w, 0, 0, T + g.h - c, T + g.h, g.r, g.r - c, 32))]),
      );
      parts.push(s.t(s.t(peg.rotate([-90, 0, 0])).translate([x, 0, z])));
    }
  return s.t(w.Manifold.union(parts));
}

/** An extra part: the printed axle, or a hub. */
type SpoolPart = { p: 'axle'; r: number; length: number } | { p: 'hub'; f: number; bore: number; hole: number; boss: number };

export const spoolRackBuilder: AttachmentBuilder<SpoolRackOptions> = {
  body(w, s, o, layout) {
    return o.mode === 'pegs' ? pegBody(w, s, o, layout.h) : axleBody(w, s, o, layout.h);
  },
  part(w, spec: SpoolPart) {
    const s = new Scope();
    try {
      let m: Manifold;
      if (spec.p === 'axle') {
        // Lying along x, cut flat underneath so it needs no support.
        const flat = SPOOL_FLAT * spec.r;
        const rod = bar(w, s, 0, spec.length, spec.r, spec.r, flat);
        m = s.t(rod.subtract(s.t(boxAt(w, -1, -1, -spec.r - 1, spec.length + 1, 2 * spec.r + 1, 0))));
      } else {
        // Flange down, the boss on it, a hole through for the axle.
        const c = spec.f / 2;
        const solid = s.t(
          w.Manifold.union([
            s.t(cylinderAt(w, c, c, 0, SPOOL.flange, c, c, 64)),
            s.t(cylinderAt(w, c, c, SPOOL.flange - 0.1, SPOOL.flange + spec.boss, (spec.bore - 0.5) / 2, (spec.bore - 0.5) / 2, 64)),
          ]),
        );
        m = s.t(solid.subtract(s.t(cylinderAt(w, c, c, -1, SPOOL.flange + spec.boss + 1, spec.hole / 2, spec.hole / 2, 40))));
      }
      const b = m.boundingBox();
      const out = s.t(m.translate([-b.min[0], -b.min[1], -b.min[2]]));
      assertValid(out, `spool rack ${spec.p}`);
      return toMeshData(out);
    } finally {
      s.dispose();
    }
  },
};
