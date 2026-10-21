/**
 * Adjustable divider rails (planning in accessories.ts).
 *
 * In the bin, at every rail: a pair of guide ribs on the inner faces of the
 * two walls the plate runs between (RAIL.rib thick, either side of a slot as
 * wide as a removable divider's), reaching in past the plate's end like a
 * removable divider's ribs; and the plate's whole path kept clear from the
 * floor groove up to the top of the compartments, so a plate slides in
 * through label tabs, scoops and any fixed divider it crosses.
 *
 * Plates lie flat for printing like removable dividers (length along X,
 * height along Y, thickness along Z, the floor edge at y = 0 with beveled
 * corners). With rails both ways they get egg-crate slots: plates running
 * front to back from the top, plates running left to right from the bottom.
 *
 * Must not import bin.ts at runtime.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from './kernel';
import { WALL } from './spec';
import { boxAt, extrudePolygon } from './shapes';
import { RAIL, RAIL_SLOT, type RailPlan, type RailPlatePart } from './accessories';

/** Ribs (`add`) and plate paths (`cut`) for a bin (bin-centered). */
export function railBinParts(w: Wasm, s: Scope, plan: RailPlan, W: number, D: number, zFloor: number): { add: Manifold[]; cut: Manifold[] } {
  const add: Manifold[] = [];
  const cut: Manifold[] = [];
  const half = RAIL_SLOT / 2;
  const fx = W / 2 - WALL;
  const fy = D / 2 - WALL;
  const zr0 = zFloor - 0.5;
  const zr1 = plan.z1;
  const into = 0.3;
  // X rails: plates run front to back; ribs on the front and back walls.
  for (const x of plan.xs) {
    for (const [c0, c1] of [
      [x - half - RAIL.rib, x - half],
      [x + half, x + half + RAIL.rib],
    ]) {
      add.push(s.t(boxAt(w, c0, -fy - into, zr0, c1, -fy + plan.ribDepth, zr1)));
      add.push(s.t(boxAt(w, c0, fy - plan.ribDepth, zr0, c1, fy + into, zr1)));
    }
    cut.push(s.t(boxAt(w, x - half, -fy + plan.endGap - 0.1, plan.z0, x + half, fy - plan.endGap + 0.1, plan.z1 + 0.01)));
  }
  // Y rails: plates run left to right; ribs on the left and right walls.
  for (const y of plan.ys) {
    for (const [c0, c1] of [
      [y - half - RAIL.rib, y - half],
      [y + half, y + half + RAIL.rib],
    ]) {
      add.push(s.t(boxAt(w, -fx - into, c0, zr0, -fx + plan.ribDepth, c1, zr1)));
      add.push(s.t(boxAt(w, fx - plan.ribDepth, c0, zr0, fx + into, c1, zr1)));
    }
    cut.push(s.t(boxAt(w, -fx + plan.endGap - 0.1, y - half, plan.z0, fx - plan.endGap + 0.1, y + half, plan.z1 + 0.01)));
  }
  return { add, cut };
}

/** Bevel on a plate's floor-edge corners so it finds the groove. */
const BEVEL = 0.8;

/** Build a rail plate lying flat, min corner at the origin, bottom at z = 0. */
export function buildRailPlate(w: Wasm, p: RailPlatePart): MeshData {
  const s = new Scope();
  try {
    const L = p.length;
    const H = p.height;
    const c = Math.min(BEVEL, L / 4, H / 4);
    const outline: [number, number][] = [
      [c, 0],
      [L - c, 0],
      [L, c],
      [L, H],
      [0, H],
      [0, c],
    ];
    let m = s.t(extrudePolygon(w, outline, 0, p.thickness));
    if (p.slotsFrom && p.slots.length) {
      const hw = p.slotWidth / 2;
      const [v0, v1] = p.slotsFrom === 'top' ? [H - p.slotDepth, H + 1] : [-1, p.slotDepth];
      const slots = p.slots.filter((at) => at - hw > 0.5 && at + hw < L - 0.5).map((at) => s.t(boxAt(w, at - hw, v0, -1, at + hw, v1, p.thickness + 1)));
      if (slots.length) m = s.t(m.subtract(s.t(w.Manifold.union(slots))));
    }
    assertValid(m, 'rail plate');
    return toMeshData(m);
  } finally {
    s.dispose();
  }
}
