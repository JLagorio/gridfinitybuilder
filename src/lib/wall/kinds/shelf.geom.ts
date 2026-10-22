import type { CrossSection } from 'manifold-3d';
import type { Manifold, Scope, Vec2, Wasm } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { ccw, prismX } from '../mount';
import type { AttachmentBuilder } from '../build';
import { SHELF, SHELF_BACK, shelfRibs, type ShelfOptions } from './shelf';

/**
 * A 45° triangle `size` on a side in the corner between a back plate (`back`
 * thick) and a floor (`floor` thick), across x0..x0 + width. It stands on the
 * floor, so it prints without support when the floor is on the bed.
 */
export function cornerGusset(w: Wasm, s: Scope, back: number, floor: number, size: number, x0: number, width: number): Manifold {
  const pts: Vec2[] = [
    [-1, floor - 1],
    [-(back + size), floor - 1],
    [-(back + size), floor],
    [-back, floor + size],
    [-1, floor + size],
  ];
  return prismX(w, s, pts, x0, width);
}

const SQ3 = Math.sqrt(3);

/** A shaped shelf's corners: a rounded one's radius, a half hexagon's corner cut across (x) and out (z). */
function shapeSize(o: ShelfOptions, W: number) {
  const run = o.depth - SHELF_BACK;
  const cx = Math.min(run / SQ3, 0.3 * W);
  return { r: Math.min(25, 0.6 * run, W / 2 - 1), cx, cz: cx * SQ3 };
}

/** How far out the shelf reaches at x across it (seen from above), for its shape. */
export function shelfDepthAt(o: ShelfOptions, W: number, x: number): number {
  const D = o.depth;
  const { r, cx, cz } = shapeSize(o, W);
  const side = Math.min(x, W - x);
  if (o.shape === 'rounded') {
    const e = Math.max(0, r - side);
    return D - r + Math.sqrt(r * r - e * e);
  }
  if (o.shape === 'hexagon') return D - (Math.max(0, cx - side) * cz) / cx;
  if (o.shape === 'halfRound') {
    const u = (x - W / 2) / (W / 2);
    return SHELF_BACK + (D - SHELF_BACK) * Math.sqrt(Math.max(0, 1 - u * u));
  }
  return D;
}

/** The shelf's outline seen from above (x across, z out from the board), its back along the board. */
export function shelfOutline(o: ShelfOptions, W: number): Vec2[] {
  const D = o.depth;
  const B = SHELF_BACK;
  const { r, cx, cz } = shapeSize(o, W);
  const arc = (x: number, z: number, rx: number, rz: number, a0: number, a1: number, n = 24): Vec2[] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = a0 + ((a1 - a0) * i) / n;
      return [x + rx * Math.cos(t), z + rz * Math.sin(t)] as Vec2;
    });
  const back: Vec2[] = [
    [0, 0],
    [W, 0],
  ];
  if (o.shape === 'rounded') return [...back, ...arc(W - r, D - r, r, r, 0, Math.PI / 2, 12), ...arc(r, D - r, r, r, Math.PI / 2, Math.PI, 12)];
  if (o.shape === 'hexagon') return [...back, [W, D - cz], [W - cx, D], [cx, D], [0, D - cz]];
  if (o.shape === 'halfRound') return [...back, ...arc(W / 2, B, W / 2, D - B, 0, Math.PI, 48)];
  return [...back, [W, D], [0, D]];
}

/** A cross-section in (x, -z) extruded up y from y0, `h` tall. */
function extrudeY(w: Wasm, s: Scope, cs: CrossSection, y0: number, h: number): Manifold {
  const e = s.t(w.Manifold.extrude(cs, h));
  return s.t(s.t(e.rotate([-90, 0, 0])).translate([0, y0, 0]));
}

/**
 * A shelf rounded, half a hexagon or half round: its floor and the gussets cut
 * to its outline, the lip round its front, the end gussets in where it is deep
 * enough, drain slots as deep as it is where they are.
 */
