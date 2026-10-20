import type { Manifold, ManifoldToplevel, Vec2, Vec3 } from 'manifold-3d';

export type Wasm = ManifoldToplevel;
export type { Manifold, Vec2, Vec3 };

/** Plain triangle mesh that can cross worker boundaries and be written to 3MF. */
export interface MeshData {
  /** xyz triples */
  positions: Float32Array;
  /** vertex indices, three per triangle, CCW from outside */
  indices: Uint32Array;
  /**
   * Extra bodies that belong to the same part but print in another filament
   * (e.g. inlaid label text). They touch the main body without overlapping it.
   */
  overlays?: OverlayPart[];
}

export interface OverlayPart {
  name: string;
  /** 1-based filament slot (1 = the part's own filament). */
  filament: number;
  positions: Float32Array;
  indices: Uint32Array;
}

/** Deep copy (for sending a cached mesh across a worker boundary). */
export function cloneMesh(m: MeshData): MeshData {
  const out: MeshData = { positions: m.positions.slice(), indices: m.indices.slice() };
  if (m.overlays?.length) out.overlays = m.overlays.map((o) => ({ ...o, positions: o.positions.slice(), indices: o.indices.slice() }));
  return out;
}

export interface Bounds3 {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Manifold objects live on the WASM heap and must be freed explicitly.
 * A Scope tracks everything created during one build and frees it at the end.
 */
export class Scope {
  private items: { delete(): void }[] = [];
  t<T extends { delete(): void }>(x: T): T {
    this.items.push(x);
    return x;
  }
  dispose() {
    for (const it of this.items) {
      try {
        it.delete();
      } catch {
        /* already freed */
      }
    }
    this.items = [];
  }
}

export function toMeshData(m: Manifold): MeshData {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const nv = mesh.vertProperties.length / np;
  const positions = new Float32Array(nv * 3);
  if (np === 3) {
    positions.set(mesh.vertProperties);
  } else {
    for (let i = 0; i < nv; i++) {
      positions[i * 3] = mesh.vertProperties[i * np];
      positions[i * 3 + 1] = mesh.vertProperties[i * np + 1];
      positions[i * 3 + 2] = mesh.vertProperties[i * np + 2];
    }
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) };
}

export function meshBounds(mesh: MeshData): Bounds3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/** Translate a mesh (and its overlays) in place. */
export function translateMesh(mesh: MeshData, dx: number, dy: number, dz: number): MeshData {
  for (const p of [mesh.positions, ...(mesh.overlays ?? []).map((o) => o.positions)]) {
    for (let i = 0; i < p.length; i += 3) {
      p[i] += dx;
      p[i + 1] += dy;
      p[i + 2] += dz;
    }
  }
  return mesh;
}

/** Throws if the manifold is invalid, so bad geometry never reaches an export. */
export function assertValid(m: Manifold, what: string) {
  const status = m.status();
  if (status !== 'NoError') throw new Error(`${what}: geometry error ${status}`);
}
