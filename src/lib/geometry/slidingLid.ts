/**
 * Sliding lid (planning in accessories.ts), for bins without a stacking lip.
 *
 * The bin: the outer wall is only 0.95 mm, so a band SLIDE.band thick is added
 * all around its inside from just under the lid up to the top (45° underside).
 * Grooves are cut into the band on the left, right and back: flat floor, 45°
 * ceiling, SLIDE.groove deep, with SLIDE.keeper of wall left above. The front
 * wall and the front of the band are cut down to the groove floor between the
 * band's faces, leaving a sill the lid slides over; a small bump on the sill
 * keeps the lid shut.
 *
 * The lid: a plate whose left, right and back edges are chamfered 45° on top
 * to match the groove ceiling. Underneath, a pocket at the front holds the
 * bump when the lid is closed, a tooth behind it is what the bump clicks over,
 * and a channel from there to the back edge lets the bump pass freely while
 * the lid slides. Grip ridges across the top near the front edge, and optional
 * engraved text. Its front corners follow the bin's outline. It prints flat,
 * the way it sits; min corner at the origin.
 *
 * Must not import bin.ts at runtime.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec3, type Wasm } from './kernel';
import { WALL } from './spec';
import { boxAt, ringAt, roundedRectRing } from './shapes';
import { fitText, LABEL_TEXT } from './labels';
import { textSolid } from './text';
import { SLIDE, slideLidBox, wallShelf, type SlideLidPart, type SlidePlan } from './accessories';

/** Detent bump on the front sill (bin-centered): middle and length along X, middle along Y. */
export function slideBump(W: number, D: number) {
  const face = WALL + SLIDE.band;
  const hx = W / 2 - face;
  return { y: -D / 2 + face / 2, length: Math.min(SLIDE.bumpLength, 2 * hx * 0.35) };
}

/** Hull of a groove profile (u outward from the band face, z) swept along a wall. */
function groove(w: Wasm, s: Scope, zG: number, map: (u: number, t: number) => [number, number], t0: number, t1: number): Manifold {
  const S = SLIDE;
  const zc = zG + S.thickness + S.play;
  const prof: [number, number][] = [
    [-0.5, zG],
    [S.groove, zG],
    [S.groove, zc - S.groove],
    [0, zc],
    [-0.5, zc],
  ];
  const pts: Vec3[] = [];
  for (const t of [t0, t1]) for (const [u, z] of prof) pts.push([...map(u, t), z]);
  return s.t(w.Manifold.hull(pts));
}

/** Band, grooves, front cut and bump for a bin (bin-centered). `add` is unioned on, `cut` taken out after. */
export function slideLidBinParts(
  w: Wasm,
  s: Scope,
  plan: SlidePlan,
  W: number,
  D: number,
  H: number,
  zFloor: number,
): { add: Manifold[]; cut: Manifold[] } {
  const S = SLIDE;
  const { zG, bandFace } = plan;
  const hx = W / 2 - bandFace;
  const hy = D / 2 - bandFace;
  const band = wallShelf(w, s, W, D, zG - S.under, H, bandFace, zFloor - 0.5);
  const grooves = [
    groove(w, s, zG, (u, t) => [-(hx + u), t], -D / 2 - 1, hy + S.groove),
    groove(w, s, zG, (u, t) => [hx + u, t], -D / 2 - 1, hy + S.groove),
    groove(w, s, zG, (u, t) => [t, hy + u], -(hx + S.groove), hx + S.groove),
  ];
  // Front: open from the groove floor up between the band faces, except the bump.
  const b = slideBump(W, D);
  const pts: Vec3[] = [];
  for (const x of [-b.length / 2, b.length / 2]) {
    pts.push([x, b.y - S.bumpRun, zG - 0.01], [x, b.y + S.bumpRun, zG - 0.01]);
    const xt = x - Math.sign(x) * S.bump;
    pts.push([xt, b.y - 0.1, zG + S.bump], [xt, b.y + 0.1, zG + S.bump]);
  }
  const bump = s.t(w.Manifold.hull(pts));
  const front = s.t(s.t(boxAt(w, -hx, -D / 2 - 1, zG, hx, -D / 2 + bandFace + 0.3, H + 1)).subtract(bump));
  return { add: [band], cut: [...grooves, front] };
}

/** Build a sliding lid with its min corner at the origin and its bottom at z = 0. */
export function buildSlideLid(w: Wasm, p: SlideLidPart): MeshData {
  const S = SLIDE;
  const s = new Scope();
  try {
    const b = slideLidBox(p.W, p.D);
    const c = b.chamfer;
    const T = S.thickness;
    const rF = S.frontRadius;
    const rB = S.backRadius;
    const full = roundedRectRing(b.x0, b.y0, b.x1, b.y1, [rF, rF, rB, rB]);
    const topRing = roundedRectRing(b.x0 + c, b.y0, b.x1 - c, b.y1 - c, [Math.max(rB, rF - c), Math.max(rB, rF - c), rB, rB]);
    let lid = s.t(w.Manifold.hull([...ringAt(full, 0), ...ringAt(full, T - c), ...ringAt(topRing, T)]));

    // Underside: pocket for the bump (open to the front edge), tooth, channel to the back edge.
    const bump = slideBump(p.W, p.D);
    const hw = bump.length / 2 + 0.6;
    const depth = S.bump + 0.2;
    const pocketEnd = bump.y + S.bumpRun + S.bumpPlay;
    const channelStart = pocketEnd + S.tooth;
    const under = [
      s.t(boxAt(w, -hw, b.y0 - 1, -1, hw, pocketEnd, depth)),
      s.t(boxAt(w, -hw, channelStart, -1, hw, b.y1 + 1, depth)),
    ];
    lid = s.t(lid.subtract(s.t(w.Manifold.union(under))));

    // Grip ridges across the top near the front edge.
    const len = Math.min(30, (b.x1 - b.x0) * 0.5);
    const ridges: Manifold[] = [];
    const y0 = b.y0 + 3;
    for (let i = 0; i < S.ridges; i++) {
      const y = y0 + i * S.ridgePitch;
      const pts: Vec3[] = [];
      for (const x of [-len / 2, len / 2]) {
        pts.push([x, y - 0.6, T - 0.02], [x, y + 0.6, T - 0.02], [x, y - 0.25, T + S.ridgeHeight], [x, y + 0.25, T + S.ridgeHeight]);
      }
      ridges.push(s.t(w.Manifold.hull(pts)));
    }
    lid = s.t(w.Manifold.union([lid, ...ridges]));

    // Engraved text behind the ridges.
    const box = { x0: b.x0 + c + 2, x1: b.x1 - c - 2, y0: y0 + (S.ridges - 1) * S.ridgePitch + 3, y1: b.y1 - c - 2 };
    const fit = p.text.trim() ? fitText(p.text, box, Math.min(LABEL_TEXT.maxCap, 0.6 * (box.y1 - box.y0))) : null;
    if (fit) {
      const cut = textSolid(w, fit.outline, fit.cx, fit.cy, T - S.textDepth, S.textDepth + 1);
      if (cut) lid = s.t(lid.subtract(s.t(cut)));
    }

    const out = s.t(lid.translate([-b.x0, -b.y0, 0]));
    assertValid(out, 'sliding lid');
    return toMeshData(out);
  } finally {
    s.dispose();
  }
}
