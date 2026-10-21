import type { Manifold, Scope, Vec2, Wasm } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import { prismY } from '../mount';
import type { AttachmentBuilder } from '../build';
import { cornerGusset } from './shelf.geom';
import { TOOL, toolLayout, type ToolHole, type ToolRackOptions } from './toolRack';

/** 45° chamfer round the mouth of a round hole, fillet along the ledge's back edge, depth of a bit socket; mm. */
const CHAMFER = 0.8;
const FILLET = 3;
const SOCKET = 10;

/** Upright cylinder (along y) at (x, z) from y0 to y1, radius r0 at the bottom and r1 at the top. */
function upright(w: Wasm, s: Scope, x: number, z: number, y0: number, y1: number, r0: number, r1: number): Manifold {
  return s.t(s.t(s.t(cylinderAt(w, 0, 0, 0, y1 - y0, r0, r1)).rotate([-90, 0, 0])).translate([x, y0, z]));
}

/** What a hole takes out of the ledge: through holes go right up (clearing the fillet), sockets stop above the floor. */
function cut(w: Wasm, s: Scope, h: ToolHole, t: number, top: number, front: number): Manifold {
  const y0 = h.shape === 'socket' ? t - SOCKET : -1;
  if (h.shape === 'round') {
    const r = h.sx / 2;
    return s.t(w.Manifold.union([upright(w, s, h.x, h.z, y0, top, r, r), upright(w, s, h.x, h.z, t - CHAMFER, t + 0.01, r, r + CHAMFER + 0.01)]));
  }
  if (h.shape === 'hex' || h.shape === 'socket') {
    // Flats front and back, corners left and right; prismY's polygon is in (x, d) with d behind the board's front.
    const a = h.sx / 2;
    const f = h.sz / 2;
    const pts: Vec2[] = [
      [a, 0],
      [a / 2, -f],
      [-a / 2, -f],
      [-a, 0],
      [-a / 2, f],
      [a / 2, f],
    ].map(([x, d]) => [h.x + x, -h.z + d] as Vec2);
    return prismY(w, s, pts, y0, top - y0);
  }
  // Slots; a comb runs out through the front.
  const z1 = h.shape === 'comb' ? front + 1 : h.z + h.sz / 2;
  return s.t(boxAt(w, h.x - h.sx / 2, y0, h.z - h.sz / 2, h.x + h.sx / 2, top, z1));
}

export const toolRackBuilder: AttachmentBuilder<ToolRackOptions> = {
  body(w, s, o, layout) {
    const W = layout.w;
    const H = layout.h;
    const D = layout.depth;
    const l = toolLayout(o);
    const B = TOOL.back;
    const g = Math.min(D - B, H - l.t, 40);
    const body = s.t(
      w.Manifold.union([
        s.t(boxAt(w, 0, 0, 0, W, H, B)),
        s.t(boxAt(w, 0, 0, 0, W, l.t, D)),
        cornerGusset(w, s, B, l.t, Math.min(FILLET, g), 0, W),
        cornerGusset(w, s, B, l.t, g, 0, TOOL.end),
        cornerGusset(w, s, B, l.t, g, W - TOOL.end, TOOL.end),
      ]),
    );
    if (!l.holes.length) return body;
    return s.t(body.subtract(s.t(w.Manifold.union(l.holes.map((h) => cut(w, s, h, l.t, H + 1, D))))));
  },
};
