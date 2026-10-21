import type { MeshData } from '../geometry/kernel';

/**
 * Triangle-soup helpers for imported meshes (STL, 3MF, OBJ): welding,
 * the closed-solid check, centring, turning on the plate and a quick
 * decimation for the 3D view. Pure; runs in the worker and on the page.
 */

export interface RawMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface Box3 {
  min: [number, number, number];
  max: [number, number, number];
}

/** Bounding box of the positions (all zeros when there are none). */
export function bounds(positions: ArrayLike<number>): Box3 {
  if (!positions.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/** Size of a bounding box, mm. */
export const boxSize = (b: Box3): [number, number, number] => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];

/**
 * Merge vertices at exactly the same place and drop triangles that collapse.
 * `indices` omitted: the positions are a triangle soup, three vertices per
 * triangle (STL). Non-finite vertices drop their triangles.
 */
export function weld(positions: ArrayLike<number>, indices?: ArrayLike<number>): RawMesh {
  const nIn = Math.floor(positions.length / 3);
  const tri = indices ?? Uint32Array.from({ length: nIn }, (_, i) => i);
  // Open addressing on the float32 bit patterns (−0 counts as 0).
  const f32 = new Float32Array(3);
  const u32 = new Uint32Array(f32.buffer);
  let size = 16;
  while (size < nIn * 2) size *= 2;
  const table = new Int32Array(size).fill(-1);
  const keys = new Uint32Array(nIn * 3);
  const out = new Float32Array(nIn * 3);
  // -1: not seen yet, -2: not a finite point. Only vertices a triangle uses are kept.
  const remap = new Int32Array(nIn).fill(-1);
  let n = 0;
  const vertex = (i: number): number => {
    if (!(i >= 0 && i < nIn)) return -2;
    if (remap[i] !== -1) return remap[i];
    const x = positions[i * 3] + 0;
    const y = positions[i * 3 + 1] + 0;
    const z = positions[i * 3 + 2] + 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return (remap[i] = -2);
    f32[0] = x;
    f32[1] = y;
    f32[2] = z;
    const kx = u32[0] === 0x80000000 ? 0 : u32[0];
    const ky = u32[1] === 0x80000000 ? 0 : u32[1];
    const kz = u32[2] === 0x80000000 ? 0 : u32[2];
    let h = (Math.imul(kx, 73856093) ^ Math.imul(ky, 19349663) ^ Math.imul(kz, 83492791)) & (size - 1);
    for (;;) {
      const j = table[h];
      if (j < 0) {
        table[h] = n;
        keys[n * 3] = kx;
        keys[n * 3 + 1] = ky;
        keys[n * 3 + 2] = kz;
        out[n * 3] = f32[0];
        out[n * 3 + 1] = f32[1];
        out[n * 3 + 2] = f32[2];
        return (remap[i] = n++);
      }
      if (keys[j * 3] === kx && keys[j * 3 + 1] === ky && keys[j * 3 + 2] === kz) return (remap[i] = j);
      h = (h + 1) & (size - 1);
    }
  };
  const tris = new Uint32Array(tri.length - (tri.length % 3));
  let m = 0;
  for (let t = 0; t + 2 < tri.length; t += 3) {
    const a = vertex(tri[t]);
    const b = vertex(tri[t + 1]);
    const c = vertex(tri[t + 2]);
    if (a < 0 || b < 0 || c < 0 || a === b || b === c || c === a) continue;
    tris[m++] = a;
    tris[m++] = b;
    tris[m++] = c;
  }
  return { positions: out.slice(0, n * 3), indices: tris.slice(0, m) };
}

/**
 * True when the mesh is a closed, consistently oriented surface: every edge
 * is used once each way, by exactly two triangles. That's what a slicer (and
 * Manifold) calls a solid; anything else prints but may slice oddly.
 */
export function isClosed(m: RawMesh): boolean {
  const nv = m.positions.length / 3;
  const t = m.indices;
  if (!t.length) return false;
  const seen = new Map<number, number>();
  for (let i = 0; i < t.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = t[i + k];
      const b = t[i + ((k + 1) % 3)];
      const key = a * nv + b;
      if (seen.has(key)) return false;
      seen.set(key, 1);
    }
  }
  for (const key of seen.keys()) {
    const a = Math.floor(key / nv);
    const b = key - a * nv;
    if (!seen.has(b * nv + a)) return false;
  }
  return true;
}

