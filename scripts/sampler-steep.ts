/**
 * Faces that hang past 45° (scripts/sampler.ts lists them in its report, for a look; docs/print-check.md).
 *
 * The print checks (src/lib/geometry/printcheck.ts) find flat ledges and long bridges layer by layer, past a 30°
 * slope: a face sloping between 45° and flat adds only a fraction of a millimetre a layer, so they don't see it.
 * This finds those faces on the mesh itself: triangles facing down more than 45° from upright (and less than 85°: a
 * flat one is a bridge or a ledge, the checks' business), off the first layer, joined into regions where they share
 * corners. Round holes and pegs lying down show here too (the tops of holes, the undersides of pegs): up to about
 * 10 mm across they print without support.
 */
import type { MeshData } from '../src/lib/geometry/kernel';

/** A region of faces past 45°: its area seen from below (mm²), its steepest face (degrees from upright), its extent. */
export interface SteepRegion {
  area: number;
  angle: number;
  z: [number, number];
  min: [number, number];
  max: [number, number];
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Regions of faces past `from`° (to `to`°) at least `minArea` mm² and `minRise` mm tall, largest first. */
export function steepFaces(mesh: Pick<MeshData, 'positions' | 'indices'>, from = 50, to = 85, minArea = 4, minRise = 0.6): SteepRegion[] {
  const p = mesh.positions;
  const t = mesh.indices;
  let zMin = Infinity;
  for (let i = 2; i < p.length; i += 3) zMin = Math.min(zMin, p[i]);
  const sinFrom = Math.sin((from * Math.PI) / 180);
  const sinTo = Math.sin((to * Math.PI) / 180);
  // Steep triangles, joined through their corners: union-find on the vertices, welded by place (a mesh may repeat a
  // vertex where two faces meet).
  const weld = new Map<string, number>();
  const at = new Int32Array(p.length / 3).map((_, i) => {
    const k = `${Math.round(p[3 * i] * 1e4)},${Math.round(p[3 * i + 1] * 1e4)},${Math.round(p[3 * i + 2] * 1e4)}`;
    return weld.get(k) ?? (weld.set(k, i), i);
  });
  const parent = new Int32Array(p.length / 3).map((_, i) => i);
  const find = (i: number) => {
    i = at[i];
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const steep: { tri: number; area: number; down: number }[] = [];
  for (let f = 0; f < t.length / 3; f++) {
    const [a, b, c] = [t[3 * f] * 3, t[3 * f + 1] * 3, t[3 * f + 2] * 3];
    if (Math.min(p[a + 2], p[b + 2], p[c + 2]) < zMin + 0.3) continue;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    // A face facing down at θ from upright has a normal pointing down by sin θ.
    const down = -nz / len;
    if (down < sinFrom || down > sinTo) continue;
    steep.push({ tri: f, area: -nz / 2, down });
    parent[find(t[3 * f + 1])] = find(t[3 * f]);
    parent[find(t[3 * f + 2])] = find(t[3 * f]);
  }
  const regions = new Map<number, { area: number; down: number; lo: number[]; hi: number[] }>();
  for (const s of steep) {
    const root = find(t[3 * s.tri]);
    const g = regions.get(root) ?? { area: 0, down: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
    g.area += s.area;
    g.down = Math.max(g.down, s.down);
    for (let k = 0; k < 3; k++) {
      const v = t[3 * s.tri + k] * 3;
      for (let d = 0; d < 3; d++) {
        g.lo[d] = Math.min(g.lo[d], p[v + d]);
        g.hi[d] = Math.max(g.hi[d], p[v + d]);
      }
    }
    regions.set(root, g);
  }
  return [...regions.values()]
    .filter((g) => g.area >= minArea && g.hi[2] - g.lo[2] >= minRise)
    .sort((x, y) => y.area - x.area)
    .map((g) => ({
      area: r1(g.area),
      angle: r1((Math.asin(Math.min(1, g.down)) * 180) / Math.PI),
      z: [r1(g.lo[2]), r1(g.hi[2])],
      min: [r1(g.lo[0]), r1(g.lo[1])],
      max: [r1(g.hi[0]), r1(g.hi[1])],
    }));
}
