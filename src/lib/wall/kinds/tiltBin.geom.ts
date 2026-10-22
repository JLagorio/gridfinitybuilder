/**
 * Tip-out bin geometry (planning in tiltBin.ts): the frame, and the bin drawn
 * where the bottom one sits closed, so the fit between them reads plainly.
 * Side views are (z out from the board, y up); the bin's are from its pivot.
 */
import { Scope, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX } from '../mount';
import { posed, type AttachmentBuilder } from '../build';
import { PIN, type PinSpec } from './hinge';
import { holeX, pinMesh, zy } from './hinge.geom';
import { TILT, tiltPlan, type TiltBinOptions } from './tiltBin';

/** The bin's outline in side view, from its pivot: 45° chamfers under the front and the back, the arc of radius R behind the pivot. */
export function tiltOutline(o: TiltBinOptions): Vec2[] {
  const { R, d, heel } = tiltPlan(o);
  const a = TILT.a;
  const pts: Vec2[] = [
    [-d + heel, -a],
    [0, -a],
    [a, 0],
    [a, R],
  ];
  // From the top above the pivot back round the arc to just inside the back wall; the back wall's top flat, so it has no thin edge.
  const end = Math.asin(Math.min(1, (d - TILT.backW - 0.5) / R));
  for (let k = 0; k <= 24; k++) pts.push([-R * Math.sin((end * k) / 24), R * Math.cos((end * k) / 24)]);
  const yb = Math.sqrt(Math.max(0, R * R - d * d));
  pts.push([-(d - TILT.backW - 0.5), yb], [-d, yb], [-d, -a + heel]);
  return pts;
}

/** Where the stop pin is in the bin's own side view when it has tipped `deg` degrees (it turns the other way round the pivot). */
export function stopInBin(o: TiltBinOptions, deg: number): Vec2 {
  const [z, y] = tiltPlan(o).stop;
  const f = (deg * Math.PI) / 180;
  return [z * Math.cos(f) - y * Math.sin(f), z * Math.sin(f) + y * Math.cos(f)];
}

/** A hull of discs along x, x0..x1 (an arc slot from its pieces). */
function stadiumX(w: Wasm, s: Scope, a: Vec2, b: Vec2, r: number, x0: number, x1: number, ...more: Vec2[]): Manifold {
  const pts: [number, number, number][] = [];
  for (const [z, y] of [a, b, ...more])
    for (let k = 0; k < 32; k++) for (const x of [x0, x1]) pts.push([x, y + r * Math.sin((2 * Math.PI * k) / 32), z + r * Math.cos((2 * Math.PI * k) / 32)]);
  return s.t(w.Manifold.hull(pts));
}

