/**
 * Egg-crate grid inserts (planning in cups.ts): a one-piece lattice of
 * divX × divY cells with a rim all around, no floor, fitted to its
 * compartment like a cup. It prints as it sits, open both ends: every wall is
 * vertical except the rim's 45° foot where the compartment's bottom is
 * rounded, so there is nothing to support. One piece is always within the bed,
 * since it is smaller than the bin it drops into.
 *
 * Must not import bin.ts at runtime.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Wasm } from './kernel';
import { boxAt } from './shapes';
import { fittedSolid, tabCutter, type CratePart } from './cups';

/** Build a grid insert, min corner at the origin, bottom at z = 0. */
export function buildCrate(w: Wasm, p: CratePart): MeshData {
  const s = new Scope();
  try {
    const t = p.wall;
    const outer = fittedSolid(w, s, p, 0, 0, p.h);
    const inner = fittedSolid(w, s, p, t, -1, p.h + 1);
    const walls: Manifold[] = [];
    const cw = (p.w - 2 * t - (p.divX - 1) * t) / p.divX;
    const cd = (p.d - 2 * t - (p.divY - 1) * t) / p.divY;
    for (let i = 1; i < p.divX; i++) {
      const x = t + i * cw + (i - 1) * t;
      walls.push(s.t(boxAt(w, x, -1, -2, x + t, p.d + 1, p.h + 2)));
    }
    for (let j = 1; j < p.divY; j++) {
      const y = t + j * cd + (j - 1) * t;
      walls.push(s.t(boxAt(w, -1, y, -2, p.w + 1, y + t, p.h + 2)));
    }
    const cells = walls.length ? s.t(inner.subtract(s.t(w.Manifold.union(walls)))) : inner;
    let crate = s.t(outer.subtract(cells));
    const cut = tabCutter(w, s, p, p.h + 1);
    if (cut) crate = s.t(crate.subtract(cut));
    assertValid(crate, 'grid insert');
    return toMeshData(crate);
  } finally {
    s.dispose();
  }
}
