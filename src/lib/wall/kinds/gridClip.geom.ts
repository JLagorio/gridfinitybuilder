import type { Manifold, Vec2 } from '../../geometry/kernel';
import { BP_PROFILE, BP_PROFILE_DEPTH, BP_BOTTOM_CLEARANCE, BP_PROFILE_HEIGHT, GRID, LIP_DEPTH, LIP_PROFILE, LIP_SUPPORT_HEIGHT } from '../../geometry/spec';
import { prismX } from '../mount';
import type { AttachmentBuilder } from '../build';
import { CLIP, clipSide, type GridClipOptions } from './gridClip';

/** A rectangle in (z out from the board, y up). */
const rect = (z0: number, y0: number, z1: number, y1: number): Vec2[] => [
  [z0, y0],
  [z1, y0],
  [z1, y1],
  [z0, y1],
];
/** Side views are in (z, y); prismX takes (d, y), d = −z. */
const side = (pts: Vec2[]): Vec2[] => pts.map(([z, y]) => [-z, y]);

/** How far a catch reaches under the lip's taper, and the play it leaves above it, mm. */
const CATCH = { reach: 1, play: 0.3, length: 12 };

export const gridClipBuilder: AttachmentBuilder<GridClipOptions> = {
  body(w, s, o, layout) {
    const W = layout.w;
    const P = CLIP.plate;
    const { yb, wall, gap, h } = clipSide(o);
    const zt = P + gap;
    const armY = h - CLIP.arm;
    // The lip's inner edge (LIP_DEPTH in from the bin's back) is thickest from `wall` down LIP_SUPPORT_HEIGHT, then tapers at 45° to the wall.
    const taper = wall - LIP_SUPPORT_HEIGHT;
    const tip = P + LIP_DEPTH - CATCH.reach;
    const tipY = taper - CATCH.reach - CATCH.play;
    const reach = zt + 0.5 - tip;
    // The tongue reaches down to the bottom of its catch (lip), or just under the lip's thickest part (cradle).
    const bottom = o.style === 'lip' ? tipY - reach : wall - LIP_PROFILE.chamfer1 - 1;
    const prof: Vec2[][] = [rect(0, 0, P, h), rect(0, armY, zt + CLIP.tongue, h), rect(zt, bottom, zt + CLIP.tongue, armY + 0.5)];
    if (o.style === 'cradle') {
      // The back of a receptacle (baseplate profile, its ridge trimmed 0.4 mm), its cell edge 0.25 mm behind the bin's back.
      const e = P - 0.25;
      const z0 = yb + BP_BOTTOM_CLEARANCE;
      prof.push([
        [P - 0.5, 0],
        [e + BP_PROFILE_DEPTH, 0],
        [e + BP_PROFILE_DEPTH, z0],
        [e + BP_PROFILE.chamfer2, z0 + BP_PROFILE.chamfer1],
        [e + BP_PROFILE.chamfer2, z0 + BP_PROFILE.chamfer1 + BP_PROFILE.vertical],
        [e + 0.4, z0 + BP_PROFILE_HEIGHT - 0.4],
        [P - 0.5, z0 + BP_PROFILE_HEIGHT - 0.4],
      ]);
    }
    const parts: Manifold[] = prof.map((p) => prismX(w, s, side(p), 0, W));
    if (o.style === 'lip') {
      // A catch per cell, 45° above (parallel to the taper) and below (a lead-in for the lip as it's pushed up).
      const c: Vec2[] = [
        [zt + 0.5, tipY - reach],
        [tip, tipY],
        [zt + 0.5, tipY + reach],
      ];
      for (let k = 0; k < o.cells; k++) {
        // Cell centres: the clip starts 3.75 mm in from the side of the bin, which is 0.25 mm in from its cells.
        const x = GRID / 2 - 0.25 - 3.75 + k * GRID;
        parts.push(prismX(w, s, side(c), x - CATCH.length / 2, CATCH.length));
      }
    }
    return s.t(w.Manifold.union(parts));
  },
};
