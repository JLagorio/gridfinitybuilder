import type { Manifold, Scope, Vec2, Wasm } from '../../geometry/kernel';
import { boxAt, cylinderAt } from '../../geometry/shapes';
import { textRects } from '../../geometry/digits';
import { prismY } from '../mount';
import type { AttachmentBuilder } from '../build';
import { cornerGusset } from './shelf.geom';
import { DRIVES, INDEX, TOOL, labelWidth, toolLayout, type ToolHole, type ToolRackOptions } from './toolRack';

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
  const y0 = h.shape === 'socket' ? t - SOCKET : h.shape === 'blind' ? t - INDEX.depth : -1;
  if (h.shape === 'round' || h.shape === 'blind') {
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

/** A socket's square post standing on the ledge at (x, z), side `a`, `h` tall, its top chamfered 45° all round. */
function post(w: Wasm, s: Scope, x: number, z: number, t: number, a: number, h: number): Manifold {
  const ch = Math.min(1, a / 4);
  const sq = (b: number): Vec2[] => [
    [-b / 2, -b / 2],
    [b / 2, -b / 2],
    [b / 2, b / 2],
    [-b / 2, b / 2],
  ];
  const k = (a - 2 * ch) / a;
  const body = s.t(w.Manifold.extrude([sq(a)], h - ch + 0.5));
  const tip = s.t(s.t(w.Manifold.extrude([sq(a)], ch, 0, 0, [k, k])).translate([0, 0, h - ch + 0.5]));
  // Built along z from the ledge's inside, then stood up: (x, y, z) → (x, z, -y) and moved over its spot.
  return s.t(s.t(s.t(w.Manifold.union([body, tip])).rotate([-90, 0, 0])).translate([x, t - 0.5, z]));
}

/** A size engraved in the ledge's top in front of its hole, reading from the front: seven-segment digits, a square dot. */
function engraved(w: Wasm, s: Scope, text: string, cx: number, z0: number, t: number): Manifold[] {
  const { text: th, stroke, engrave } = INDEX;
  const out: Manifold[] = [];
  let x = cx - labelWidth(text) / 2;
  for (const ch of text) {
    // Glyph y up the text is toward the board (-z), so it reads from the front.
    const rects = ch === '.' ? [{ x0: 0, y0: 0, x1: stroke, y1: stroke }] : textRects(ch, th, stroke);
    for (const g of rects) out.push(s.t(boxAt(w, x + g.x0, t - engrave, z0 + th - g.y1, x + g.x1, t + 1, z0 + th - g.y0)));
    x += (ch === '.' ? stroke : 0.55 * th) + 1.3 * stroke;
  }
  return out;
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
    if (o.mode === 'sockets') {
      const [a, ph] = DRIVES[o.drive];
      return s.t(w.Manifold.union([body, ...l.holes.map((h) => post(w, s, h.x, h.z, l.t, a, ph))]));
    }
    const cuts = l.holes.map((h) => cut(w, s, h, l.t, H + 1, D));
    // A drill index: each size in front of its hole.
    const back = Math.max(...l.holes.map((h) => h.sz / 2));
    for (const h of l.holes) if (h.label) cuts.push(...engraved(w, s, h.label, h.x, h.z + back + 1, l.t));
    return s.t(body.subtract(s.t(w.Manifold.union(cuts))));
  },
};
