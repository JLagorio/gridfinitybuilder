/**
 * Storage rail geometry (planning in rail.ts). Everything is drawn in the
 * rail's frame (x along it, y up, z out from the board), the containers and
 * the stop where they sit on the bottom rail, then turned into their print
 * pose, so the fit between them is plain to read here.
 *
 * Profile (z, y) of a rail whose foot is at y0 on the back plate (z = 3):
 * a stem whose underside rises at 45° to the lip's front, 6.2 mm out; the
 * valley floor 9.2 above the foot; the lip 3 thick and 8 high with a 1.5 mm
 * flare at the top whose underside rises at 45°. Every face that looks down
 * rises at 45°, so it prints standing up.
 *
 * A container's back is that profile grown by the fit's clearance (0.2, 0.3,
 * 0.4 mm a side for snug, normal, loose): its back wall stands in the valley,
 * 0.3 clear of the ridges, with a strip cut free by two slots and thinned in
 * front, two teeth at its foot that the ridge clicks between; over the lip it
 * bridges 5 mm, and in front of the lip it reaches up under the flare.
 *
 * An open end (a rail that joins the next of a run) stops flush with the last
 * unit, its lip, flare and the back of its valley chamfered 0.5 mm.
 */
import { Scope, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX, prismY } from '../mount';
import { posed, type AttachmentBuilder } from '../build';
import type { MountCtx } from '../registry';
import { RAIL_BAY, RAIL_SEAT, railPlan, type RailOptions } from './rail';

/**
 * The rail, mm: back plate, how far the detent ridges stand out, valley width,
 * lip thickness, flare, lip height above the valley floor, end panel, room for
 * the stop. Its containers: gap between neighbours, how far the teeth reach
 * past the ridges, walls, side walls. (Plain constants: they stay out of the
 * first screen.)
 */
const Q = 3;
const B = 0.6;
const V = 3.2;
const LIP = 3;
const F = 1.5;
const L = 8;
const E = 2.4;
const PZ = 8;
const G = 0.6;
const I = 0.3;
const T = 1.6;
const TS = 2.4;

/** The rail and its containers, mm (as above; the stem under the valley floor is 3). */
export const RAIL = { plate: Q, bump: B, valley: V, lip: LIP, flare: F, rise: L, stem: 3, end: E, stop: PZ, gap: G, catch: I, wall: T, side: TS };

/** Clearance each side between a container and the rail, by the board's fit, mm. */
export const RAIL_FIT = { snug: 0.2, normal: 0.3, loose: 0.4 } as const;

/** The lip's front face and the flare's tip, out from the board. */
const Z1 = Q + V + LIP;
const ZF = Z1 + F;
/** The valley floor above a rail's foot. */
const SEAT = V + LIP + 3;
/** How far out the teeth's tips are: the ridges reach past them (rail.ts RAIL_BACK). */
const TIP = Q + B - I;
/** Where a container's bays start, out from the board: past the wall in front of the lip, 1.6 at the loosest fit (rail.ts RAIL_BAY: 0.5 behind the drawers). */
const BAY = ZF + 0.4 + T;

/** For tests: the planning's numbers (rail.ts) worked out from the profile. */
export const railCheck = { seat: SEAT + 0.5, back: TIP, bay: BAY + 0.5 };

/** Points in (z, y) or (x, z) to prismX's or prismY's (d = -z). */
const zy = (pts: Vec2[]): Vec2[] => pts.map(([z, y]) => [-z, y]);
const xz = (pts: Vec2[]): Vec2[] => pts.map(([x, z]) => [x, -z]);

/** A rail's profile (z, y), its foot at y0. */
export function railProfile(y0: number): Vec2[] {
  const ys = y0 + SEAT;
  return [
    [Q - 0.5, y0],
    [Q, y0],
    [Z1, y0 + Z1 - Q],
    [Z1, ys + L - F - 0.5],
    [ZF, ys + L - 0.5],
    [ZF, ys + L],
    [Q + V, ys + L],
    [Q + V, ys],
    [Q - 0.5, ys],
  ];
}

/** Where the detent ridges are along a rail (the middle of each unit), x. */
export const railRidges = (o: RailOptions): number[] => Array.from({ length: o.length }, (_, k) => railPlan(o).x0 + (k + 0.5) * +o.unit);

/**
 * What to take off an open end at x = xe (the rail on the side `dir` points
 * to), so a container crossing the joint to the next rail doesn't catch on a
 * small step: the lip's and the flare's edges and the back of the valley,
 * 0.5 mm at 45°. The lip and the flare are two convex pieces, each the hull of
 * its outline drawn in by 0.5 at the end and full 0.5 in.
 */
