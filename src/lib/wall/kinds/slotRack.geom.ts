/**
 * Slot rack geometry (planning in slotRack.ts). The side view (wall z out, y
 * up) is drawn in the rack's tilted frame: u square to the dividers (out from
 * the board), v along them (up), from the back of the first slot at its floor.
 * Everything from the back plate out to the front wall's face, up to the
 * dividers' tops, less the slots (each one's floor square to its dividers,
 * its back corner on the floor line), the hollow behind the first divider
 * (leaning back, it meets the back plate at the top) and the front wall above
 * its top; the back plate added back whole. Then extruded across, and the
 * finger notch and the drain holes cut straight down through it.
 */
import type { Manifold, Vec2 } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import type { AttachmentBuilder } from '../build';
import { extrudeX, sideSection } from './ledBar.geom';
import { RACK_BACK, rackPlan, type SlotRackOptions } from './slotRack';

/** Drain holes: length across, pitch, and how far in from the slot's walls and the rack's ends; the notch's width share and most depth; mm. */
const DRAIN = { len: 10, pitch: 14, wall: 0.8, end: 4, minSlot: 6 } as const;
const NOTCH = { share: 0.2, r: 15, depth: 35 } as const;

/** A point of the side view (z, y) from the tilted frame (u square to the dividers, v along them). */
export function rackPoint(o: SlotRackOptions, u: number, v: number): Vec2 {
  const p = rackPlan(o);
  return [p.z0 + u * Math.cos(p.a) - v * Math.sin(p.a), p.f + u * Math.sin(p.a) + v * Math.cos(p.a)];
}

/** Slot k's run square to the dividers (u0..u0 + slot) and where its floor is along them (v0: its back corner on the floor line). */
export function rackSlot(o: SlotRackOptions, k: number): { u0: number; v0: number } {
  const p = rackPlan(o);
  const u0 = k * (o.slot + p.t);
  return { u0, v0: -u0 * Math.tan(p.a) };
}

export const slotRackBuilder: AttachmentBuilder<SlotRackOptions> = {
  body(w, s, o, layout) {
    const p = rackPlan(o);
    const W = layout.w;
    const H = layout.h;
    const tan = Math.tan(p.a);
    // The face of a wall square to the dividers at run u, at height y.
    const face = (u: number, y: number) => p.z0 + u / Math.cos(p.a) - (y - p.f) * tan;
    const big = H + p.u + 100;
    let side = sideSection(w, s, [
      [
        [0, 0],
        [face(p.u, 0), 0],
        [face(p.u, p.top), p.top],
        [0, p.top],
      ],
    ]);
    const cuts: Vec2[][] = [];
    for (let k = 0; k < o.count; k++) {
      const { u0, v0 } = rackSlot(o, k);
      cuts.push([rackPoint(o, u0, v0), rackPoint(o, u0 + o.slot, v0), rackPoint(o, u0 + o.slot, big), rackPoint(o, u0, big)]);
    }
    // Leaning back, the first divider meets the back plate at the top: hollow behind it, its underside the divider leaning back.
    const zr = face(-p.t, p.f);
    if (tan > 0 && zr - RACK_BACK > 2)
      cuts.push([
        [RACK_BACK, p.f],
        [zr, p.f],
        [RACK_BACK, p.f + (zr - RACK_BACK) / tan],
      ]);
    // The front wall stops at its own top.
    if (p.front < p.top - 1e-6) {
      const u = p.u - p.t - 0.01;
      cuts.push([
        [face(u, p.front), p.front],
        [big, p.front],
        [big, p.top + 1],
        [face(u, p.top + 1), p.top + 1],
      ]);
    }
    side = s.t(side.subtract(sideSection(w, s, cuts)));
    side = s.t(
      side.add(
        sideSection(w, s, [
          [
            [0, 0],
            [RACK_BACK, 0],
            [RACK_BACK, H],
            [0, H],
          ],
        ]),
      ),
    );
    let body = extrudeX(w, s, side, 0, W);
    const holes: Manifold[] = [];
    // (A short rack's notch is no wider than it is deep: its round end stays below the dividers' tops.)
    const notchDepth = Math.min(0.45 * o.height, NOTCH.depth);
    const notchR = Math.min(NOTCH.r, W * NOTCH.share, notchDepth - 1);
    if (o.notch && o.height >= 25 && notchR >= 3) {
      // A U from the dividers' tops, from the first slot's back forward (the first divider and the back plate stay whole).
      const r = notchR;
      const yc = p.top - notchDepth + r;
      const z1 = layout.depth + 1;
      const u = s.t(s.t(cylinderAt(w, W / 2, yc, RACK_BACK, z1, r, r, 48)).add(s.t(boxAt(w, W / 2 - r, yc, RACK_BACK, W / 2 + r, p.top + 1, z1))));
      const ahead = sideSection(w, s, [
        [
          [face(0, -1), -1],
          [z1, -1],
          [z1, p.top + 2],
          [face(0, p.top + 2), p.top + 2],
        ],
      ]);
      holes.push(s.t(u.intersect(extrudeX(w, s, ahead, -1, W + 2))));
    }
    if (o.floor === 'drain' && o.slot >= DRAIN.minSlot) {
      // Holes down through each slot's floor, between ribs across.
      const n = Math.max(1, Math.floor((W - 2 * DRAIN.end - DRAIN.len) / DRAIN.pitch) + 1);
      for (let k = 0; k < o.count; k++) {
        const { u0, v0 } = rackSlot(o, k);
        const back = rackPoint(o, u0, v0);
        const front = rackPoint(o, u0 + o.slot, v0);
        for (let i = 0; i < n; i++) {
          const x = W / 2 + (i - (n - 1) / 2) * DRAIN.pitch;
          holes.push(s.t(boxAt(w, x - DRAIN.len / 2, -1, back[0] + DRAIN.wall, x + DRAIN.len / 2, front[1] + 1, front[0] - DRAIN.wall)));
        }
      }
    }
    if (holes.length) body = s.t(body.subtract(s.t(w.Manifold.union(holes))));
    return body;
  },
};
