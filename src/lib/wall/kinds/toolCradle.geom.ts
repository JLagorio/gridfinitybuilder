import type { Manifold } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import type { AttachmentBuilder } from '../build';
import { TOOL_CRADLE, cradlePlan, type ToolCradleOptions } from './toolCradle';

const SEGS = 32;

export const toolCradleBuilder: AttachmentBuilder<ToolCradleOptions> = {
  body(w, s, o, layout, ctx) {
    const k = cradlePlan(o, ctx);
    const T = TOOL_CRADLE;
    // The tray in its own frame (x across, v up the face from its foot, w out of it): a slab k.s thick behind the
    // face, from below the bed to past the back plate (both trimmed off below), the pocket and notches cut in square.
    const tool = s.t(new w.CrossSection([k.pts], 'NonZero'));
    // The tool grown by its clearance, gaps narrower than 2 mm between its parts closed (a wall that thin
    // doesn't print), and the finger notches.
    const G = T.close / 2;
    const room = s.t(s.t(tool.offset(k.tool.clearance + G, 'Round', 2, SEGS)).offset(-G, 'Round', 2, SEGS));
    const holes = s.t(w.CrossSection.union([room, ...k.notches.map(([x, v]) => s.t(s.t(w.CrossSection.circle(T.notch, SEGS)).translate([x, v])))]));
    // Cut square to the face, its edge chamfered at 45° (in 0.25 mm steps): the tool drops in, and no edge is a knife.
    const deep = (cs: typeof holes, d: number) => s.t(s.t(cs.extrude(d + 1)).translate([0, 0, -d]));
    const cuts = [deep(holes, k.p)];
    const n = Math.round(T.chamfer / 0.25);
    for (let i = 1; i < n; i++) cuts.push(deep(s.t(holes.offset((i * T.chamfer) / n, 'Round', 2, SEGS)), T.chamfer - (i * T.chamfer) / n));
    const slab = s.t(s.t(boxAt(w, 0, -k.s, -k.s, k.w, Math.SQRT2 * k.d + k.s, 0)).subtract(s.t(w.Manifold.union(cuts))));
    // Stood at 45°: (x, v, w) → (x, (v + w)/√2, d + (w − v)/√2), its face looking up and out, its foot at z = d.
    const tray = s.t(s.t(slab.rotate([-45, 0, 0])).translate([0, 0, k.d]));
    const back = s.t(boxAt(w, 0, 0, 0, layout.w, layout.h, T.back));
    const all: Manifold = s.t(w.Manifold.union([back, tray]));
    // Trimmed flat on the bed, flush with the back plate's back and top (nothing reaches past its sides or front).
    return s.t(all.intersect(s.t(boxAt(w, -1, 0, 0, layout.w + 1, layout.h, layout.depth + 1))));
  },
};
