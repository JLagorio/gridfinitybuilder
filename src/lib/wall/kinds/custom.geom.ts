import type { CrossSection } from 'manifold-3d';
import type { Manifold, Scope, Vec2, Wasm } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { hasFont, textOutline } from '../../geometry/text';
import { ccw } from '../mount';
import type { AttachmentBuilder } from '../build';
import { CUSTOM, holeOutline, reachOf } from '../custom/profile';
import { customAddOns, customRibs, endHull, featureSpots, underside, type Spot } from '../custom/part';
import type { CustomOptions } from './custom';

/** Outlines in the profile's (z, y) as a cross-section in prismX's (d, y), d = −z. */
function section(w: Wasm, s: Scope, rings: Vec2[][]): CrossSection {
  return s.t(
    new w.CrossSection(
      rings.map((r) => ccw(r.map(([z, y]) => [-z, y] as Vec2))),
      'Positive',
    ),
  );
}

/** A cross-section in (d, y) extruded across x from x0, `width` wide (as prismX does a polygon). */
function acrossX(w: Wasm, s: Scope, cs: CrossSection, x0: number, width: number): Manifold {
  const e = s.t(w.Manifold.extrude(cs, width));
  return s.t(s.t(e.rotate([0, 90, 0])).translate([x0, 0, 0]));
}

/**
 * What a hole, slot, notch or text takes out: its outline in the face's (u, v), from 1 mm out of the face to its
 * depth in, turned onto the face (u along x, v along the face, w out along its normal: right-handed, so text reads
 * from outside). Null for text before the font is loaded.
 */
function cut(w: Wasm, s: Scope, sp: Spot): Manifold | null {
  const f = sp.feature;
  let cs: CrossSection;
  if (f.k === 'text') {
    if (!f.t?.trim() || !hasFont()) return null;
    const t = textOutline(f.t, { size: f.b, maxWidth: f.a, maxHeight: f.b * 1.4 });
    if (!t.contours.length) return null;
    cs = s.t(s.t(new w.CrossSection(t.contours, 'NonZero')).translate(sp.c));
  } else cs = s.t(new w.CrossSection([ccw(holeOutline(f, sp.c, sp.tear, sp.end))], 'Positive'));
  if (cs.isEmpty()) return null;
  const { a, e, n } = sp.face;
  const m = s.t(s.t(w.Manifold.extrude(cs, sp.depth + 1)).translate([0, 0, -sp.depth]));
  return s.t(m.transform([1, 0, 0, 0, 0, e[1], e[0], 0, 0, n[1], n[0], 0, 0, a[1], a[0], 1]));
}

/**
 * The back plate, the profile across the width, the add-ons (custom/part.ts) and the features cut in: all of it
 * in the part's frame, its back on the board.
 */
export const customBuilder: AttachmentBuilder<CustomOptions> = {
  body(w, s, o, layout, ctx) {
    const W = layout.w;
    const H = layout.h;
    const p = o.profile;
    const parts: Manifold[] = [s.t(boxAt(w, 0, 0, 0, W, H, CUSTOM.plate)), acrossX(w, s, section(w, s, [p]), 0, W)];
    const add = customAddOns(o, H);
    const ribs = customRibs(o, W);
    if (add.lip) parts.push(acrossX(w, s, section(w, s, [add.lip]), 0, W));
    if (add.gusset) {
      const g = section(w, s, [add.gusset]);
      for (const [x0, x1] of ribs.gussets) parts.push(acrossX(w, s, g, x0, x1 - x0));
    }
    if (ribs.ends.length || ribs.dividers.length) {
      // Its hull with the plate, down to its underside; dividers only up to the front's top.
      const under = section(w, s, [underside(p)]);
      const wall = s.t(section(w, s, [endHull([...p, ...(add.lip ?? [])], H)]).subtract(under));
      for (const [x0, x1] of ribs.ends) parts.push(acrossX(w, s, wall, x0, x1 - x0));
      const zf = reachOf(p);
      const low: Vec2[] = [
        [-1, -1],
        [zf + 1, -1],
        [zf + 1, add.rim],
        [-1, add.rim],
      ];
      const pocket = s.t(wall.intersect(section(w, s, [low])));
      if (!pocket.isEmpty()) for (const [x0, x1] of ribs.dividers) parts.push(acrossX(w, s, pocket, x0, x1 - x0));
    }
    const body = s.t(w.Manifold.union(parts));
    const cuts = featureSpots(o, layout, ctx)
      .filter((sp) => sp.ok)
      .map((sp) => cut(w, s, sp))
      .filter((m): m is Manifold => !!m);
    return cuts.length ? s.t(body.subtract(s.t(w.Manifold.union(cuts)))) : body;
  },
};
