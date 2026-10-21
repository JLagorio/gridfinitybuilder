/**
 * Two-colour shadow boards: each tool pocket (the whole-bin 'cutouts'
 * interior, or 'tools' compartments) is cut SHADOW.depth deeper under the tool's
 * outline, and that layer is filled flush by an overlay body printed in
 * filament 2, like inlaid label text. With the tool out, its shape shows in
 * the second colour.
 *
 * cutoutCutters (cutouts.ts) cuts the deeper floor; this module builds the
 * filling, clipped exactly like the pockets, and attaches it to the mesh.
 *
 * Must not import bin.ts at runtime (bin.ts imports this module).
 */
import { assertValid, toMeshData, type Manifold, type MeshData, type Scope, type Wasm } from './kernel';
import { INNER_RADIUS, WALL } from './spec';
import { boxAt, extrudePolygon, roundedRectRing } from './shapes';
import type { BinOptions } from './bin';
import { cutoutFloor, cutoutStyle, notchCutters, placedOutline, pocketFloorZ } from './cutouts';
import { SHADOW, wantsShadow } from './insertOptions';
import { compartmentInside } from './compartments';
import { resolveLayout } from '../dividers';

const ROUND_SEGS = 32;

/** The pockets' filament-2 floors (bin-centered, top of the fill at `top`), or null when the shadow floor doesn't apply. */
export function shadowFloors(w: Wasm, s: Scope, o: BinOptions, W: number, D: number, top: number): Manifold | null {
  if (!wantsShadow(o)) return null;
  const st = cutoutStyle(o);
  const floor = cutoutFloor(o);
  const pockets: { area: Manifold; zb: number; box: [number, number, number, number]; notches: Manifold[] }[] = [];
  for (const c of o.cutouts ?? []) {
    if (c.outline.length < 3) continue;
    const tool = s.t(new w.CrossSection([placedOutline(c)], 'NonZero'));
    const area = c.clearance > 0 ? s.t(tool.offset(c.clearance, 'Round', 2, ROUND_SEGS)) : tool;
    if (area.isEmpty()) continue;
    const zb = pocketFloorZ(top, c, st, floor);
    if (zb >= top - 0.05) continue;
    const b = area.bounds();
    const notches = notchCutters(w, s, c, st, zb, top + 2);
    pockets.push({ area: s.t(area.extrude(SHADOW.depth).translate([0, 0, zb - SHADOW.depth])), zb, box: [b.min[0], b.min[1], b.max[0], b.max[1]], notches });
  }
  if (!pockets.length) return null;
  // Where pockets overlap, a floor must not float in a deeper pocket's opening, nor over a deeper pocket's finger notch.
  const fills = pockets.map((p, i) => {
    const deeper = pockets.filter((q, j) => j !== i && q.zb < p.zb - 1e-6);
    const voids = deeper
      .filter((q) => q.box[0] < p.box[2] && p.box[0] < q.box[2] && q.box[1] < p.box[3] && p.box[1] < q.box[3])
      .map((q) => {
        const cs = s.t(q.area.slice(q.zb - SHADOW.depth / 2));
        return s.t(s.t(cs.extrude(top + 2 - q.zb)).translate([0, 0, q.zb]));
      });
    voids.push(...deeper.flatMap((q) => q.notches));
    return voids.length ? s.t(p.area.subtract(s.t(w.Manifold.union(voids)))) : p.area;
  });
  let m = s.t(w.Manifold.union(fills));
  // Inside the walls, as cutoutCutters clips the pockets.
  const inner = roundedRectRing(-W / 2 + WALL, -D / 2 + WALL, W / 2 - WALL, D / 2 - WALL, INNER_RADIUS);
  m = s.t(m.intersect(s.t(extrudePolygon(w, inner, floor - 2, top + 2))));
  // Tool compartments: only inside them, as layoutCuts clips the tools.
  if (o.interior !== 'cutouts') {
    const r = resolveLayout(o.layout, W - 2 * WALL, D - 2 * WALL);
    const ix0 = -W / 2 + WALL;
    const iy0 = -D / 2 + WALL;
    const boxes = r.compartments
      .filter((c) => compartmentInside(o.layout?.comps?.[c.key]) === 'tools')
      .flatMap((c) => c.rects.map((rc) => s.t(boxAt(w, ix0 + rc.x0, iy0 + rc.y0, floor - 2, ix0 + rc.x1, iy0 + rc.y1, top + 2))));
    if (!boxes.length) return null;
    m = s.t(m.intersect(s.t(w.Manifold.union(boxes))));
  }
  return m.isEmpty() ? null : m;
}

/** Attach the shadow floors to a built bin mesh as a filament-2 overlay (the mesh unchanged when they don't apply). */
export function shadowOverlay(w: Wasm, s: Scope, o: BinOptions, W: number, D: number, top: number, mesh: MeshData): MeshData {
  const m = shadowFloors(w, s, o, W, D, top);
  if (!m) return mesh;
  assertValid(m, 'shadow floor');
  const d = toMeshData(m);
  mesh.overlays = [...(mesh.overlays ?? []), { name: 'Tool shadows', filament: 2, role: 'shadow', positions: d.positions, indices: d.indices }];
  return mesh;
}