function openEnd(w: Wasm, s: Scope, xe: number, dir: number, ys: number): Manifold[] {
  const c = 0.5;
  const x1 = xe + dir * c;
  const top = ys + L;
  // The flare's underside, a 45° line through the lip's front at yu, drawn in by c: where it meets the top drawn in by c.
  const yu = top - F - 0.5;
  const ya = yu - c + c * Math.SQRT2;
  const at = (x: number, pts: Vec2[]) => pts.map(([z, y]) => [x, y, z] as [number, number, number]);
  const lip = w.Manifold.hull([
    ...at(xe, [
      [Q + V + c, ys - 0.01],
      [Z1 - c, ys - 0.01],
      [Z1 - c, top - c],
      [Q + V + c, top - c],
    ]),
    ...at(x1, [
      [Q + V, ys - 0.01],
      [Z1, ys - 0.01],
      [Z1, top],
      [Q + V, top],
    ]),
  ]);
  const flare = w.Manifold.hull([
    ...at(xe, [
      [Z1 - c, ya],
      [Z1 - c + top - c - ya, top - c],
      [Z1 - c, top - c],
    ]),
    ...at(x1, [
      [Z1 - c, yu - c],
      [ZF, top - 0.5],
      [ZF, top],
      [Z1 - c, top],
    ]),
  ]);
  const xa = Math.min(xe - dir, x1);
  const keep = s.t(s.t(lip).add(s.t(flare)));
  const box = s.t(boxAt(w, xa, ys, Q + V - 0.01, xa + 1 + c, top + 1, ZF + 1));
  const back = prismY(
    w,
    s,
    xz([
      [xe - dir * 0.01, Q - c - 0.01],
      [xe + dir * (c + 0.01), Q + 0.01],
      [xe - dir * 0.01, Q + 0.01],
    ]),
    ys - 0.01,
    L,
  );
  return [s.t(box.subtract(keep)), back];
}

/** A ridge standing `r` out from a wall face at x (toward `dir`), around z, from y0 to y1. */
function ridge(w: Wasm, s: Scope, x: number, dir: number, z: number, y0: number, y1: number, r = 0.3): Manifold {
  const b = x - dir * 0.2;
  const t = x + dir * r;
  return prismY(
    w,
    s,
    xz([
      [b, z - 1.1],
      [b, z + 1.1],
      [t, z + 0.15],
      [t, z - 0.15],
    ]),
    y0,
    y1 - y0,
  );
}

/** An extra part: the rail's options and which part. */
export type RailPartSpec = (RailOptions & { p: 'bin' | 'sleeve' | 'drawer' }) | { p: 'stop' };
type RailBoxSpec = RailOptions & { p: string };

/** The width of the card slot on a bin's or a drawer's front `fw` wide (rail.ts hardware()). */
const labelWidth = (fw: number, drawer: boolean) => Math.min(fw - 6, drawer ? 50 : 60);

