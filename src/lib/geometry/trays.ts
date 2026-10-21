/**
 * Lift-out trays (planning in accessories.ts).
 *
 * In the bin: one ledge per tray around the inside of the outer wall, its top
 * where the tray's bottom rests, with a 45° underside. Each ledge reaches
 * TRAY.bearing in under its tray's edge; the tray below is smaller by that
 * plus the clearance, so it passes.
 *
 * The tray: an open box with TRAY.wall walls and floor, uniform compartments,
 * a chamfered bottom edge, and a lift tab at the top of the left and right end
 * walls (a shelf with a 45° underside to hook a finger under). Lies as it sits
 * in the bin; min corner at the origin.
 *
 * Must not import bin.ts at runtime.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec3, type Wasm } from './kernel';
import { DIVIDER } from './spec';
import { extrudePolygon, loftRoundedRect, roundedRectRing } from './shapes';
import { TRAY, wallShelf, type TrayPart, type TrayPlan } from './accessories';

/** The ledges a bin needs for its trays (bin-centered, unioned onto the bin). */
export function trayLedges(w: Wasm, s: Scope, plan: TrayPlan, W: number, D: number, zFloor: number): Manifold[] {
  return plan.levels.map((l) => wallShelf(w, s, W, D, l.z, l.z, l.ledge, zFloor - 0.5));
}

/** Build a tray with its min corner at the origin and its bottom at z = 0. */
export function buildTray(w: Wasm, p: TrayPart): MeshData {
  const T = TRAY;
  const s = new Scope();
  try {
    const r = Math.min(p.radius, p.w / 2 - 0.1, p.d / 2 - 0.1);
    const e = Math.min(T.footChamfer, r - 0.1);
    const outer = s.t(
      loftRoundedRect(w, 0, 0, p.w, p.d, r, [
        { z: 0, inset: e },
        { z: e, inset: 0 },
        { z: p.h, inset: 0 },
      ]),
    );
    const iw = p.w - 2 * T.wall;
    const id = p.d - 2 * T.wall;
    const cw = (iw - (p.divX - 1) * DIVIDER) / p.divX;
    const cd = (id - (p.divY - 1) * DIVIDER) / p.divY;
    const rc = Math.max(0.3, Math.min(r - T.wall, cw / 2 - 0.05, cd / 2 - 0.05));
    const cuts: Manifold[] = [];
    for (let i = 0; i < p.divX; i++) {
      for (let j = 0; j < p.divY; j++) {
        const x0 = -iw / 2 + i * (cw + DIVIDER);
        const y0 = -id / 2 + j * (cd + DIVIDER);
        cuts.push(s.t(extrudePolygon(w, roundedRectRing(x0, y0, x0 + cw, y0 + cd, rc), T.floor, p.h + 1)));
      }
    }
    let tray = s.t(outer.subtract(s.t(w.Manifold.union(cuts))));

    // Lift tabs: a shelf at the top of each end wall, 45° underneath.
    const reach = Math.min(T.tabReach, cw * 0.4, p.h - T.floor - T.tabTip - 1);
    const width = Math.min(T.tabWidth, id * 0.5);
    if (reach >= 2 && width >= 4) {
      const tabs: Manifold[] = [];
      for (const side of [-1, 1]) {
        const xw = side * (iw / 2 + 0.01);
        const xt = side * (iw / 2 - reach);
        const pts: Vec3[] = [];
        for (const y of [-width / 2, width / 2]) {
          pts.push([xw, y, p.h - T.tabTip - reach], [xw, y, p.h], [xt, y, p.h], [xt, y, p.h - T.tabTip]);
        }
        tabs.push(s.t(w.Manifold.hull(pts)));
      }
      tray = s.t(w.Manifold.union([tray, ...tabs]));
    }
    const out = s.t(tray.translate([p.w / 2, p.d / 2, 0]));
    assertValid(out, 'tray');
    return toMeshData(out);
  } finally {
    s.dispose();
  }
}
