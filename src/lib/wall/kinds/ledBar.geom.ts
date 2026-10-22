import type { CrossSection } from 'manifold-3d';
import { Scope, assertValid, toMeshData, type Manifold, type Vec2, type Wasm } from '../../geometry/kernel';
import { ccw } from '../mount';
import type { AttachmentBuilder } from '../build';
import { LED, ledFrame, type LedBarOptions } from './ledBar';

// The lighting and cable kinds build from side views (wall z out, y up) extruded along the board.

/** A rectangle in a side view. */
export const rectZY = (z0: number, y0: number, z1: number, y1: number): Vec2[] => [
  [z0, y0],
  [z1, y0],
  [z1, y1],
  [z0, y1],
];

/** A side view in wall (z, y) as a cross-section (wall z → the cross-section's -x, as prismX takes it). */
export function sideSection(w: Wasm, s: Scope, polys: Vec2[][]): CrossSection {
  return s.t(
    new w.CrossSection(
      polys.map((q) => ccw(q.map(([z, y]) => [-z, y] as Vec2))),
      'Positive',
    ),
  );
}

/** A cross-section from sideSection extruded across x, from x0. */
export function extrudeX(w: Wasm, s: Scope, cs: CrossSection, x0: number, width: number): Manifold {
  const e = s.t(w.Manifold.extrude(cs, width));
  return s.t(s.t(e.rotate([0, 90, 0])).translate([x0, 0, 0]));
}

/** A part built in the wall frame, turned about x into its print pose, min corner at the origin. */
export function turnedX(s: Scope, m: Manifold, degrees: number, what: string) {
  const p = s.t(m.rotate([degrees, 0, 0]));
  const b = p.boundingBox();
  const out = s.t(p.translate([-b.min[0], -b.min[1], -b.min[2]]));
  assertValid(out, what);
  return toMeshData(out);
}

export const ledBarBuilder: AttachmentBuilder<LedBarOptions> = {
  body(w, s, o, _l, ctx) {
    const { D, c, T, lip, gw, gd, top, cap } = LED;
    const f = ledFrame(o, ctx);
    const p = f.p;
    const L = o.length;
    const Mlo = p(0, D);
    // Side view: the back, the foot under the low wall, the floor up to the top face, the top.
    let side = sideSection(w, s, [[[0, 0], [Mlo[0], 0], Mlo, p(0, 0), p(f.s, 0), p(f.s, -top), [0, f.H]]]);
    if (o.diffuser) {
      // Grooves for the diffuser's hooks: in the low wall behind its lip, and in the top behind the top edge.
      const quad = (u0: number, v0: number, u1: number, v1: number): Vec2[] => [p(u0, v0), p(u1, v0), p(u1, v1), p(u0, v1)];
      side = s.t(side.subtract(sideSection(w, s, [quad(-gd, D - lip - gw, 0.5, D - lip), quad(f.s - gd, -lip - gw, f.s + 0.5, -lip)])));
    }
    const parts = [extrudeX(w, s, side, 0, L)];
    const holes: Manifold[] = [];
    if (o.caps) {
      // Each cap: the side view filled out to the diffuser's face and over its top.
      const Po = p(c, D + c + T);
      const Pt = p(f.s + c + T, D + c + T);
      const Pr = p(f.s + c + T, -top);
      const capSide = sideSection(w, s, [[[0, 0], [Po[0], 0], Po, Pt, Pr, [0, Pr[1]]]]);
      // The wire's hole: a square on its corner (45° faces print without support), on the strip.
      const [hz, hy] = p((o.strip + 1) / 2, 2);
      const hole = sideSection(w, s, [
        [
          [hz - 2.5, hy],
          [hz, hy - 2.5],
          [hz + 2.5, hy],
          [hz, hy + 2.5],
        ],
      ]);
      for (const right of [false, true]) {
        const x0 = right ? L - cap : 0;
        parts.push(extrudeX(w, s, capSide, x0, cap));
        if (o.wire === 'both' || (o.wire === 'right') === right) holes.push(extrudeX(w, s, hole, x0 - 1, cap + 2));
      }
    }
    const body = s.t(w.Manifold.union(parts));
    return holes.length ? s.t(body.subtract(s.t(w.Manifold.union(holes)))) : body;
  },
  part(w, spec: { pts: Vec2[][]; len: number; angle: number }) {
    const s = new Scope();
    try {
      // Built where it sits in front of the strip, then laid on its face.
      const m = extrudeX(w, s, sideSection(w, s, spec.pts), 0, spec.len);
      return turnedX(s, m, 180 - spec.angle, 'LED bar diffuser');
    } finally {
      s.dispose();
    }
  },
};
