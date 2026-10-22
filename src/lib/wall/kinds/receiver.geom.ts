/**
 * Receiver plate geometry (planning in receiver.ts): a plate with heads on
 * its face, each head built where it sits, its base 0.5 mm into the plate.
 *
 * A round head (Multiconnect, Multipoint), out from the plate: a neck, a 45°
 * flare out to the rim, the rim; a cone dimple in its face. openConnect: the
 * small outline straight for 0.6, a 45° flare (hull) to the large outline
 * over 1.4, the large outline straight for 0.6; its bottom edge doesn't
 * flare (the slot is open under it) and a notch in each side takes the
 * slot's nub. Every head loses what is under a 45° plane rising out from the
 * bottom of its root, so the plate prints upright without support.
 */
import type { Manifold, Scope, Vec2, Wasm } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import { prismX, prismZ } from '../mount';
import type { AttachmentBuilder } from '../build';
import type { MountCtx } from '../registry';
import { RECEIVER_HEADS, RECEIVER_PLATE, receiverPlan, type ReceiverOptions } from './receiver';

/** How much smaller than the published head each is, a side, by the board's fit, mm. */
export const RECEIVER_FIT = { snug: 0, normal: 0.05, loose: 0.15 } as const;

/** Round heads: rim radius, the rim's, the flare's and the neck's lengths out from the plate, the dimple's radius (and depth); mm. */
export const ROUND_HEADS = {
  multiconnect: { r: 10, rim: 1, flare: 2.5, neck: 0.5, dimple: 1 },
  multipoint: { r: 7.9, rim: 0.4, flare: 2.2, neck: 0.4, dimple: 0.8 },
} as const;

/**
 * openConnect's head: the large outline's half width, top (above the head's
 * centre; the bottom is `bottom` below it) and corner cuts, the flare, the
 * straight lengths at the plate and at the face, and the notches' height
 * (below the top), depth and width at their floor; mm.
 */
export const OPENCONNECT = {
  half: 8.5,
  top: 8.9,
  bottom: 1.7,
  chamfer: 4,
  flare: 1.4,
  root: 0.6,
  face: 0.6,
  notch: 7.2,
  notchDepth: 0.6,
  notchTip: 1.2,
} as const;

/** openConnect's outline, `inset` in from the large one (the small one is 1.4 in), around (x, y). */
function ocOutline(x: number, y: number, inset: number): Vec2[] {
  const { half, top, bottom, chamfer } = OPENCONNECT;
  const h = half - inset;
  const t = top - inset;
  // The corner cuts are 45° lines x + y = k, moved in with the sides.
  const k = half + top - chamfer - inset * Math.SQRT2;
  return [
    [x - h, y - bottom],
    [x + h, y - bottom],
    [x + h, y + k - h],
    [x + k - t, y + t],
    [x - (k - t), y + t],
    [x - h, y + k - h],
  ];
}

/** Everything of a head under a 45° plane rising out from (z0, y0), around x. */
function under45(w: Wasm, s: Scope, x: number, half: number, z0: number, y0: number, out: number): Manifold {
  const pts: Vec2[] = [
    [z0, y0],
    [z0 + out + 1, y0 + out + 1],
    [z0 + out + 1, y0 - 40],
    [z0, y0 - 40],
  ];
  return prismX(
    w,
    s,
    pts.map(([z, y]) => [-z, y]),
    x - half - 1,
    2 * half + 2,
  );
}

/** A round head at (x, y) on a face at z = T. */
function roundHead(w: Wasm, s: Scope, o: ReceiverOptions, x: number, y: number, T: number, c: number): Manifold {
  const { r, rim, flare, neck, dimple } = ROUND_HEADS[o.system as 'multiconnect' | 'multipoint'];
  const R = r - c;
  const rn = R - flare;
  const out = neck + flare + rim;
  const head = s.t(
    w.Manifold.union([
      s.t(cylinderAt(w, x, y, T - 0.5, T + neck, rn, rn, 64)),
      s.t(cylinderAt(w, x, y, T + neck, T + neck + flare, rn, R, 64)),
      s.t(cylinderAt(w, x, y, T + neck + flare, T + out, R, R, 64)),
    ]),
  );
  const cut = s.t(w.Manifold.union([s.t(cylinderAt(w, x, y, T + out - dimple, T + out + 0.01, 0, dimple + 0.01, 32)), under45(w, s, x, R, T, y - rn, out)]));
  return s.t(head.subtract(cut));
}

/** An openConnect head with its centre at (x, y) on a face at z = T. */
function openHead(w: Wasm, s: Scope, x: number, y: number, T: number, c: number): Manifold {
  const { flare, root, face, half, top, bottom, notch, notchDepth, notchTip } = OPENCONNECT;
  const small = ocOutline(x, y, flare + c);
  const large = ocOutline(x, y, c);
  const at = (pts: Vec2[], z: number) => pts.map(([px, py]) => [px, py, z] as [number, number, number]);
  const z1 = T + root;
  const z2 = z1 + flare;
  const out = root + flare + face;
  const head = s.t(
    w.Manifold.union([prismZ(w, s, small, T - 0.5, z1), s.t(w.Manifold.hull([...at(small, z1), ...at(large, z2)])), prismZ(w, s, large, z2, T + out)]),
  );
  // Notches: 45° sides, `notchTip` wide at their floor, `notchDepth` into the large outline's sides.
  const yn = y + top - notch;
  const x0 = half - c - notchDepth;
  const x1 = half + 1;
  const a = notchTip / 2;
  const b = a + (x1 - x0);
  const cuts = [under45(w, s, x, half, T, y - bottom, out)];
  for (const d of [-1, 1])
    cuts.push(
      prismZ(
        w,
        s,
        [
          [x + d * x0, yn - a],
          [x + d * x1, yn - b],
          [x + d * x1, yn + b],
          [x + d * x0, yn + a],
        ],
        z1,
        T + out + 1,
      ),
    );
  return s.t(head.subtract(s.t(w.Manifold.union(cuts))));
}

export const receiverBuilder: AttachmentBuilder<ReceiverOptions> = {
  body(w, s, o, layout, ctx: MountCtx) {
    const T = RECEIVER_PLATE;
    const c = RECEIVER_FIT[ctx.fit];
    const { heads } = receiverPlan(o, ctx);
    const parts = [s.t(boxAt(w, 0, 0, 0, layout.w, layout.h, T))];
    for (const [x, y] of heads) parts.push(o.system === 'openconnect' ? openHead(w, s, x, y, T, c) : roundHead(w, s, o, x, y, T, c));
    return s.t(w.Manifold.union(parts));
  },
};

/** For tests: how far each system's head stands out, from the profile (receiver.ts plans with RECEIVER_HEADS). */
export const receiverCheck = {
  multiconnect: ROUND_HEADS.multiconnect.neck + ROUND_HEADS.multiconnect.flare + ROUND_HEADS.multiconnect.rim,
  multipoint: ROUND_HEADS.multipoint.neck + ROUND_HEADS.multipoint.flare + ROUND_HEADS.multipoint.rim,
  openconnect: OPENCONNECT.root + OPENCONNECT.flare + OPENCONNECT.face,
  heads: RECEIVER_HEADS,
};
