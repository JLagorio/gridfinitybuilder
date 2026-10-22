/**
 * Planter geometry (planning in planter.ts). Built where it hangs (wall x
 * across, y up, z out), the saucers where they sit, then turned upright to
 * print.
 *
 * Round: a sleeve round the pot, 2.4 thick, 3.6 at its foot (the saucer's
 * height and 2 more), joined to the back plate by a web. In the foot's
 * inside, for each lug, an L slot 1.6 deep: up from the bottom edge where the
 * lug enters, then along a third of a turn to where it sits, its floor 0.2
 * under the lug. The saucer is 0.4 clear of the sleeve all round, its lugs
 * 0.4 short of the slots' backs and 2° clear of their ends. Square: the
 * sleeve has a floor; the tray is 0.4 clear of the sides and back.
 */
import { Scope, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import { prismX, prismY, prismZ } from '../mount';
import { posed, type AttachmentBuilder } from '../build';
import { LUG, POT, lugOutline, potPlan, type PlanterOptions } from './planter';

/** A window each side of a round sleeve's foot (a share of the radius each side of centre, at most 12 mm), how deep a slot reaches past the inside, the tubes' clearances; mm. */
export const PLANTER = { window: 0.3, windowMax: 12, slot: 1.6, cup: 0.8, hole: 1.2, ledge: POT.ledge } as const;

/** A cylinder standing on y0, `h` tall, its axis at (x, z). */
function upright(w: Wasm, s: Scope, x: number, z: number, y0: number, h: number, r: number, segs = 96): Manifold {
  const c = s.t(cylinderAt(w, 0, 0, 0, h, r, r, segs));
  return s.t(s.t(c.rotate([-90, 0, 0])).translate([x, y0, z]));
}

/** An outline round the axis (x, z offsets) at (cx, cz), standing from y0 up `h`. */
const around = (w: Wasm, s: Scope, pts: Vec2[], cx: number, cz: number, y0: number, h: number) =>
  prismY(
    w,
    s,
    pts.map(([x, z]) => [cx + x, -(cz + z)] as Vec2),
    y0,
    h,
  );

/** A tube's centre on the rack: across, and out from the board. */
export const tubeAt = (o: PlanterOptions, i: number): Vec2 => {
  const p = potPlan(o);
  return [2 + (i + 0.5) * p.pitch, POT.back + 4 + o.tube / 2];
};

function tubeRack(w: Wasm, s: Scope, o: PlanterOptions, W: number, H: number): Manifold {
  const p = potPlan(o);
  const B = POT.back;
  const D = p.d;
  const add = [s.t(boxAt(w, 0, 0, 0, W, H, B)), s.t(boxAt(w, 0, 0, 0, W, p.foot, D))];
  // The ledge, its underside 45° back to the back plate.
  const top = p.h;
  const L = PLANTER.ledge;
  const yb = Math.max(0, top - L - (D - B));
  add.push(
    prismX(
      w,
      s,
      [
        [-(B - 0.5), yb],
        [-D, top - L],
        [-D, top],
        [-(B - 0.5), top],
      ],
      0,
      W,
    ),
  );
  const cuts: Manifold[] = [];
  // Square holes through the ledge: their fronts parallel to its underside, so no thin crescent where they meet.
  const r = (o.tube + PLANTER.hole) / 2;
  for (let i = 0; i < o.count; i++) {
    const [x, z] = tubeAt(o, i);
    cuts.push(upright(w, s, x, z, 3, p.foot - 3 + 0.01, (o.tube + PLANTER.cup) / 2, 64), s.t(boxAt(w, x - r, p.foot, z - r, x + r, top + 1, z + r)));
  }
  return s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(cuts))));
}

