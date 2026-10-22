/**
 * Lift-off caddy geometry (planning in caddy.ts), all in the dock's frame
 * (x across, y up, z out from the board), the caddy where it hangs.
 *
 * Side view of a cleat: its underside rises at 45° from the back plate, its
 * front stands `CADDY.cleat` out, its top slopes down at 45° to the back
 * plate, leaving a V between them. A hook on the caddy: a finger filling the
 * V, 0.5 clear of the back plate and of the cleat's top (measured up), and a
 * bar over the cleat into the caddy's back wall, 0.5 in front of the cleat;
 * either side of the finger a rib, 0.5 clear of the cleat's sides, its
 * underside running down at 45° to the back wall.
 */
import { Scope, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX } from '../mount';
import { posed, type AttachmentBuilder } from '../build';
import { CADDY, caddyPlan, type CaddyOptions } from './caddy';

/**
 * The cleats and hooks, mm: a cleat's width, the hook's bar over it, the
 * clearances (behind the finger, over the cleat's top, each side), a rib's
 * thickness; the caddy's walls and floor, its dividers, the handle's wall and
 * grip; the bumper's height and how close it comes to the caddy.
 */
export const HOOK = { tooth: 8, bar: 5, back: 0.5, over: 0.5, side: 0.5, rib: 3 } as const;
const BOX = { wall: 2, floor: 2, divider: 2, handle: 4, grip: 12 } as const;
const BUMP = { h: 12, gap: 0.5 } as const;

/** Points in (z, y) to prismX's (d, y). */
const zy = (pts: Vec2[]): Vec2[] => pts.map(([z, y]) => [-z, y]);

/** A cleat's top front corner (its height, and how far out). */
export function cleatTop(o: CaddyOptions): { y: number; z: number } {
  return { y: caddyPlan(o).rim - HOOK.bar - HOOK.over, z: CADDY.back + CADDY.cleat };
}

function dock(w: Wasm, s: Scope, o: CaddyOptions, W: number, H: number): Manifold {
  const p = caddyPlan(o);
  const B = CADDY.back;
  const c = CADDY.cleat;
  const { y } = cleatTop(o);
  const add = [s.t(boxAt(w, 0, 0, 0, W, H, B))];
  const cleat = zy([
    [B - 0.5, y - 2 * c - 4.5],
    [B + c, y - c - 4],
    [B + c, y],
    [B, y - c],
    [B - 0.5, y - c],
  ]);
  for (const x of p.hooks) add.push(prismX(w, s, cleat, x - HOOK.tooth / 2, HOOK.tooth));
  // The bumper the caddy's back rests on, along the foot (on the bed: a foot for the tall plate too).
  add.push(s.t(boxAt(w, 0, 0, B - 0.5, W, p.y0 + BUMP.h, p.zc - BUMP.gap)));
  return s.t(w.Manifold.union(add));
}

/** The caddy where it hangs on the dock. */
function caddy(w: Wasm, s: Scope, o: CaddyOptions): Manifold {
  const p = caddyPlan(o);
  const W = o.width;
  const B = CADDY.back;
  const c = CADDY.cleat;
  const z0 = p.zc;
  const z1 = p.zc + o.depth;
  const t = BOX.wall;
  const box = s.t(s.t(boxAt(w, 0, p.y0, z0, W, p.rim, z1)).subtract(s.t(boxAt(w, t, p.y0 + BOX.floor, z0 + t, W - t, p.rim + 1, z1 - t))));
  const add: Manifold[] = [box];
  // Dividers across.
  for (let j = 1; j <= o.dividers; j++) {
    const x = (W * j) / (o.dividers + 1);
    add.push(s.t(boxAt(w, x - BOX.divider / 2, p.y0 + 1, z0 + 1, x + BOX.divider / 2, p.rim, z1 - 1)));
  }
  if (o.handle > 0) {
    // The handle: a wall down the middle, a grip along its top with 45° undersides.
    const zm = (z0 + z1) / 2;
    const g = BOX.grip / 2;
    const hw = BOX.handle / 2;
    const top = p.top;
    const wall = zy([
      [zm - hw, p.y0 + 1],
      [zm + hw, p.y0 + 1],
      [zm + hw, top - 2 * g],
      [zm + g, top - 2 * g + (g - hw)],
      [zm + g, top - g / 2],
      [zm + g / 2, top],
      [zm - g / 2, top],
      [zm - g, top - g / 2],
      [zm - g, top - 2 * g + (g - hw)],
      [zm - hw, top - 2 * g],
    ]);
    add.push(prismX(w, s, wall, 1, W - 2));
  }
  // The hooks: a finger over each cleat between two ribs.
  const { y } = cleatTop(o);
  const zf = B + HOOK.back;
  const tip = y - c + HOOK.over + HOOK.back;
  const zw = z0 + 0.5;
  const finger = zy([
    [zf, tip],
    [B + c, y + HOOK.over],
    [zw, y + HOOK.over],
    [zw, p.rim],
    [zf, p.rim],
  ]);
  const rib = zy([
    [zf, tip],
    [zw, tip - (zw - zf)],
    [zw, p.rim],
    [zf, p.rim],
  ]);
  const half = HOOK.tooth / 2 + HOOK.side;
  for (const x of p.hooks) {
    add.push(prismX(w, s, finger, x - half - 0.01, 2 * half + 0.02));
    add.push(prismX(w, s, rib, x - half - HOOK.rib, HOOK.rib), prismX(w, s, rib, x + half, HOOK.rib));
  }
  return s.t(w.Manifold.union(add));
}

export const caddyBuilder: AttachmentBuilder<CaddyOptions> = {
  body(w, s, o, layout) {
    return dock(w, s, o, layout.w, layout.h);
  },
  part(w, spec: CaddyOptions) {
    const s = new Scope();
    try {
      return posed(s, caddy(w, s, spec), { pose: 'upright' }, 'caddy');
    } finally {
      s.dispose();
    }
  },
};

/** For tests: the caddy where it hangs, in the dock's frame. */
export const caddyInPlace = (w: Wasm, s: Scope, o: CaddyOptions) => caddy(w, s, o);
