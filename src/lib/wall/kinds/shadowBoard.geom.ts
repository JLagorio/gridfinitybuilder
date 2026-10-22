import type { CrossSection } from 'manifold-3d';
import type { Manifold, Scope, Vec2, Wasm } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { hasFont, textOutline, textSolid } from '../../geometry/text';
import { splitInlay, type InlayTag } from '../../geometry/inlay';
import type { AttachmentBuilder } from '../build';
import { teardrop } from './plate.geom';
import { MAGNETS, SHADOW, shadowPlan, type ShadowBoardOptions, type ShadowItem } from './shadowBoard';

/**
 * A prism of a front-view shape from z0 to z1 whose faces looking down slope back at 45° from the plate's front at
 * `zf`: at z its section is where the shape is and stays straight down for |z − zf| (cut into the plate, z < zf, a
 * recess's top drops as it goes in; standing out of it, a peg's underside rises as it goes out). It prints upright
 * without support, and on the front itself the shape is exact. The shape moved |z − zf| up checks the far end of that
 * run, and `steps` − 1 more shears check along it, every 1/steps of the way (a gap in the shape shorter than that
 * can slip through: keep them short, or the shape free of them).
 */
export function slope45(s: Scope, cs: CrossSection, z0: number, z1: number, zf: number, steps = 1): Manifold {
  const p = s.t(s.t(cs.extrude(z1 - z0)).translate([0, 0, z0]));
  let out = p;
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    // y + f (z − zf), column-major.
    out = s.t(out.intersect(s.t(p.transform([1, 0, 0, 0, 0, 1, 0, 0, 0, f, 1, 0, 0, -f * zf, 0, 1]))));
  }
  return out;
}

/** A front-view shape less its slivers under 1 mm across (they don't print). */
const opened = (s: Scope, cs: CrossSection) => s.t(s.t(cs.offset(-0.5, 'Round', 2, SEGS)).offset(0.5, 'Round', 2, SEGS));

/**
 * A front-view shape swept straight up (`by` > 0) or down: itself, itself moved, and what each edge sweeps between
 * (anything the sweep covers is in one of them), filled as one.
 */
function swept(w: Wasm, s: Scope, cs: CrossSection, by: number): CrossSection {
  const all: Vec2[][] = [];
  for (const p of cs.toPolygons()) {
    all.push(
      p,
      p.map(([x, y]) => [x, y + by] as Vec2),
    );
    p.forEach((a, i) => {
      const b = p[(i + 1) % p.length];
      if (Math.abs(b[0] - a[0]) < 1e-9) return;
      const q: Vec2[] = [a, b, [b[0], b[1] + by], [a[0], a[1] + by]];
      // Counter-clockwise, so it fills.
      all.push((b[0] - a[0]) * by > 0 ? q : q.reverse());
    });
  }
  return s.t(new w.CrossSection(all, 'Positive'));
}

const SEGS = 32;
const shape = (w: Wasm, s: Scope, pts: Vec2[]) => s.t(new w.CrossSection([pts], 'NonZero'));
const circle = (w: Wasm, s: Scope, [x, y]: Vec2, r: number) => s.t(s.t(w.CrossSection.circle(r, SEGS)).translate([x, y]));
const rect = (w: Wasm, s: Scope, x0: number, y0: number, x1: number, y1: number) => s.t(s.t(w.CrossSection.square([x1 - x0, y1 - y0])).translate([x0, y0]));

/** A tool's shadow: its outline grown by its clearance, gaps between its parts narrower than SHADOW.close filled (a sliver of plate that thin doesn't print). */
const shadowOf = (w: Wasm, s: Scope, it: ShadowItem) => {
  const g = SHADOW.close / 2;
  return s.t(s.t(shape(w, s, it.pts).offset(it.tool.clearance + g, 'Round', 2, SEGS)).offset(-g, 'Round', 2, SEGS));
};

/** What's cut for a tool's shadow, from its floor out to z1, its top sloped back at 45° (checked every millimetre in). */
const shadowCut = (w: Wasm, s: Scope, o: ShadowBoardOptions, it: ShadowItem, t: number, z1: number) =>
  slope45(s, shadowOf(w, s, it), t - o.pocket, z1, t, Math.ceil(o.pocket));