/** The bin, closed, in the bottom bay of the frame (wall frame). */
function tiltBinSolid(w: Wasm, s: Scope, o: TiltBinOptions): Manifold {
  const T = TILT;
  const p = tiltPlan(o);
  const zP = p.zP;
  const yP = p.yP(0);
  const at = (pts: Vec2[]): Vec2[] => pts.map(([z, y]) => [zP + z, yP + y]);
  const x0 = T.side + T.gap;
  const x1 = o.width - T.side - T.gap;
  const outer = prismX(w, s, zy(at(tiltOutline(o))), x0, x1 - x0);
  // Inside: walls, a floor following the chamfer, open at the top.
  const a = T.a;
  const t = T.bottom;
  const inner: Vec2[] = [
    [-p.d + T.backW + p.heel, -a + t],
    [-t * (Math.SQRT2 - 1), -a + t],
    [a - T.front, t * Math.SQRT2 - T.front],
    [a - T.front, p.R + 5],
    [-p.d + T.backW, p.R + 5],
    [-p.d + T.backW, -a + t + p.heel],
  ];
  const xi0 = x0 + T.wall;
  const xi1 = x1 - T.wall;
  let cut = prismX(w, s, zy(at(inner)), xi0, xi1 - xi0);
  // What stays inside: a boss round each pivot (from the floor up), and the dividers.
  const keep: Manifold[] = [];
  const boss: Vec2[] = [[T.bossR, -a]];
  for (let k = 0; k <= 16; k++) boss.push([T.bossR * Math.cos((Math.PI * k) / 16), T.bossR * Math.sin((Math.PI * k) / 16)]);
  boss.push([-T.bossR, -a]);
  keep.push(prismX(w, s, zy(at(boss)), xi0 - 0.1, T.boss + 0.1), prismX(w, s, zy(at(boss)), xi1 - T.boss, T.boss + 0.1));
  for (let k = 1; k <= o.dividers; k++) {
    const x = xi0 + ((xi1 - xi0) * k) / (o.dividers + 1);
    keep.push(s.t(boxAt(w, x - T.divider / 2, -1, -1, x + T.divider / 2, yP + p.R + 10, zP + a + 1)));
  }
  cut = s.t(cut.subtract(s.t(w.Manifold.union(keep))));
  const add: Manifold[] = [s.t(outer.subtract(cut))];
  const holes: Manifold[] = [];
  // A finger pull across the middle of the front's top, its underside at 45°.
  const pw = Math.max(20, (x1 - x0) / 2);
  add.push(
    prismX(
      w,
      s,
      zy(
        at([
          [a - 0.1, p.R - 7],
          [a + T.pull, p.R - 2],
          [a + T.pull, p.R],
          [a - 0.1, p.R],
        ]),
      ),
      (o.width - pw) / 2,
      pw,
    ),
  );
  if (o.label) {
    // A card slot under the pull: a frame on the front with a 45° underside, its window and the slot behind it open at the top.
    const lw = Math.min(x1 - x0 - 8, 60);
    const xl = (o.width - lw) / 2;
    const yl = p.R - 22;
    const zF = zP + a;
    add.push(
      prismX(
        w,
        s,
        zy(
          at([
            [a - 0.1, yl - 2.1],
            [a + 2, yl],
            [a + 2, yl + 14],
            [a - 0.1, yl + 14],
          ]),
        ),
        xl,
        lw,
      ),
    );
    holes.push(
      s.t(boxAt(w, xl + 1, yP + yl + 1.5, zF, xl + lw - 1, yP + yl + 15, zF + 0.7)),
      s.t(boxAt(w, xl + 2.5, yP + yl + 3, zF + 0.5, xl + lw - 2.5, yP + yl + 15, zF + 2.1)),
    );
  }
  // Pivot holes through the sides and bosses, free on the pin; arc slots for the stop pins through the sides.
  const rf = (PIN.d + PIN.free) / 2;
  const sides: [number, number][] = [
    [x0 - 1, xi0 + T.boss + 0.5],
    [xi1 - T.boss - 0.5, x1 + 1],
  ];
  for (const [u0, u1] of sides) {
    holes.push(holeX(w, s, zP, yP, rf, u0, u1));
    if (o.liftOff) holes.push(s.t(boxAt(w, u0, yP - a - 1, zP - rf, u1, yP, zP + rf)));
  }
  const walls: [number, number][] = [
    [x0 - 1, xi0 + 0.01],
    [xi1 - 0.01, x1 + 1],
  ];
  const steps = Math.max(2, Math.ceil(o.angle / 5));
  for (const [u0, u1] of walls) {
    for (let k = 0; k < steps; k++) {
      const [za, ya] = stopInBin(o, (o.angle * k) / steps);
      const [zb, yb] = stopInBin(o, (o.angle * (k + 1)) / steps);
      holes.push(stadiumX(w, s, [zP + za, yP + ya], [zP + zb, yP + yb], p.slot, u0, u1));
    }
    if (o.liftOff) {
      const [zs, ys] = p.stop;
      holes.push(s.t(boxAt(w, u0, yP - a - 1, zP + zs - p.slot, u1, yP + ys, zP + zs + p.slot)));
      // Where the arc slot leaves the slot down, the wall between them comes to a knife edge: off with it, as far as
      // it's thinner than 1 mm (the slots part at the angle the arc starts at, as far from the pivot as the stop pin).
      const half = Math.atan2(ys, -zs) / 2;
      const run = (1 + 2 * p.slot) / 2 / Math.sin(half);
      const [za, ya] = stopInBin(o, Math.min(o.angle, (run / p.rho) * (180 / Math.PI)));
      holes.push(stadiumX(w, s, [zP + zs, yP + ys], [zP + zs, yP + ys - run], p.slot, u0, u1, [zP + za, yP + ya]));
    }
  }
  return s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(holes))));
}

export const tiltBinBuilder: AttachmentBuilder<TiltBinOptions> = {
  body(w, s, o, layout) {
    const T = TILT;
    const p = tiltPlan(o);
    const W = o.width;
    const H = layout.h;
    const add = [
      s.t(boxAt(w, 0, 0, 0, W, H, T.back)),
      s.t(boxAt(w, 0, 0, 0, W, T.floor, p.depth)),
      s.t(boxAt(w, 0, 0, 0, T.side, H, p.depth)),
      s.t(boxAt(w, W - T.side, 0, 0, W, H, p.depth)),
    ];
    // Pin holes through both sides (a push fit), the heads' counterbores on the outside.
    const rx = (PIN.d + PIN.fixed) / 2;
    const holes: Manifold[] = [];
    for (let k = 0; k < o.stack; k++) {
      const y = p.yP(k);
      for (const [z, yy] of [
        [p.zP, y],
        [p.zP + p.stop[0], y + p.stop[1]],
      ]) {
        holes.push(holeX(w, s, z, yy, rx, -1, T.side + 1), holeX(w, s, z, yy, rx, W - T.side - 1, W + 1));
        holes.push(holeX(w, s, z, yy, PIN.bore / 2, -1, PIN.boreT), holeX(w, s, z, yy, PIN.bore / 2, W - PIN.boreT, W + 1));
      }
    }
    return s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(holes))));
  },
  part(w, spec: (TiltBinOptions & { p: 'bin' }) | PinSpec) {
    if (spec.p === 'pin') return pinMesh(w, spec);
    const s = new Scope();
    try {
      return posed(s, tiltBinSolid(w, s, spec), { pose: 'upright' }, 'tip-out bin');
    } finally {
      s.dispose();
    }
  },
};