/** A bin or a drawer sleeve, where it sits on the bottom rail with its left side at x = 0. */
function railBox(w: Wasm, s: Scope, o: RailBoxSpec, ctx: MountCtx): Manifold {
  const p = railPlan(o);
  const c = RAIL_FIT[ctx.fit];
  const Wc = p.cw * p.u - G;
  const yb = RAIL_SEAT;
  const top = yb + p.H;
  const ys = SEAT;
  const z0 = Q + B + c;
  const zC = Q + V - c;
  const ceil = ys + L + c;
  const bay = BAY;
  const sleeve = o.p === 'sleeve';
  const zF = o.depth - (sleeve ? 6 : o.label ? 2 : 0);
  const zt = (bay + zF) / 2;
  const add: Manifold[] = [s.t(boxAt(w, 0, yb, z0, Wc, top, zF))];
  const cut: Manifold[] = [];
  const post: Manifold[] = [];
  // The channel the lip runs in: the rail's lip and flare grown by the clearance.
  const k = c * (Math.SQRT2 - 1);
  const chan: Vec2[] = [
    [zC, yb - 1],
    [zC, ceil],
    [ZF + c, ceil],
    [ZF + c, ys + L - 0.5 - k],
    [Z1 + c, ys + L - F - 0.5 - k],
    [Z1 + c, yb - 1],
  ];
  cut.push(prismX(w, s, zy(chan), -1, Wc + 2));
  // The detent: a strip of the back wall in the first unit, cut free and thinned in front, two teeth at its foot.
  const xs = p.u / 2 - G / 2;
  const slotTop = ceil - 1.2;
  for (const d of [-1, 1]) cut.push(s.t(boxAt(w, xs + d * 2.8 - 0.3, yb - 1, z0 - 1, xs + d * 2.8 + 0.3, slotTop, zC + 0.1)));
  cut.push(
    prismX(
      w,
      s,
      zy([
        [zC - 0.8, yb - 1],
        [zC + 0.1, yb - 1],
        [zC + 0.1, slotTop],
        [zC - 0.8, slotTop - 0.9],
      ]),
      xs - 2.6,
      5.2,
    ),
  );
  const hw = 0.1 + z0 + 0.2 - TIP;
  for (const d of [-1, 1]) {
    const x = xs + d;
    post.push(
      prismY(
        w,
        s,
        xz([
          [x - hw, z0 + 0.2],
          [x + hw, z0 + 0.2],
          [x + 0.1, TIP],
          [x - 0.1, TIP],
        ]),
        yb,
        3,
      ),
    );
  }
  if (o.links) {
    // A dovetail on the right, its neck across the gap, fits the groove on the left of the next one (0.2 clear).
    add.push(
      prismY(
        w,
        s,
        xz([
          [Wc - 0.3, zt - 1.2],
          [Wc + G, zt - 1.2],
          [Wc + G + 1.2, zt - 2.4],
          [Wc + G + 1.2, zt + 2.4],
          [Wc + G, zt + 1.2],
          [Wc - 0.3, zt + 1.2],
        ]),
        yb,
        14,
      ),
    );
    const o2 = 0.2 * Math.SQRT2;
    cut.push(
      prismY(
        w,
        s,
        xz([
          [-1, zt - 1.4],
          [0.2 - o2, zt - 1.4],
          [1.4, zt - 2.6 - o2],
          [1.4, zt + 2.6 + o2],
          [0.2 - o2, zt + 1.4],
          [-1, zt + 1.4],
        ]),
        yb - 1,
        p.H + 2,
      ),
    );
  }
  if (sleeve) {
    // A bay per unit, open at the front; behind them over the lip, a pocket open at the top.
    const { bw, bh } = p;
    for (let i = 0; i < p.ch; i++)
      for (let j = 0; j < p.cw; j++) {
        const x0 = TS + j * (bw + T);
        const y0 = yb + T + i * (bh + T);
        cut.push(s.t(boxAt(w, x0, y0, bay, x0 + bw, y0 + bh, zF + 1)));
        // Stops near the front: a drawer's ridges catch on them.
        post.push(ridge(w, s, x0, 1, zF - 4, y0 + 1.5, y0 + bh - 1.5), ridge(w, s, x0 + bw, -1, zF - 4, y0 + 1.5, y0 + bh - 1.5));
      }
    cut.push(s.t(boxAt(w, TS, ceil + T, zC, Wc - TS, top + 1, bay - T)));
  } else {
    // Open: the floor steps up over the lip; the sides slope down to a low front, with a scoop inside it.
    cut.push(s.t(boxAt(w, TS, yb + T, bay, Wc - TS, top + 1, zF - T)), s.t(boxAt(w, TS, ceil + T, zC, Wc - TS, top + 1, bay + 0.01)));
    const fh = Math.max(Math.min(p.H, 16), p.H / 2);
    if (fh < p.H - 0.01) {
      const zs = bay + 0.3 * (zF - bay);
      cut.push(
        prismX(
          w,
          s,
          zy([
            [zs, top + 1],
            [zs, top],
            [zF, yb + fh],
            [zF + 3, yb + fh],
            [zF + 3, top + 1],
          ]),
          -1,
          Wc + 4,
        ),
      );
    }
    const R = Math.min(10, (fh - T) * 0.6, (zF - T - bay) / 3);
    const cz = zF - T - R;
    const cy = yb + T + R;
    const arc: Vec2[] = [[zF - T + 0.1, yb + T - 0.1]];
    for (let a = 0; a <= 8; a++) arc.push([cz + R * Math.cos((-a * Math.PI) / 16), cy - R * Math.sin((a * Math.PI) / 16)]);
    post.push(prismX(w, s, zy(arc), TS - 0.1, Wc - 2 * TS + 0.2));
    if (o.label) {
      // A card slot: a frame on the front, its window and the slot behind it open at the top.
      const lw = labelWidth(Wc, false);
      const xl = (Wc - lw) / 2;
      add.push(s.t(boxAt(w, xl, yb, zF - 0.1, xl + lw, yb + 14, zF + 2)));
      cut.push(
        s.t(boxAt(w, xl + 1, yb + 1.5, zF, xl + lw - 1, yb + 15, zF + 0.7)),
        s.t(boxAt(w, xl + 2.5, yb + 3, zF + 0.5, xl + lw - 2.5, yb + 15, zF + 2.1)),
      );
    }
  }
  const body = s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(cut))));
  return s.t(w.Manifold.union([body, ...post]));
}