function roundSleeve(w: Wasm, s: Scope, o: PlanterOptions, W: number, H: number): Manifold {
  const p = potPlan(o);
  const { cx, cz, r } = p;
  const foot = POT.saucer + 2;
  const add = [
    s.t(boxAt(w, 0, 0, 0, W, H, POT.back)),
    s.t(boxAt(w, cx - 0.6 * r, 0, 0, cx + 0.6 * r, H, cz)),
    upright(w, s, cx, cz, 0, foot, r + POT.band),
    upright(w, s, cx, cz, foot - 0.01, H - foot + 0.01, r + POT.wall),
  ];
  const cuts = [upright(w, s, cx, cz, -1, H + 2, r)];
  // The L slots: in from the bottom edge at the entry, then round to where the lug sits.
  const R = r + PLANTER.slot;
  const ly = LUG.y;
  for (const a of LUG.at) {
    const e = a - LUG.turn;
    cuts.push(around(w, s, lugOutline(e, r - 0.5, R, LUG.arc / 2 + 2), cx, cz, -1, ly + LUG.h + 1.4));
    cuts.push(around(w, s, lugOutline((e + a) / 2, r - 0.5, R, LUG.turn / 2 + LUG.arc / 2 + 2), cx, cz, ly - 0.2, LUG.h + 0.6));
  }
  // A window each side to grip the saucer, its top a 45° point.
  const hw = Math.min(PLANTER.windowMax, PLANTER.window * r);
  const yw = POT.saucer - 2;
  cuts.push(
    prismX(
      w,
      s,
      [
        [-(cz - hw), -1],
        [-(cz + hw), -1],
        [-(cz + hw), yw],
        [-cz, yw + hw],
        [-(cz - hw), yw],
      ],
      -1,
      W + 2,
    ),
  );
  return s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(cuts))));
}

function squareSleeve(w: Wasm, s: Scope, o: PlanterOptions, W: number, H: number, D: number): Manifold {
  const p = potPlan(o);
  const t = POT.wall;
  const F = POT.floor;
  const body = s.t(boxAt(w, 0, 0, 0, W, H, D));
  const yo = F + POT.saucer + 1;
  const cuts = [
    s.t(boxAt(w, t, F, p.z0, W - t, H + 1, p.z0 + p.si)),
    // The tray's way in, its top rising to a point at 45°.
    prismZ(
      w,
      s,
      [
        [t, F],
        [W - t, F],
        [W - t, yo],
        [W / 2, yo + (W - 2 * t) / 2],
        [t, yo],
      ],
      p.z0 + p.si - 0.5,
      D + 1,
    ),
  ];
  return s.t(body.subtract(s.t(w.Manifold.union(cuts))));
}

/** The saucer where it sits (round: seated, its lugs at their stops). */
function saucer(w: Wasm, s: Scope, o: PlanterOptions): Manifold {
  const p = potPlan(o);
  const h = POT.saucer;
  if (o.shape === 'square') {
    const t = POT.wall;
    const x0 = t + 0.4;
    const x1 = p.si + t - 0.4;
    const z0 = p.z0 + 0.4;
    const z1 = p.z0 + p.si + t;
    const y0 = POT.floor;
    const tray = s.t(boxAt(w, x0, y0, z0, x1, y0 + h, z1));
    // Hollow, and a finger dip in the front wall's top.
    const cx = (x0 + x1) / 2;
    const dip = s.t(s.t(s.t(cylinderAt(w, cx, y0 + h, z1 - 3, z1 + 1, 8, 8, 48)).add(s.t(boxAt(w, cx - 8, y0 + h, z1 - 3, cx + 8, y0 + h + 9, z1 + 1)))));
    return s.t(tray.subtract(s.t(s.t(boxAt(w, x0 + 1.6, y0 + 1.6, z0 + 1.6, x1 - 1.6, y0 + h + 1, z1 - 1.6)).add(dip))));
  }
  const { cx, cz, rd } = p;
  const dish = s.t(upright(w, s, cx, cz, 0, h, rd).subtract(upright(w, s, cx, cz, 2, h, rd - 2)));
  const lugs = LUG.at.map((a) => around(w, s, lugOutline(a, rd - 0.5, p.r + LUG.out), cx, cz, LUG.y, LUG.h));
  return s.t(w.Manifold.union([dish, ...lugs]));
}

export const planterBuilder: AttachmentBuilder<PlanterOptions> = {
  body(w, s, o, layout) {
    if (o.mode === 'tubes') return tubeRack(w, s, o, layout.w, layout.h);
    return o.shape === 'round' ? roundSleeve(w, s, o, layout.w, layout.h) : squareSleeve(w, s, o, layout.w, layout.h, layout.depth);
  },
  part(w, spec: PlanterOptions) {
    const s = new Scope();
    try {
      return posed(s, saucer(w, s, spec), { pose: 'upright' }, 'planter saucer');
    } finally {
      s.dispose();
    }
  },
};

/** For tests: the saucer where it sits, in the planter's frame. */
export const planterSaucer = (w: Wasm, s: Scope, o: PlanterOptions) => saucer(w, s, o);
