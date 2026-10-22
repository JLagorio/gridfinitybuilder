/**
 * An imported model turned to hang (kinds/model.ts), and looked at from behind: rays from the board (z = 0) out
 * into it find where its back is and how solid it is there. At import that maps each face's flat, solid cells,
 * where clips can go (flatMasks); in the geometry worker it finds how far the back plate must fill in to meet the
 * model (kinds/model.geom.ts). Pure: no WASM, no DOM; loaded with the model field and with the mesh builders.
 */
import type { RawMesh } from '../imported/meshOps';
import { FACE_AXES, MODEL, MODEL_FACES, encodeMask, type ModelFace } from './kinds/model';

/**
 * The mesh's positions turned so `face` is on the board (its back at z = 0, the model out to +z), turned `turn`
 * degrees anticlockwise (as seen from the front) about the board's normal and scaled, its box's min corner at the
 * origin; and that box's size. A proper rotation: the triangles still face out.
 */
export function orientModel(positions: ArrayLike<number>, face: ModelFace, turn = 0, scale = 1): { positions: Float32Array; size: [number, number, number] } {
  const ax = FACE_AXES[face];
  const q = (((Math.round(turn / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  const out = new Float32Array(positions.length);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const a = positions[i + ax[0][0]] * ax[0][1] * scale;
    const b = positions[i + ax[1][0]] * ax[1][1] * scale;
    const c = positions[i + ax[2][0]] * ax[2][1] * scale;
    // (x, y) turned a quarter at a time: (−y, x).
    const v = q === 0 ? [a, b, c] : q === 1 ? [-b, a, c] : q === 2 ? [-a, -b, c] : [b, -a, c];
    for (let k = 0; k < 3; k++) {
      out[i + k] = v[k];
      if (v[k] < min[k]) min[k] = v[k];
      if (v[k] > max[k]) max[k] = v[k];
    }
  }
  if (!positions.length) return { positions: out, size: [0, 0, 0] };
  for (let i = 0; i < out.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] -= min[k];
  return { positions: out, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** The first index whose value is at least `v` (`a` ascending). */
function lowerBound(a: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Rays along +z from z = 0 at each point (xs[i], ys[j]) (both ascending): how far each goes before it enters the
 * mesh (`hit`, Infinity: it never does) and how far it then stays inside (`thick`, the solid's thickness there; 0
 * when the mesh doesn't close round it). Index j × xs.length + i. Each triangle is rasterized onto the points it
 * covers; a point on an edge or a corner several triangles share counts once.
 */
export function backRays(m: RawMesh, xs: ArrayLike<number>, ys: ArrayLike<number>): { hit: Float32Array; thick: Float32Array } {
  const nx = xs.length;
  const n = nx * ys.length;
  // Each point's crossings: z, then +1 leaving (the face looks out from the board) or −1 entering.
  const crossings: (number[] | undefined)[] = new Array(n);
  const p = m.positions;
  const t = m.indices;
  const E = 1e-9;
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f] * 3;
    const b = t[f + 1] * 3;
    const c = t[f + 2] * 3;
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]];
    const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    // Edge-on to the rays.
    if (Math.abs(d) < 1e-12) continue;
    const i0 = lowerBound(xs, Math.min(ax, bx, cx) - 1e-7);
    const i1 = lowerBound(xs, Math.max(ax, bx, cx) + 1e-7);
    const j0 = lowerBound(ys, Math.min(ay, by, cy) - 1e-7);
    const j1 = lowerBound(ys, Math.max(ay, by, cy) + 1e-7);
    for (let j = j0; j < j1; j++) {
      const py = ys[j];
      for (let i = i0; i < i1; i++) {
        const px = xs[i];
        const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / d;
        const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / d;
        const w2 = 1 - w0 - w1;
        if (w0 < -E || w1 < -E || w2 < -E) continue;
        (crossings[j * nx + i] ??= []).push(w0 * az + w1 * bz + w2 * cz, d > 0 ? 1 : -1);
      }
    }
  }
  const hit = new Float32Array(n).fill(Infinity);
  const thick = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const cs = crossings[k];
    if (!cs) continue;
    const order = Array.from({ length: cs.length / 2 }, (_, q) => q).sort((u, v) => cs[2 * u] - cs[2 * v] || cs[2 * u + 1] - cs[2 * v + 1]);
    let inside = 0;
    let first = Infinity;
    let lastZ = -Infinity;
    let lastS = 0;
    for (const q of order) {
      const z = cs[2 * q];
      const s = cs[2 * q + 1];
      // The same crossing again (triangles sharing the edge or corner it's on).
      if (s === lastS && z - lastZ < 1e-4) continue;
      lastZ = z;
      lastS = s;
      if (first === Infinity) first = z;
      inside -= s;
      if (inside <= 0) {
        thick[k] = z - first;
        break;
      }
    }
    hit[k] = first;
  }
  return { hit, thick };
}

/**
 * Where each face of the model (welded and centred, imported/parse.ts) is flat and solid enough for a clip:
 * looked at from that face, a grid of up to MODEL.cells square-ish cells (2 mm at the least) over its box, each
 * flat when all of the 3 × 3 rays across it meet the model within MODEL.flat of the board and stay inside it for
 * MODEL.solid or more. Encoded for the options (kinds/model.ts encodeMask).
 */
export function flatMasks(m: RawMesh): Record<ModelFace, string> {
  const out = {} as Record<ModelFace, string>;
  const S = 3;
  for (const face of MODEL_FACES) {
    const o = orientModel(m.positions, face);
    const [W, H] = o.size;
    const cell = Math.max(2, Math.max(W, H) / MODEL.cells);
    const nu = Math.max(1, Math.min(MODEL.cells, Math.round(W / cell)));
    const nv = Math.max(1, Math.min(MODEL.cells, Math.round(H / cell)));
    // Off the cells' exact fractions a little, so rays miss the edges of a model drawn on round numbers.
    const xs = Array.from({ length: nu * S }, (_, k) => ((k + 0.5) / (nu * S)) * W + 1.3e-4);
    const ys = Array.from({ length: nv * S }, (_, k) => ((k + 0.5) / (nv * S)) * H + 0.7e-4);
    const r = backRays({ positions: o.positions, indices: m.indices }, xs, ys);
    const bits = new Uint8Array(nu * nv);
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        let ok = 1;
        for (let b = 0; b < S && ok; b++)
          for (let a = 0; a < S && ok; a++) {
            const k = (j * S + b) * nu * S + i * S + a;
            if (!(r.hit[k] <= MODEL.flat && r.thick[k] >= MODEL.solid)) ok = 0;
          }
        bits[j * nu + i] = ok;
      }
    out[face] = encodeMask({ nu, nv, bits });
  }
  return out;
}
