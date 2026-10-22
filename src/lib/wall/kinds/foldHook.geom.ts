/**
 * Folding hook geometry (planning in foldHook.ts): the base, and the arm
 * drawn open (as a hook or a cup holder) round the pin, then folded up where
 * it's shown. Side views are (z out from the board, y up), the arm's from the
 * pin.
 */
import { Scope, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import { prismX } from '../mount';
import { posed, type AttachmentBuilder } from '../build';
import { PIN, pinHole, type PinSpec } from './hinge';
import { circleZY, holeX, pinMesh, posedBy, zy } from './hinge.geom';
import { FOLD, foldPlan, type FoldHookOptions } from './foldHook';

/** The detent bump's place from the pin, open (behind and below it); folded, a quarter turn on (in front, below). */
export const foldBump = (): Vec2 => [-FOLD.bump / Math.SQRT2, -FOLD.bump / Math.SQRT2];

/** A bar along x at (z, y) from the pin, radius r0 at x0 to r1 at x1 (a bump, a dimple). */
function stubX(w: Wasm, s: Scope, z: number, y: number, x0: number, x1: number, r0: number, r1: number): Manifold {
  // Along z first, then laid along x: (x, y, z) → (z, y, -x).
  return s.t(s.t(s.t(w.Manifold.cylinder(x1 - x0, r0, r1, 24)).rotate([0, 90, 0])).translate([x0, y, z]));
}

/** The arm, open, round the pin at (zp, yp): knuckle, heel, and a hook or the cup holder; a bump on its +x face. */
function openArm(w: Wasm, s: Scope, o: FoldHookOptions): Manifold {
  const F = FOLD;
  const p = foldPlan(o);
  const { zp, yp, k } = p;
  const at = (pts: Vec2[]): Vec2[] => pts.map(([z, y]) => [zp + z, yp + y]);
  const x0 = p.xc - o.width / 2;
  const x1 = x0 + o.width;
  // The heel stays below the pin, so folding up it swings forward, clear of the back plate.
  const side: Vec2[][] = [
    circleZY(0, 0, k),
    [
      [-p.heel, -k],
      [0, -k],
      [0, 0],
      [-p.heel, -k + 3],
    ],
  ];
  const add: Manifold[] = [];
  const cut: Manifold[] = [];
  if (o.style === 'hook') {
    const R = o.reach;
    side.push(
      [
        [0, -k],
        [R, -k],
        [R, -k + o.arm],
        [0, -k + o.arm],
      ],
      [
        [R - o.arm, -k],
        [R, -k],
        [R, p.top],
        [R - o.arm, p.top],
      ],
    );
  } else {
    // A bar out to a ring with a floor and a drain hole.
    const ri = o.cup / 2 + 0.5;
    side.push([
      [0, -k],
      [p.rc - ri + 1, -k],
      [p.rc - ri + 1, k],
      [0, k],
    ]);
    const ring = (r: number, y0: number, y1: number) =>
      s.t(s.t(s.t(cylinderAt(w, 0, 0, y0, y1, r, r, 96)).rotate([-90, 0, 0])).translate([p.xc, 0, zp + p.rc]));
    add.push(ring(p.ro, yp - k, yp - k + F.ringH));
    cut.push(ring(ri, yp - k + F.floor, yp - k + F.ringH + 1), ring(Math.min(8, ri / 3), yp - k - 1, yp - k + F.floor + 1));
  }
  for (const poly of side) add.push(prismX(w, s, zy(at(poly)), x0, o.width));
  // The detent's bump on the +x face.
  const [bz, by] = foldBump();
  add.push(stubX(w, s, zp + bz, yp + by, x1 - 0.01, x1 + F.bumpH, 1.2, 0.7));
  // Free on the pin: round where it prints on its side, a teardrop (pointing up as it prints, flat) for the cup holder.
  const r = pinHole(o.pin, true) / 2;
  cut.push(o.style === 'hook' ? prismX(w, s, zy(circleZY(zp, yp, r)), x0 - 1, o.width + 2) : holeX(w, s, zp, yp, r, x0 - 1, x1 + 1));
  return s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(cut))));
}

/** The arm folded up, where it's shown: a quarter turn about the pin. */
function foldedArm(w: Wasm, s: Scope, o: FoldHookOptions): Manifold {
  const p = foldPlan(o);
  return s.t(s.t(s.t(openArm(w, s, o).translate([0, -p.yp, -p.zp])).rotate([-90, 0, 0])).translate([0, p.yp, p.zp]));
}

export const foldHookBuilder: AttachmentBuilder<FoldHookOptions> = {
  body(w, s, o, layout) {
    const F = FOLD;
    const p = foldPlan(o);
    const { zp, yp } = p;
    const add = [s.t(boxAt(w, 0, 0, 0, p.w, layout.h, F.back))];
    // The cheeks: round the pin, back to the back plate, down to the bed.
    const xl = p.xc - p.base / 2;
    const xr = p.xc + o.width / 2 + F.gap;
    for (const x of [xl, xr]) {
      add.push(
        prismX(w, s, zy(circleZY(zp, yp, F.boss)), x, F.cheek),
        s.t(boxAt(w, x, 0, 0, x + F.cheek, yp + F.boss, zp)),
        s.t(boxAt(w, x, 0, zp - 0.01, x + F.cheek, yp, zp + F.boss)),
      );
    }
    // The pad the heel stops on, between the cheeks; a foot each side of them on a wide base (a wider first layer).
    if (p.pad > F.back) add.push(s.t(boxAt(w, xl + F.cheek - 0.01, 0, F.back - 0.1, xr + 0.01, yp - 1, p.pad)));
    if (xl > 1) add.push(s.t(boxAt(w, 0, 0, F.back - 0.1, xl + 0.01, 2, F.back + 7)), s.t(boxAt(w, xr + F.cheek - 0.01, 0, F.back - 0.1, p.w, 2, F.back + 7)));
    // The pin: a push fit in both cheeks, a printed pin's head sunk in the left one.
    const r = pinHole(o.pin, false) / 2;
    const cut = [holeX(w, s, zp, yp, r, xl - 1, p.xc + p.base / 2 + 1)];
    if (o.pin === 'printed') cut.push(holeX(w, s, zp, yp, PIN.bore / 2, xl - 1, xl + PIN.boreT));
    // Dimples for the bump in the right cheek, open and folded.
    const [bz, by] = foldBump();
    for (const [z, y] of [
      [bz, by],
      [-by, bz],
    ])
      cut.push(stubX(w, s, zp + z, yp + y, xr - 0.01, xr + F.dimpleD, F.dimple, F.dimple));
    return s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(cut))));
  },
  part(w, spec: (FoldHookOptions & { p: 'arm' }) | PinSpec) {
    if (spec.p === 'pin') return pinMesh(w, spec);
    const s = new Scope();
    try {
      // The hook prints on its side; the cup holder flat, as it lies open.
      if (spec.style === 'hook') return posed(s, foldedArm(w, s, spec), { pose: 'side' }, 'folding hook arm');
      return posedBy(s, openArm(w, s, spec), [90, 0, 0], 'folding cup holder');
    } finally {
      s.dispose();
    }
  },
};
