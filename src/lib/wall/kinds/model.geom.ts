import type { Manifold, Scope, Wasm } from '../../geometry/kernel';
import { importedMesh } from '../../imported/registry';
import type { AttachmentBuilder } from '../build';
import { backRays, orientModel } from '../modelMesh';
import { MODEL, modelPlan, type ModelOptions, type ModelPlan } from './model';

/** How far the plate's fill reaches into the model, so the two are one, mm. */
const OVERLAP = 0.4;

/**
 * A plate `w` × `h` on the board, MODEL.plate thick, that fills in up to the model's back where the model is
 * behind it (`model`: turned to hang, its box's min corner at the origin; it sits `p.x` across and MODEL.plate
 * out; none: the box that stands in for it): a height field over a grid of points about 1.5 mm apart, each as
 * far out as its ray from the board meets the model, and no more than one step further out than the point below
 * it, so its underside rises at 45° at the steepest and prints without support. Its back, sides and bottom edge
 * are flat.
 */
function backFill(w: Wasm, s: Scope, p: ModelPlan, model: { positions: Float32Array; indices: Uint32Array } | null): Manifold {
  const T = MODEL.plate;
  const step = Math.max(1.5, Math.max(p.w, p.h) / 100);
  const nx = Math.max(1, Math.ceil(p.w / step));
  const ny = Math.max(1, Math.ceil(p.h / step));
  const xs = Array.from({ length: nx + 1 }, (_, i) => (p.w * i) / nx);
  const ys = Array.from({ length: ny + 1 }, (_, j) => (p.h * j) / ny);
  const N = nx + 1;
  const hz = new Float64Array(N * (ny + 1)).fill(T);
  if (model) {
    // Rays a hair off the grid lines, so they miss the edges of a model drawn on round numbers.
    const r = backRays(
      model,
      xs.map((x) => x - p.x + 1.3e-4),
      ys.map((y) => y + 0.7e-4),
    );
    for (let k = 0; k < hz.length; k++) if (r.hit[k] < Infinity) hz[k] = T + Math.min(p.md, r.hit[k] + OVERLAP);
  } else {
    // The box that stands in is flat behind: the plate meets it all over.
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) if (xs[i] >= p.x - 1e-6 && xs[i] <= p.x + p.mw + 1e-6 && ys[j] <= p.mh + 1e-6) hz[j * N + i] = T + OVERLAP;
  }
  // Up the board (the print's up), at most a step further out than the point below.
  const dy = p.h / ny;
  for (let j = 1; j <= ny; j++) for (let i = 0; i <= nx; i++) hz[j * N + i] = Math.max(T, Math.min(hz[j * N + i], hz[(j - 1) * N + i] + dy));

  // The surface, the back (a fan from its middle) and the four sides.
  const top = N * (ny + 1);
  const pos = new Float32Array((2 * top + 1) * 3);
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const k = j * N + i;
      pos.set([xs[i], ys[j], hz[k]], k * 3);
      pos.set([xs[i], ys[j], 0], (top + k) * 3);
    }
  const mid = 2 * top;
  pos.set([p.w / 2, p.h / 2, 0], mid * 3);
  const tri: number[] = [];
  const v = (i: number, j: number) => j * N + i;
  const b = (i: number, j: number) => top + j * N + i;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) tri.push(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i, j + 1));
  // The back's rim, anticlockwise as seen from the front (the fan runs the other way: it faces the board).
  const rim: number[] = [];
  for (let i = 0; i < nx; i++) rim.push(b(i, 0));
  for (let j = 0; j < ny; j++) rim.push(b(nx, j));
  for (let i = nx; i > 0; i--) rim.push(b(i, ny));
  for (let j = ny; j > 0; j--) rim.push(b(0, j));
  for (let k = 0; k < rim.length; k++) tri.push(mid, rim[(k + 1) % rim.length], rim[k]);
  for (let i = 0; i < nx; i++) {
    tri.push(b(i, 0), b(i + 1, 0), v(i + 1, 0), b(i, 0), v(i + 1, 0), v(i, 0));
    tri.push(b(i, ny), v(i + 1, ny), b(i + 1, ny), b(i, ny), v(i, ny), v(i + 1, ny));
  }
  for (let j = 0; j < ny; j++) {
    tri.push(b(0, j), v(0, j + 1), b(0, j + 1), b(0, j), v(0, j), v(0, j + 1));
    tri.push(b(nx, j), b(nx, j + 1), v(nx, j + 1), b(nx, j), v(nx, j + 1), v(nx, j));
  }
  return s.t(w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: pos, triVerts: new Uint32Array(tri) })));
}

/**
 * Your own model (kinds/model.ts): its mesh (from the imported meshes the worker has, imported/registry.ts) turned
 * to hang and scaled, its back on the board, with the clips fused on; or on a plate that fills in behind it. A box
 * of its size stands in while it has no mesh.
 */
export const modelBuilder: AttachmentBuilder<ModelOptions> = {
  body(w, s, o, _layout, ctx) {
    const p = modelPlan(o, ctx);
    const ref = o.mesh;
    let model: Manifold;
    let oriented: { positions: Float32Array; indices: Uint32Array } | null = null;
    if (ref?.hash) {
      const m = importedMesh(ref.hash);
      if (!m) throw new Error(`The mesh of “${ref.file}” isn’t in this browser. Open the project file it was saved in, or choose the file again.`);
      oriented = { positions: orientModel(m.positions, p.face, +o.turn, o.scale / 100).positions, indices: m.indices };
      try {
        model = s.t(w.Manifold.ofMesh(new w.Mesh({ numProp: 3, vertProperties: oriented.positions, triVerts: oriented.indices })));
      } catch {
        throw new Error(`“${ref.file}” isn’t a closed solid, so clips can’t be fused to it. Repair it (most slicers can) and choose it again.`);
      }
    } else model = s.t(w.Manifold.cube([p.mw, p.mh, p.md]));
    if (p.mode === 'clips') return model;
    return s.t(w.Manifold.union([backFill(w, s, p, oriented), s.t(model.translate([p.x, 0, p.z]))]));
  },
};
