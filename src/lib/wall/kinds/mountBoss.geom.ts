/**
 * Device mount geometry (planning in mountBoss.ts). The platform and its
 * fixing are drawn in their own frame (x across, y up from the platform's
 * bottom, z out, its bottom's middle at the origin), tilted forward about x
 * and moved to the end of the arm. Under a tilted platform a skirt (the
 * hull of its bottom and that pushed down to the bed) holds it up. The arm,
 * in the side view: along the bed from the back plate to under the
 * platform's back edge, up to it, and back at 45° to the back plate.
 */
import type { Manifold, Scope, Vec2, Wasm } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX, prismY, prismZ } from '../mount';
import type { AttachmentBuilder } from '../build';
import { BOSS_BACK, GOPRO_TIP, bossPlan, type MountBossOptions } from './mountBoss';

/** The bolt fixings' hexagon (across flats, with room), the hole for the thread and the hexagon's depth, mm. */
export const BOSS_BOLTS = {
  '1/4-20': { af: 11.5, hole: 6.6, pocket: 5.8 },
  '3/8-16': { af: 14.65, hole: 9.9, pocket: 8.6 },
  '5/8-27': { af: 14.65, hole: 9.9, pocket: 8.6 },
} as const;

/** GoPro fingers: thickness, the gaps between them, the tips' radius, the bolt's axis above the platform and its hole, mm. */
export const GOPRO = { finger: 3, gap: 3.2, ...GOPRO_TIP, bolt: 5.3 } as const;

/**
 * The Arca seat: the channel's width at its floor, how deep its 45° sides are (shallow, as plates' bevels
 * vary: a deeper bevel still fits) and the lock screw's height above the floor; the cold shoe: the slot's
 * width and height under the rails, the opening, the rails' edge; mm.
 */
export const ARCA = { floor: 38.6, side: 3, screw: 1.5 } as const;
export const SHOE = { width: 18.8, slot: 2.2, opening: 13, edge: 1.2 } as const;

const circle = (cx: number, cy: number, r: number, n = 32): Vec2[] =>
  Array.from({ length: n }, (_, k) => [cx + r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n)]);

/** What the fixing takes out of the platform and adds to it, in the platform's frame. */
function fixing(w: Wasm, s: Scope, o: MountBossOptions, bw: number, bd: number, bh: number): { cut: Manifold[]; add: Manifold[] } {
  const cut: Manifold[] = [];
  const add: Manifold[] = [];
  const f = o.fixing;
  if (f === '1/4-20' || f === '3/8-16' || f === '5/8-27') {
    // The hexagon from below (through the skirt and out under the bed), the bolt's thread up through the top.
    const { af, hole, pocket } = BOSS_BOLTS[f];
    const hex = Array.from(
      { length: 6 },
      (_, k) => [(af / Math.sqrt(3)) * Math.cos((k * Math.PI) / 3), (af / Math.sqrt(3)) * Math.sin((k * Math.PI) / 3)] as Vec2,
    );
    cut.push(prismY(w, s, hex, -80, 80 + pocket), prismY(w, s, circle(0, 0, hole / 2), pocket - 1, bh - pocket + 2));
  } else if (f === 'gopro') {
    const { finger, gap, r, axis, bolt } = GOPRO;
    const n = o.fingers;
    const span = n * finger + (n - 1) * gap;
    const tip: Vec2[] = [
      [r, bh - 0.5],
      [-r, bh - 0.5],
    ];
    for (let k = 0; k <= 16; k++) tip.push([-r * Math.cos((k * Math.PI) / 16), bh + axis + r * Math.sin((k * Math.PI) / 16)]);
    const fingers = Array.from({ length: n }, (_, k) => prismX(w, s, tip, -span / 2 + k * (finger + gap), finger));
    add.push(s.t(s.t(w.Manifold.union(fingers)).subtract(prismX(w, s, circle(0, bh + axis, bolt / 2), -span / 2 - 1, span + 2))));
  } else if (f === 'arca') {
    // A channel with 45° sides open at the front, a stop at the back; an M5 screw through the right side, its nut in a slot from the top.
    const a = ARCA.floor / 2;
    const y0 = bh - ARCA.side;
    const t = a - ARCA.side;
    cut.push(
      prismZ(
        w,
        s,
        [
          [-a, y0],
          [a, y0],
          [t, bh],
          [t, bh + 1],
          [-t, bh + 1],
          [-t, bh],
        ],
        -bd / 2 + 5,
        bd / 2 + 1,
      ),
      prismX(w, s, circle(0, y0 + ARCA.screw, 2.7), t, bw / 2 - t + 1),
      s.t(boxAt(w, a + 1.2, y0 + ARCA.screw - 4.75, -4.15, a + 5.4, bh + 1, 4.15)),
    );
  } else {
    // The cold shoe: the foot's slot, rails over it whose undersides lean 45°, open at the front.
    const { width, slot, opening, edge } = SHOE;
    const a = width / 2;
    const t = opening / 2;
    const y0 = bh - edge - (a - t) - slot;
    cut.push(
      prismZ(
        w,
        s,
        [
          [-a, y0],
          [a, y0],
          [a, y0 + slot],
          [t, y0 + slot + a - t],
          [t, bh + 1],
          [-t, bh + 1],
          [-t, y0 + slot + a - t],
          [-a, y0 + slot],
        ],
        -bd / 2 + 4,
        bd / 2 + 1,
      ),
    );
  }
  return { cut, add };
}

