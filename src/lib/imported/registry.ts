import type { MeshData } from '../geometry/kernel';
import { decimate, placeMesh } from './meshOps';

/**
 * Imported meshes in memory, by content hash (imported/format.ts): on the
 * page (filled from IndexedDB or a project file, imported/meshStore.ts) and
 * in the geometry worker (sent there by worker/client.ts before any request
 * that needs one). Each mesh is welded and centred: x = y = 0 at the middle
 * of its footprint, its bottom at z = 0.
 */

const meshes = new Map<string, MeshData>();
const listeners = new Set<() => void>();
let version = 0;

const emit = () => {
  version++;
  for (const l of listeners) l();
};

export function putImported(hash: string, mesh: MeshData): void {
  if (meshes.get(hash) === mesh) return;
  meshes.set(hash, mesh);
  emit();
}

export function dropImported(hash: string): void {
  if (meshes.delete(hash)) emit();
}

export const importedMesh = (hash: string): MeshData | undefined => meshes.get(hash);
export const hasImported = (hash: string): boolean => meshes.has(hash);
export const importedHashes = (): string[] => [...meshes.keys()];

/** Change notifications (a mesh came in or went), for useSyncExternalStore. */
export function subscribeImported(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const importedVersion = () => version;

/** How to build an imported bin's mesh (project.ts MeshSpec 'imported'). */
export interface ImportedSpec {
  kind: 'imported';
  key: string;
  /** Content hash of the mesh. */
  hash: string;
  /** For messages. */
  name: string;
  /** Turned 90° on the drawer floor. */
  rotate?: boolean;
  /** For the 3D view: at most this many triangles (imported/meshOps.ts decimate). Exports leave it out. */
  maxTriangles?: number;
  /** Not a closed solid: STEP can't make a solid of it (export/step.ts leaves it out). */
  open?: true;
}

/** The imported bin's mesh as a part: footprint's min corner at the origin, bottom at z = 0. */
export function buildImported(spec: ImportedSpec): MeshData {
  const m = meshes.get(spec.hash);
  if (!m) throw new Error(`The mesh of “${spec.name}” isn’t in this browser. Open the project file it was saved in, or import it again.`);
  const src = spec.maxTriangles && m.indices.length / 3 > spec.maxTriangles ? decimate(m, spec.maxTriangles) : m;
  return placeMesh(src, !!spec.rotate);
}
