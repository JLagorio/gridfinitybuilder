/**
 * Swivel tower geometry (planning in swivelTower.ts): the back plate and its
 * two arms, a tray drawn where the bottom one sits, the axle. Footprints are
 * in (x, z) seen from above.
 */
import { Scope, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX, prismY } from '../mount';
import { posed, type AttachmentBuilder } from '../build';
import { posedBy, postY, rodSolid, zy } from './hinge.geom';
import { AXLE_FLAT, SWIVEL, swivelPlan, type SwivelTowerOptions } from './swivelTower';

/** Points (x, z) seen from above to prismY's (x, d). */
const xz = (pts: Vec2[]): Vec2[] => pts.map(([x, z]) => [x, -z]);

/** A rounded rectangle (x, z) seen from above. */
function roundRect(x0: number, z0: number, x1: number, z1: number, r: number): Vec2[] {
  const pts: Vec2[] = [];
  const c: [number, number, number][] = [
    [x1 - r, z0 + r, -90],
    [x1 - r, z1 - r, 0],
    [x0 + r, z1 - r, 90],
    [x0 + r, z0 + r, 180],
  ];
  for (const [cx, cz, a0] of c)
    for (let k = 0; k <= 6; k++) pts.push([cx + r * Math.cos(((a0 + 15 * k) * Math.PI) / 180), cz + r * Math.sin(((a0 + 15 * k) * Math.PI) / 180)]);
  return pts;
}

/** An arm's footprint: round in front of the axle, square behind it to the back plate, y0..y1. */
function armFootprint(w: Wasm, s: Scope, o: SwivelTowerOptions, y0: number, y1: number): Manifold {
  const p = swivelPlan(o);
  return s.t(postY(w, s, p.xa, p.za, y0, y1, p.ra).add(s.t(boxAt(w, p.xa - p.ra, y0, SWIVEL.back - 0.5, p.xa + p.ra, y1, p.za))));
}

/** A tray where the bottom one sits: a collar round the axle, a neck, the body clear of the arms. */
function tray(w: Wasm, s: Scope, o: SwivelTowerOptions): Manifold {
  const S = SWIVEL;
  const p = swivelPlan(o);
  const y0 = p.y(0);
  const H = o.trayH;
  const { xa, za, b, rc } = p;
  const rr = Math.min(8, b - 0.01);
  const body = prismY(w, s, xz(roundRect(xa + p.body, za - b, xa + o.length, za + b, rr)), y0, H);
  const nw = 0.8 * rc;
  const neck = s.t(boxAt(w, xa, y0, za - nw, xa + p.body + 1, y0 + H, za + nw));
  const collar = postY(w, s, xa, za, y0, y0 + H + o.spacer - 0.2, rc);
  const pocket = prismY(
    w,
    s,
    xz(roundRect(xa + p.body + S.wall, za - b + S.wall, xa + o.length - S.wall, za + b - S.wall, Math.max(1, rr - S.wall))),
    y0 + S.floor,
    H,
  );
  const hole = postY(w, s, xa, za, y0 - 1, y0 + H + o.spacer + 1, o.axle / 2 + S.free);
  return s.t(s.t(s.t(body.subtract(pocket)).add(s.t(neck.add(collar)))).subtract(hole));
}

export const swivelTowerBuilder: AttachmentBuilder<SwivelTowerOptions> = {
  body(w, s, o, layout) {
    const S = SWIVEL;
    const p = swivelPlan(o);
    const H = layout.h;
    // The back plate with a foot along it (a wider first layer), the bottom arm.
    const add = [s.t(boxAt(w, 0, 0, 0, p.w, H, S.back)), s.t(boxAt(w, 0, 0, 0, p.w, S.arm, S.back + 5)), armFootprint(w, s, o, 0, S.arm)];
    // The top arm: its underside rising 45° from the back plate to its front.
    const zf = p.za + p.ra;
    const profile: Vec2[] = [
      [S.back - 0.5, p.under - (zf - S.back)],
      [zf, p.under],
      [zf, H],
      [S.back - 0.5, H],
    ];
    const r = o.axle / 2 + S.snug;
    // Round the front of the axle's hole it starts at once, 0.8 mm wide (a short bridge), not from slivers where the
    // underside's slope would cross the hole.
    const ys = p.under - (zf - (p.za + r + 0.8));
    const front = s.t(boxAt(w, p.xa - r - 0.8, 0, p.za, p.xa + r + 0.8, ys, zf + 1));
    add.push(s.t(s.t(armFootprint(w, s, o, 0, H).intersect(prismX(w, s, zy(profile), p.xa - p.ra - 1, 2 * p.ra + 2))).subtract(front)));
    // A blind socket in the bottom arm, a hole through the top one.
    const holes = [postY(w, s, p.xa, p.za, 1, S.arm + 1, r), postY(w, s, p.xa, p.za, S.arm + 1, H + 1, r)];
    return s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(holes))));
  },
  part(w, spec: SwivelTowerOptions & { p: 'tray' | 'axle' }) {
    const s = new Scope();
    try {
      if (spec.p === 'axle') return posedBy(s, rodSolid(w, s, swivelPlan(spec).axleL, spec.axle, AXLE_FLAT * spec.axle), [0, 0, 0], 'swivel tower axle');
      return posed(s, tray(w, s, spec), { pose: 'upright' }, 'swivel tray');
    } finally {
      s.dispose();
    }
  },
};