/** What's cut for a tool besides its shadow: finger notches a little deeper, pockets for magnets under it, its name. */
function extraCuts(w: Wasm, s: Scope, o: ShadowBoardOptions, it: ShadowItem, t: number): Manifold[] {
  const out: Manifold[] = [];
  const N = SHADOW.notch;
  for (const n of it.notches) out.push(slope45(s, circle(w, s, n, N.r), t - o.pocket - N.deeper, t + 1, t));
  const [md, mt] = MAGNETS[o.magnet];
  const M = SHADOW.magnet;
  // Round pockets with a 45° point on top (a roof that prints), in from the shadow's floor.
  for (const [x, y] of it.magnets) {
    const tear = s.t(new w.CrossSection([teardrop(x, y, (md + M.fit) / 2)], 'Positive'));
    out.push(s.t(s.t(tear.extrude(mt + M.deeper + 0.01)).translate([0, 0, t - o.pocket - mt - M.deeper])));
  }
  if (it.name && hasFont()) {
    const text = textOutline(it.tool.name.trim(), { size: SHADOW.name.size, maxWidth: it.name.w });
    const m = textSolid(w, text, it.name.x, it.name.y, t - 0.6, 1.6);
    if (m) out.push(s.t(m));
  }
  return out;
}

/** What holds a tool: gusseted pegs with a lip, or a ledge's cup round its bottom with a lip over its front edge. */
function holders(w: Wasm, s: Scope, it: ShadowItem, t: number): Manifold[] {
  const out: Manifold[] = [];
  const P = SHADOW.peg;
  const L = SHADOW.lip;
  const front = t + it.reach;
  for (const g of it.pegs) {
    // A gusset under its top, so a section of it rises at 45° from the plate to a tip P.tip tall; the lip on its end.
    const fin = rect(w, s, g.x - P.w / 2, g.y - it.reach - P.tip, g.x + P.w / 2, g.y);
    out.push(slope45(s, fin, t - 0.5, front, t));
    out.push(s.t(boxAt(w, g.x - P.w / 2, g.y - 1, front - L, g.x + P.w / 2, g.y + P.rise, front)));
  }
  if (it.cup !== null) {
    const E = SHADOW.ledge;
    const c = it.tool.clearance;
    const tool = shape(w, s, it.pts);
    const room = shadowOf(w, s, it);
    const outer = s.t(tool.offset(c + E.wall, 'Round', 2, SEGS));
    const inner = s.t(tool.offset(-E.over, 'Round', 2, SEGS));
    const b = outer.bounds();
    const below = rect(w, s, b.min[0] - 1, b.min[1] - it.reach - 1, b.max[0] + 1, it.cup);
    // The tool's bottom and a wall round it, swept down as far as the ledge reaches, less the tool's room and
    // anything over it (in a crotch, or beside a narrow part above a wider one: it would hang over the room as it
    // prints). Sloped at 45°: a cup on a gusset.
    const cup = opened(s, s.t(s.t(swept(w, s, s.t(outer.intersect(below)), -it.reach)).subtract(swept(w, s, room, it.reach + 1))));
    out.push(slope45(s, cup, t - 0.5, front, t));
    // The lip over the tool's front edge (it drops in behind it, from above), but not over an edge that faces up:
    // there it would hang over the tool's room too.
    const lip = opened(s, s.t(s.t(s.t(outer.subtract(inner)).intersect(below)).subtract(swept(w, s, inner, E.over + c + E.wall + 0.5))));
    out.push(s.t(s.t(lip.extrude(L)).translate([0, 0, front - L])));
  }
  return out;
}

/** Two-colour shadows: the bins' tool shadows' colour role, in filament 2 with multi-colour off. */
const SHADOWS: InlayTag = { name: 'Tool shadows', role: 'shadow', filament: 2 };

export const shadowBoardBuilder: AttachmentBuilder<ShadowBoardOptions> = {
  body(w, s, o, layout, ctx) {
    const p = shadowPlan(o, ctx);
    const t = p.t;
    const cuts: Manifold[] = [];
    const adds: Manifold[] = [];
    const shadows: Manifold[] = [];
    for (const it of p.items) {
      shadows.push(shadowCut(w, s, o, it, t, t + 1));
      cuts.push(...extraCuts(w, s, o, it, t));
      adds.push(...holders(w, s, it, t));
    }
    let m = s.t(boxAt(w, 0, 0, 0, layout.w, layout.h, t));
    if (cuts.length) m = s.t(m.subtract(s.t(w.Manifold.union(cuts))));
    if (adds.length) m = s.t(w.Manifold.union([m, ...adds]));
    if (!shadows.length) return m;
    // The shadows (less the notches and magnet pockets already cut) come out, or, in two colours, come off as an
    // inlay flush with the front: split, so the two share their faces exactly.
    const region = s.t(w.Manifold.union(shadows));
    if (!o.fill) return s.t(m.subtract(region));
    const { body, fill } = splitInlay(s, m, region);
    return { body, inlays: fill ? [{ ...SHADOWS, m: fill }] : [] };
  },
};
