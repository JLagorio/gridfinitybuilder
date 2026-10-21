import type { CrossSection } from 'manifold-3d';
import type { Vec2 } from '../../geometry/kernel';
import type { AttachmentBuilder } from '../build';
import { CLIP, clipHeight, clipSeat, type CableClipOptions } from './cableClip';
import { extrudeX, rectZY, sideSection } from './ledBar.geom';

export const cableClipBuilder: AttachmentBuilder<CableClipOptions> = {
  body(w, s, o, layout, ctx) {
    const seat = clipSeat(o);
    const { st, H } = clipHeight(o, ctx);
    const solid: CrossSection[] = [sideSection(w, s, [rectZY(0, 0, CLIP.back, H)])];
    const holes: CrossSection[] = [];
    // The side view, in wall (z, y); circles go straight into the cross-section's (-z, y).
    const circle = (r: number, zc: number, yc: number) => s.t(s.t(w.CrossSection.circle(r, 64)).translate([-zc, yc]));
    for (let k = 0; k < o.count; k++) {
      const y0 = (H - st) / 2 + k * (seat.h + o.gap);
      const yc = y0 + seat.h / 2;
      const block = sideSection(w, s, [rectZY(0, y0, seat.z, y0 + seat.h)]);
      if (o.style === 'round') {
        // A ring cut off flat at the front, where its opening is 90% of the cable.
        solid.push(s.t(circle(seat.r + seat.t, seat.zc, yc).intersect(block)));
        holes.push(circle(seat.r, seat.zc, yc));
      } else {
        // A slot as deep as the cable is wide, its mouth narrowed by a lip each side that flares out at the front.
        const z1 = CLIP.back + o.flatW + 0.4;
        const a = yc - (o.flatT + 0.2) / 2;
        const b = yc + (o.flatT + 0.2) / 2;
        const li = (b - a - seat.o) / 2;
        const slot: Vec2[] = [
          [CLIP.back, a],
          [z1, a],
          [z1, a + li],
          [seat.z - li, a + li],
          [seat.z, a],
          [seat.z + 1, a - 1],
          [seat.z + 1, b + 1],
          [seat.z, b],
          [seat.z - li, b - li],
          [z1, b - li],
          [z1, b],
          [CLIP.back, b],
        ];
        solid.push(block);
        holes.push(sideSection(w, s, [slot]));
      }
    }
    const side = s.t(s.t(w.CrossSection.union(solid)).subtract(s.t(w.CrossSection.union(holes))));
    return extrudeX(w, s, side, 0, layout.w);
  },
};