/** Signed volume, mm³ (positive for an outward-facing closed mesh): the sum of tetrahedra from the origin. */
export function signedVolume(m: RawMesh): number {
  const p = m.positions;
  const t = m.indices;
  let v = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3;
    const b = t[i + 1] * 3;
    const c = t[i + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

/** The mesh with every triangle turned the other way (an inside-out file). */
export function flipped(m: RawMesh): RawMesh {
  const t = m.indices.slice();
  for (let i = 0; i < t.length; i += 3) {
    const b = t[i + 1];
    t[i + 1] = t[i + 2];
    t[i + 2] = b;
  }
  return { positions: m.positions, indices: t };
}

/** Moved so its bounding box is centred on x = y = 0 with its bottom at z = 0 (a copy). */
export function centred(m: RawMesh): RawMesh {
  const b = bounds(m.positions);
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const p = new Float32Array(m.positions.length);
  for (let i = 0; i < p.length; i += 3) {
    p[i] = m.positions[i] - cx;
    p[i + 1] = m.positions[i + 1] - cy;
    p[i + 2] = m.positions[i + 2] - b.min[2];
  }
  return { positions: p, indices: m.indices };
}

/**
 * The mesh as a part: optionally turned 90° about Z ((x, y) → (−y, x)), then
 * moved so its footprint's min corner is at the origin and its bottom at
 * z = 0, like every mesh Gridfit builds (project.ts buildMesh). A copy.
 */
export function placeMesh(m: RawMesh, rotate = false): MeshData {
  const src = m.positions;
  const p = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    p[i] = rotate ? -src[i + 1] : src[i];
    p[i + 1] = rotate ? src[i] : src[i + 1];
    p[i + 2] = src[i + 2];
  }
  const b = bounds(p);
  for (let i = 0; i < p.length; i += 3) {
    p[i] -= b.min[0];
    p[i + 1] -= b.min[1];
    p[i + 2] -= b.min[2];
  }
  return { positions: p, indices: m.indices.slice() };
}

/** Apply a 3MF transform (row vectors: m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz) to xyz triples, in place. */
export function transformPositions(p: Float32Array | number[], m: readonly number[]): void {
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    p[i] = x * m[0] + y * m[3] + z * m[6] + m[9];
    p[i + 1] = x * m[1] + y * m[4] + z * m[7] + m[10];
    p[i + 2] = x * m[2] + y * m[5] + z * m[8] + m[11];
  }
}

/** a then b, as 3MF composes a component's transform with its parent's. */
export function composeTransforms(a: readonly number[], b: readonly number[]): number[] {
  const r = (i: number, j: number) => a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return [r(0, 0), r(0, 1), r(0, 2), r(1, 0), r(1, 1), r(1, 2), r(2, 0), r(2, 1), r(2, 2), a[9] * b[0] + a[10] * b[3] + a[11] * b[6] + b[9], a[9] * b[1] + a[10] * b[4] + a[11] * b[7] + b[10], a[9] * b[2] + a[10] * b[5] + a[11] * b[8] + b[11]];
}

/**
 * Fewer triangles for the 3D view: vertices snapped to a grid and merged
 * (vertex clustering), coarser until at most `max` triangles are left. The
 * shape stays recognisable; small details go. Exports always use the full mesh.
 */
export function decimate(m: RawMesh, max: number): RawMesh {
  if (m.indices.length / 3 <= max) return m;
  const b = bounds(m.positions);
  const size = boxSize(b);
  const diag = Math.hypot(...size) || 1;
  // About max / 2 surface cells to start with.
  let cell = diag / Math.sqrt(Math.max(1, max) / 2);
  let out = m;
  for (let round = 0; round < 12; round++) {
    out = cluster(m, b, cell);
    if (out.indices.length / 3 <= max) return out;
    cell *= 1.35;
  }
  return out;
}

function cluster(m: RawMesh, b: Box3, cell: number): RawMesh {
  const p = m.positions;
  const nv = p.length / 3;
  const nx = Math.ceil((b.max[0] - b.min[0]) / cell) + 1;
  const ny = Math.ceil((b.max[1] - b.min[1]) / cell) + 1;
  const ids = new Map<number, number>();
  const of = new Int32Array(nv);
  const sum: number[] = [];
  const count: number[] = [];
  for (let i = 0; i < nv; i++) {
    const ix = Math.floor((p[i * 3] - b.min[0]) / cell);
    const iy = Math.floor((p[i * 3 + 1] - b.min[1]) / cell);
    const iz = Math.floor((p[i * 3 + 2] - b.min[2]) / cell);
    const key = ix + nx * (iy + ny * iz);
    let id = ids.get(key);
    if (id === undefined) {
      id = count.length;
      ids.set(key, id);
      count.push(0);
      sum.push(0, 0, 0);
    }
    of[i] = id;
    count[id]++;
    sum[id * 3] += p[i * 3];
    sum[id * 3 + 1] += p[i * 3 + 1];
    sum[id * 3 + 2] += p[i * 3 + 2];
  }
  const positions = new Float32Array(count.length * 3);
  for (let id = 0; id < count.length; id++) {
    positions[id * 3] = sum[id * 3] / count[id];
    positions[id * 3 + 1] = sum[id * 3 + 1] / count[id];
    positions[id * 3 + 2] = sum[id * 3 + 2] / count[id];
  }
  const t = m.indices;
  const tris = new Uint32Array(t.length);
  let n = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = of[t[i]];
    const c1 = of[t[i + 1]];
    const c2 = of[t[i + 2]];
    if (a === c1 || c1 === c2 || c2 === a) continue;
    tris[n++] = a;
    tris[n++] = c1;
    tris[n++] = c2;
  }
  return { positions, indices: tris.slice(0, n) };
}
