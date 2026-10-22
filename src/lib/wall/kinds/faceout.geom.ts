/**
 * Faceout geometry (planning in faceout.ts): the side view (wall z out, y up)
 * of the arm, its gusset, the tip or knob, less the notches, extruded across
 * the arm's width; the back plate as tall as the part, the label plate a box
 * at the tip.
 */
import type { Manifold, Vec2 } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import type { AttachmentBuilder } from '../build';
import { extrudeX, sideSection } from './ledBar.geom';
import { FACEOUT, faceoutPlan, type FaceoutOptions } from './faceout';

/** Where the notches are along the arm (z out from the board) and how deep each is (half as wide), mm. */
export function faceoutNotches(o: FaceoutOptions, h: number, p: ReturnType<typeof faceoutPlan>): { z: number[]; depth: number } {
  const P = FACEOUT.back;
  const g = faceoutGusset(o, h);
  const z0 = P + g + 6;
  const z1 = (o.label ? o.length - FACEOUT.labelT : o.stopper === 'tip' ? o.length - o.arm : o.stopper === 'ball' ? o.length - 2 * p.knob : o.length) - 6;
  if (!o.notches || z1 <= z0) return { z: [], depth: 0 };
  const step = (z1 - z0) / o.notches;
  return { z: Array.from({ length: o.notches }, (_, i) => z0 + (i + 0.5) * step), depth: Math.min(0.4 * o.arm, step / 2 - 0.5) };
}

/** The gusset's size in the corner above the arm's root. */
const faceoutGusset = (o: FaceoutOptions, h: number) => Math.max(0, Math.min(20, h - o.arm - 2, (o.length - FACEOUT.back) / 4));

export const faceoutBuilder: AttachmentBuilder<FaceoutOptions> = {
  body(w, s, o, layout, ctx) {
    const p = faceoutPlan(o, ctx);
    const P = FACEOUT.back;
    const L = o.length;
    const a = o.arm;
    const H = layout.h;
    const { top, bottom } = p;
    const end = o.label ? L - FACEOUT.labelT + 0.5 : o.stopper === 'ball' ? L - p.knob : L;
    const g = faceoutGusset(o, H);
    const polys: Vec2[][] = [
      [
        [P - 0.5, 0],
        [end, bottom(end)],
        [end, top(end)],
        [P - 0.5, a],
      ],
    ];
    if (g > 0)
      polys.push([
        [P - 0.5, a - 0.5],
        [P + g, top(P + g) - 0.5],
        [P - 0.5, a + g],
      ]);
    if (!o.label && o.stopper === 'tip')
      polys.push([
        [L - a, top(L - a) - 0.5],
        [L, top(L) - 0.5],
        [L, top(L) + p.tip],
        [L - a, top(L) + p.tip],
      ]);
    let side = sideSection(w, s, polys);
    if (!o.label && o.stopper === 'ball') {
      const r = p.knob;
      side = s.t(side.add(s.t(s.t(w.CrossSection.circle(r, 48)).translate([-(L - r), top(L - r) - 0.2 * r]))));
    }
    const n = faceoutNotches(o, H, p);
    if (n.z.length) {
      const d = n.depth;
      side = s.t(
        side.subtract(
          sideSection(
            w,
            s,
            n.z.map((z) => [
              [z - d - 1, top(z - d - 1) + 1],
              [z, top(z) - d],
              [z + d + 1, top(z + d + 1) + 1],
            ]),
          ),
        ),
      );
    }
    const parts: Manifold[] = [
      extrudeX(w, s, side, 0, o.width),
      extrudeX(
        w,
        s,
        sideSection(w, s, [
          [
            [0, 0],
            [P, 0],
            [P, H],
            [0, H],
          ],
        ]),
        0,
        p.bw,
      ),
    ];
    if (o.label) {
      const z0 = L - FACEOUT.labelT;
      parts.push(s.t(boxAt(w, 0, bottom(z0), z0, o.labelW, bottom(z0) + FACEOUT.labelH, L)));
    }
    return s.t(w.Manifold.union(parts));
  },
};