/** A drawer for a sleeve's bay, its back-left-bottom at the origin: 0.4 clear of the bay at the sides and the top, 0.5 at the back; the pull reaches 6 out in front. */
function railDrawer(w: Wasm, s: Scope, o: RailOptions): Manifold {
  const p = railPlan(o);
  const W = p.bw - 0.8;
  const H = p.bh - 0.4;
  const D = o.depth - RAIL_BAY - 6;
  const add: Manifold[] = [s.t(boxAt(w, 0, 0, 0, W, H, D))];
  const cut: Manifold[] = [s.t(boxAt(w, 1.2, 1.2, 1.2, W - 1.2, H + 1, D - 2))];
  // A tab pull at the top of the front, its underside at 45°.
  const pw = Math.min(40, Math.max(12, W / 2));
  add.push(
    prismX(
      w,
      s,
      zy([
        [D - 0.1, H - 8],
        [D + 6, H - 2],
        [D + 6, H],
        [D - 0.1, H],
      ]),
      (W - pw) / 2,
      pw,
    ),
  );
  // A card slot under the pull, if there's room.
  if (o.label && H >= 22.5) {
    const lw = labelWidth(W, true);
    const xl = (W - lw) / 2;
    add.push(s.t(boxAt(w, xl, 0, D - 0.1, xl + lw, 14, D + 2)));
    cut.push(s.t(boxAt(w, xl + 1, 1.5, D, xl + lw - 1, 15, D + 0.7)), s.t(boxAt(w, xl + 2.5, 3, D + 0.5, xl + lw - 2.5, 15, D + 2.1)));
  }
  const body = s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(cut))));
  // Ridges near the back: pulled out, they catch on the sleeve's stops.
  return s.t(w.Manifold.union([body, ridge(w, s, 0, -1, 4, 0, H - 2), ridge(w, s, W, 1, 4, 0, H - 2)]));
}

/** The stop that drops into the pocket at the right end of the bottom rail. */
function railStop(w: Wasm, s: Scope, x0: number): Manifold {
  const ys = SEAT;
  return prismX(
    w,
    s,
    zy([
      [Q + 0.1, ys - 3.9],
      [Q + V - 0.1, ys - 3.9],
      [Q + V - 0.1, ys + L + 0.1],
      [ZF, ys + L + 0.1],
      [ZF, ys + L + 4],
      [Q + 0.1, ys + L + 4],
    ]),
    x0,
    6,
  );
}

export const railBuilder: AttachmentBuilder<RailOptions> = {
  body(w, s, o, layout) {
    const p = railPlan(o);
    const W = layout.w;
    const add = [s.t(boxAt(w, 0, 0, 0, W, layout.h, Q))];
    if (p.panel) add.push(s.t(boxAt(w, 0, 0, 0, E, layout.h, o.depth)));
    const cut: Manifold[] = [];
    for (let r = 0; r < o.rows; r++) {
      const y0 = r * p.S;
      const ys = y0 + SEAT;
      add.push(prismX(w, s, zy(railProfile(y0)), p.x0 && p.x0 - 0.5, W - (p.x0 && p.x0 - 0.5)));
      for (const x of railRidges(o))
        add.push(
          prismY(
            w,
            s,
            xz([
              [x - 1, Q - 0.3],
              [x + 1, Q - 0.3],
              [x + 0.1, Q + B],
              [x - 0.1, Q + B],
            ]),
            ys - 0.1,
            L - 1,
          ),
        );
      // The stop's pocket; open ends.
      const x0 = W - PZ + 0.2;
      if (p.stop) cut.push(s.t(boxAt(w, x0, ys - 4, Q, x0 + 6.2, ys + 0.1, Q + V)));
      else cut.push(...openEnd(w, s, W, -1, ys));
      if (!p.panel) cut.push(...openEnd(w, s, 0, 1, ys));
    }
    return s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(cut))));
  },
  part(w, spec: RailPartSpec, ctx) {
    const s = new Scope();
    try {
      if (spec.p === 'stop') return posed(s, railStop(w, s, 0), { pose: 'side' }, 'rail stop');
      if (spec.p === 'drawer') return posed(s, railDrawer(w, s, spec), { pose: 'upright' }, 'rail drawer');
      return posed(s, railBox(w, s, spec, ctx), { pose: 'upright' }, `rail ${spec.p}`);
    } finally {
      s.dispose();
    }
  },
};