export const mountBossBuilder: AttachmentBuilder<MountBossOptions> = {
  body(w, s, o, layout) {
    const p = bossPlan(o);
    const { bw, bd, bh } = p;
    const xc = layout.w / 2;
    const B = BOSS_BACK;
    /** The platform's frame to the part's, a point (y, z). */
    const at = (y: number, z: number): Vec2 => [p.y0 + y * p.cs - z * p.sn, p.zc + y * p.sn + z * p.cs];
    const place = (m: Manifold) => s.t(s.t(m.rotate([o.tilt, 0, 0])).translate([xc, p.y0, p.zc]));
    const parts: Manifold[] = [s.t(boxAt(w, 0, 0, 0, layout.w, layout.h, B)), place(s.t(boxAt(w, -bw / 2, 0, -bd / 2, bw / 2, bh, bd / 2)))];
    if (o.tilt > 0) {
      // The skirt: the platform's bottom (0.5 mm into it, to join it cleanly) and the same pushed down to the bed.
      const pts: [number, number, number][] = [];
      for (const x of [-bw / 2, bw / 2])
        for (const z of [-bd / 2, bd / 2]) {
          const [y, zz] = at(0.5, z);
          pts.push([xc + x, y, zz], [xc + x, 0, zz]);
        }
      parts.push(s.t(w.Manifold.hull(pts)));
    }
    // The arm: from the platform's back top edge, back to the back plate at 45° (as high as the plate allows).
    const [ya, za] = at(bh, -bd / 2);
    const top = Math.min(layout.h - 2, ya + za - B);
    // (It runs 0.5 mm into the platform: meeting it face to face, a long arm could come apart from it.)
    const arm: Vec2[] = [
      [B - 0.5, 0],
      [za + 0.5, 0],
      [za + 0.5, ya],
      [za - (top - ya), top],
      [B - 0.5, top],
    ].filter((q, k, all) => k === 0 || Math.hypot(q[0] - all[k - 1][0], q[1] - all[k - 1][1]) > 1e-6) as Vec2[];
    // Wide enough round a tilted bolt's way in to keep 2 mm walls.
    const bolt = BOSS_BOLTS[o.fixing as keyof typeof BOSS_BOLTS];
    const aw = Math.min(bw, bolt ? (2 * bolt.af) / Math.sqrt(3) + 4 : 16);
    parts.push(
      prismX(
        w,
        s,
        arm.map(([z, y]) => [-z, y]),
        xc - aw / 2,
        aw,
      ),
    );
    const f = fixing(w, s, o, bw, bd, bh);
    let body = s.t(w.Manifold.union(parts));
    // The cuts stay clear of the back plate (a steep tilt sends the bolt's way in down and back).
    const clear = s.t(boxAt(w, -1, -100, B, layout.w + 1, layout.h + 100, p.zMax + 100));
    if (f.cut.length) body = s.t(body.subtract(s.t(place(s.t(w.Manifold.union(f.cut))).intersect(clear))));
    return f.add.length ? s.t(w.Manifold.union([body, ...f.add.map(place)])) : body;
  },
};
