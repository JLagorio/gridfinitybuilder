import type { Manifold, Scope, Vec2, Wasm } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { prismX } from '../mount';
import type { AttachmentBuilder } from '../build';
import { SHELF_BACK, type ShelfOptions } from './shelf';

/** Gusset and side wall thickness, lip thickness, the fillet along the shelf's back edge, drain slot width and pitch; mm. */
export const SHELF = { gusset: 3, side: 2.4, lip: 2, fillet: 4, slot: 3, slotPitch: 8, gussetEvery: 150 } as const;

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

export const shelfBuilder: AttachmentBuilder<ShelfOptions> = {
  body(w, s, o, layout) {
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
    const n = Math.ceil(W / SHELF.gussetEvery) - 1;
    for (let k = 1; k <= n; k++) ribs.push((W * k) / (n + 1));
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
