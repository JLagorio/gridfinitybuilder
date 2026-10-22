import type { Vec2 } from '../../geometry/kernel';
import { prismX } from '../mount';
import type { AttachmentBuilder } from '../build';
import { HOOK_PLATE, type HookOptions } from './hook';

/** The hook's side profile (out from the board, up), extruded across its width. */
export const hookBuilder: AttachmentBuilder<HookOptions> = {
  body(w, s, o, layout) {
    const P = HOOK_PLATE;
    const a = o.arm;
    const R = Math.max(o.reach, P + a);
    const parts = [prismX(w, s, rect(0, 0, -P, layout.h), 0, layout.w)];
    const tan = Math.tan((o.angle * Math.PI) / 180);
    // Profiles are in (d, y): d is behind the board, so out from it is -d.
    const arm = (y: number, tip: number) => {
      const pts: Vec2[] = [
        [-P + 0.5, y],
        [-R, y],
        [-R, y + a + tip],
        [-R + a, y + a + tip],
        [-R + a, y + a],
        [-P + 0.5, y + a],
      ];
      parts.push(prismX(w, s, pts, 0, o.width));
    };
    if (o.style === 'j') arm(0, o.tip);
    else if (o.style === 'u') arm(0, o.tip);
    else if (o.style === 'double') {
      arm(0, o.tip);
      arm(o.spacing, o.tip);
    } else {
      // L and peg: a straight arm pointing up; a peg ends in a knob.
      const rise = (R - P) * tan;
      const pts: Vec2[] = [
        [-P + 0.5, 0],
        [-R, rise],
        [-R, rise + a],
        [-P + 0.5, a],
      ];
      parts.push(prismX(w, s, pts, 0, o.width));
      if (o.style === 'peg') parts.push(prismX(w, s, rect(-R + a * 0.2, rise - a * 0.3, -R, rise + a * 1.6), 0, o.width));
    }
    return s.t(w.Manifold.union(parts));
  },
};

/** A rectangle in (d, y). */
function rect(d0: number, y0: number, d1: number, y1: number): Vec2[] {
  return [
    [d0, y0],
    [d1, y0],
    [d1, y1],
    [d0, y1],
  ];
}
