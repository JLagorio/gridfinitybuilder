/**
 * Display ledge geometry (planning in displayLedge.ts). The side view (wall z
 * out, y up) is a hollow staircase: the back plate, each tier a tread `t`
 * thick from the riser behind it (or the back plate) to its nose, and its
 * riser standing on the bed; the hollow under each tread split into cells at
 * most 20 mm wide by walls, every cell's ceiling 45° fillets in its corners
 * and no more than 8 mm of bridge between them (a cell too low for that is
 * filled); the lip on each nose. Extruded across, with end walls closing the
 * cells. Then the studs stand on the treads, or the sockets and pockets sink
 * into them. The fit coupon is built as it prints, studs up.
 */
import { Scope, assertValid, toMeshData, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { boxAt, cylinderAt, roundedRectRing } from '../../geometry/shapes';
import { prismY } from '../mount';
import type { AttachmentBuilder } from '../build';
import { extrudeX, sideSection } from './ledBar.geom';
import { LEDGE, STUDS, ledgePlan, type DisplayLedgeOptions } from './displayLedge';

/** Clearance round a base in its socket, and round a car or a figure in its pocket (across, each side), mm. */
export const LEDGE_FIT = { socket: 0.5, pocket: 0.5 } as const;

/** Tier k (0: the bottom one): its tread's top and its nose, out from the board. */
export function ledgeTier(o: DisplayLedgeOptions, k: number): { y: number; nose: number } {
  const p = ledgePlan(o);
  return { y: p.t + k * o.rise, nose: LEDGE.back + (o.tiers - k) * p.tread };
}

/** Where things sit on tier k: their centres across (x), and out from the board (z; studs: a row each). */
export function ledgeSpots(o: DisplayLedgeOptions, k: number): { x: number[]; z: number[] } {
  const p = ledgePlan(o);
  const x0 = (p.w - o.columns * p.cw) / 2;
  const x = Array.from({ length: o.columns }, (_, i) => x0 + (i + 0.5) * p.cw);
  const zc = ledgeTier(o, k).nose - p.lipT - p.m - p.content / 2;
  if (o.mode !== 'studs') return { x, z: [zc] };
  const P = STUDS[o.system].pitch;
  return { x, z: Array.from({ length: o.rows }, (_, j) => zc + (j - (o.rows - 1) / 2) * P) };
}

/** A stud standing on y0 (sunk 0.5 into what it stands on), at (x, z). */
function stud(w: Wasm, s: Scope, d: number, h: number, x: number, y0: number, z: number): Manifold {
  const c = s.t(cylinderAt(w, 0, 0, 0, h + 0.5, d / 2, d / 2, 32));
  return s.t(s.t(c.rotate([-90, 0, 0])).translate([x, y0 - 0.5, z]));
}

export const displayLedgeBuilder: AttachmentBuilder<DisplayLedgeOptions> = {
  body(w, s, o, layout) {
    const p = ledgePlan(o);
    const B = LEDGE.back;
    const H = layout.h;
    const t = p.t;
    const rect = (z0: number, y0: number, z1: number, y1: number): Vec2[] => [
      [z0, y0],
      [z1, y0],
      [z1, y1],
      [z0, y1],
    ];
    const polys: Vec2[][] = [rect(0, 0, B, H)];
    const stairs: Vec2[][] = [];
    for (let k = 0; k < o.tiers; k++) {
      const { y, nose } = ledgeTier(o, k);
      // The tread, from the riser behind it (or the back plate); its own riser down to the bed; the lip.
      const zb = k === o.tiers - 1 ? B : ledgeTier(o, k + 1).nose;
      polys.push(rect(zb - (k === o.tiers - 1 ? 0.5 : t), y - t, nose, y));
      stairs.push(rect(B - 0.5, 0, nose, y));
      if (p.lipT) polys.push(rect(nose - p.lipT, y - 0.5, nose, y + o.lip));
      if (k === 0) continue;
      polys.push(rect(nose - t, 0, nose, y));
      // The hollow under the tread, split by walls into cells at most 20 wide; each cell's ceiling 45° fillets
      // and at most 8 mm of bridge, or a short cell filled.
      const yc = y - t;
      const zf = nose - t;
      const n = Math.max(1, Math.ceil((zf - zb + t) / (LEDGE.cell + t)));
      const cw = (zf - zb - (n - 1) * t) / n;
      const f = (cw - LEDGE.bridge) / 2;
      for (let i = 0; i < n; i++) {
        const z0 = zb + i * (cw + t);
        const z1 = z0 + cw;
        if (i > 0) polys.push(rect(z0 - t, 0, z0 + 0.01, yc + 0.5));
        if (f <= 0) continue;
        if (f > yc - 1) polys.push(rect(z0 - 0.5, 0, z1 + 0.5, yc + 0.5));
        else
          polys.push(
            [
              [z0 - 0.5, yc - f],
              [z0 + f, yc + 0.5],
              [z0 - 0.5, yc + 0.5],
            ],
            [
              [z1 + 0.5, yc - f],
              [z1 + 0.5, yc + 0.5],
              [z1 - f, yc + 0.5],
            ],
          );
      }
    }
    // End walls close the hollows at the sides.
    const ends = sideSection(w, s, stairs);
    let body = s.t(
      w.Manifold.union([
        extrudeX(w, s, sideSection(w, s, polys), 0, p.w),
        extrudeX(w, s, ends, 0, LEDGE.end),
        extrudeX(w, s, ends, p.w - LEDGE.end, LEDGE.end),
      ]),
    );
    const add: Manifold[] = [];
    const cut: Manifold[] = [];
    for (let k = 0; k < o.tiers; k++) {
      const { y } = ledgeTier(o, k);
      const { x, z } = ledgeSpots(o, k);
      for (const xc of x)
        for (const zc of z) {
          if (o.mode === 'studs') {
            const S = STUDS[o.system];
            add.push(stud(w, s, S.d + o.tol, S.h, xc, y, zc));
          } else if (o.recess > 0) {
            if (o.mode === 'bases') {
              const r = o.base / 2 + LEDGE_FIT.socket;
              const c = s.t(cylinderAt(w, 0, 0, 0, o.recess + 1, r, r, 64));
              cut.push(s.t(s.t(c.rotate([-90, 0, 0])).translate([xc, y - o.recess, zc])));
            } else {
              const f = LEDGE_FIT.pocket;
              const ring = roundedRectRing(xc - o.itemW / 2 - f, zc - o.itemD / 2 - f, xc + o.itemW / 2 + f, zc + o.itemD / 2 + f, 1);
              cut.push(
                prismY(
                  w,
                  s,
                  ring.map(([px, pz]) => [px, -pz] as Vec2),
                  y - o.recess,
                  o.recess + 1,
                ),
              );
            }
          }
        }
    }
    if (add.length) body = s.t(w.Manifold.union([body, ...add]));
    if (cut.length) body = s.t(body.subtract(s.t(w.Manifold.union(cut))));
    return body;
  },
  part(w, spec: { system: DisplayLedgeOptions['system']; tol: number }) {
    const s = new Scope();
    try {
      // A strip with three 2 × 2 patches, their studs 0.05 thinner, as set and 0.05 fatter; one, two and three notches in front of them.
      const S = STUDS[spec.system];
      const P = S.pitch;
      const th = 3.2;
      const add: Manifold[] = [s.t(boxAt(w, 0, 0, 0, 6 * P + 4, 2 * P, th))];
      const cut: Manifold[] = [];
      for (let g = 0; g < 3; g++) {
        const x0 = g * (2 * P + 2);
        const r = (S.d + spec.tol + (g - 1) * 0.05) / 2;
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) add.push(s.t(cylinderAt(w, x0 + (i + 0.5) * P, (j + 0.5) * P, th - 0.5, th + S.h, r, r, 32)));
        for (let n = 0; n <= g; n++) {
          const xc = x0 + P + (n - g / 2) * 2.4;
          const tri: Vec2[] = [
            [xc - 1, -0.5],
            [xc + 1, -0.5],
            [xc, 1.2],
          ];
          cut.push(s.t(s.t(w.Manifold.extrude([tri], th + 2)).translate([0, 0, -1])));
        }
      }
      const m = s.t(s.t(w.Manifold.union(add)).subtract(s.t(w.Manifold.union(cut))));
      assertValid(m, 'stud coupon');
      return toMeshData(m);
    } finally {
      s.dispose();
    }
  },
};