function shapedShelf(w: Wasm, s: Scope, o: ShelfOptions, W: number, H: number): Manifold {
  const D = o.depth;
  const T = o.floor;
  const B = SHELF_BACK;
  const G = SHELF.gusset;
  const at = (x: number) => shelfDepthAt(o, W, x);
  const plan = s.t(new w.CrossSection([ccw(shelfOutline(o, W).map(([x, z]) => [x, -z] as Vec2))], 'Positive'));
  const clip = extrudeY(w, s, plan, -1, H + 2);
  const parts: Manifold[] = [s.t(boxAt(w, 0, 0, 0, W, H, B)), extrudeY(w, s, plan, 0, T)];
  if (o.lip > 0) {
    // Round the front: from where the corners start (the whole arc for a half round).
    const { r, cz } = shapeSize(o, W);
    const from = o.shape === 'rounded' ? D - r : o.shape === 'hexagon' ? D - cz : B + 1;
    const front = s.t(w.CrossSection.square([W + 2, D + 2 - from]).translate([-1, -D - 1]));
    const ring = s.t(s.t(plan.subtract(s.t(plan.offset(-SHELF.lip, 'Round')))).intersect(front));
    parts.push(extrudeY(w, s, ring, 0, T + o.lip));
  }
  const ribs: Manifold[] = [cornerGusset(w, s, B, T, Math.min(SHELF.fillet, H - T - 0.5, D - B - 1), 0, W)];
  // The end gussets go in to where the shelf is deep enough to carry them.
  let xe = 0;
  while (xe < W / 2 - G && Math.min(at(xe), at(xe + G)) - B < 0.4 * (D - B)) xe += 0.5;
  const big = Math.min(Math.min(at(xe), at(xe + G)) - B, H - T, 60);
  ribs.push(cornerGusset(w, s, B, T, big, xe, G), cornerGusset(w, s, B, T, big, W - xe - G, G));
  const n = Math.ceil(W / SHELF.gussetEvery) - 1;
  const mids: number[] = [];
  for (let k = 1; k <= n; k++) mids.push((W * k) / (n + 1));
  for (const x of mids) ribs.push(cornerGusset(w, s, B, T, Math.min(big, 25), x - G / 2, G));
  parts.push(s.t(s.t(w.Manifold.union(ribs)).intersect(clip)));
  let body = s.t(w.Manifold.union(parts));
  if (o.holes === 'slots') {
    const edge = xe + G + 3;
    const z0 = B + SHELF.fillet + 2;
    const count = Math.floor((W - 2 * edge - SHELF.slot) / SHELF.slotPitch) + 1;
    const cuts: Manifold[] = [];
    for (let k = 0; k < count; k++) {
      const x = W / 2 + (k - (count - 1) / 2) * SHELF.slotPitch;
      const z1 = Math.min(at(x - SHELF.slot / 2), at(x + SHELF.slot / 2)) - (o.lip > 0 ? SHELF.lip : 0) - 3;
      if (z1 - z0 < 6 || mids.some((m) => Math.abs(m - x) < G / 2 + SHELF.slot / 2 + 2)) continue;
      cuts.push(s.t(boxAt(w, x - SHELF.slot / 2, -1, z0, x + SHELF.slot / 2, T + 1, z1)));
    }
    if (cuts.length) body = s.t(body.subtract(s.t(w.Manifold.union(cuts))));
  }
  return body;
}

export const shelfBuilder: AttachmentBuilder<ShelfOptions> = {
  body(w, s, o, layout) {
    if (o.shape !== 'rect') return shapedShelf(w, s, o, layout.w, layout.h);
    const W = layout.w;
    const H = layout.h;
    const D = o.depth;
    const T = o.floor;
    const B = SHELF_BACK;
    const G = SHELF.gusset;
    const parts = [s.t(boxAt(w, 0, 0, 0, W, H, B)), s.t(boxAt(w, 0, 0, 0, W, T, D))];
    if (o.lip > 0) parts.push(s.t(boxAt(w, 0, 0, D - SHELF.lip, W, T + o.lip, D)));
    // Along the whole back edge: a small fillet that spreads the load into the back.
    parts.push(cornerGusset(w, s, B, T, Math.min(SHELF.fillet, H - T - 0.5, D - B - 1), 0, W));
    // Gussets at the ends (or side walls), and between them on a long shelf.
    const big = Math.min(D - B, H - T, 60);
    const ribs: number[] = [];
    if (o.sides) {
      const front = Math.min(H, T + Math.max(o.lip, 10));
      const side: Vec2[] = [
        [0, 0],
        [-D, 0],
        [-D, front],
        [0, H],
      ];
      parts.push(prismX(w, s, side, 0, SHELF.side), prismX(w, s, side, W - SHELF.side, SHELF.side));
    } else parts.push(cornerGusset(w, s, B, T, big, 0, G), cornerGusset(w, s, B, T, big, W - G, G));
    ribs.push(...shelfRibs(W));
    for (const x of ribs) parts.push(cornerGusset(w, s, B, T, Math.min(big, 25), x - G / 2, G));
    let body = s.t(w.Manifold.union(parts));
    if (o.holes === 'slots') {
      // Drain slots front to back, clear of the fillet, the lip, the side walls and the gussets.
      const edge = (o.sides ? SHELF.side : G) + 3;
      const z0 = B + SHELF.fillet + 2;
      const z1 = D - (o.lip > 0 ? SHELF.lip : 0) - 3;
      const span = W - 2 * edge - SHELF.slot;
      const count = Math.floor(span / SHELF.slotPitch) + 1;
      const cuts: Manifold[] = [];
      for (let k = 0; k < count && z1 - z0 >= 6; k++) {
        const x = W / 2 + (k - (count - 1) / 2) * SHELF.slotPitch;
        if (ribs.some((r) => Math.abs(r - x) < G / 2 + SHELF.slot / 2 + 2)) continue;
        cuts.push(s.t(boxAt(w, x - SHELF.slot / 2, -1, z0, x + SHELF.slot / 2, T + 1, z1)));
      }
      if (cuts.length) body = s.t(body.subtract(s.t(w.Manifold.union(cuts))));
    }
    return body;
  },
};
