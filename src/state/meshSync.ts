import { cleanupMeshes, syncMeshes } from '../lib/imported/meshStore';
import type { PlacedBin } from '../lib/project';
import { allDrawers, useStore } from './store';

/**
 * Imported meshes (lib/external.ts) for the open project: loaded from this
 * browser's storage into memory whenever a drawer uses one that isn't there
 * (at start-up, after undo, on switching drawers), and, once the first view
 * is up, the stored ones nothing has used for a while forgotten
 * (imported/meshStore.ts cleanupMeshes).
 */

/** Every mesh hash the bins use. */
export function meshHashes(bins: readonly Pick<PlacedBin, 'external'>[]): string[] {
  return [...new Set(bins.flatMap((b) => (b.external?.mesh ? [b.external.mesh.hash] : [])))];
}

/** Every mesh the project's drawers use. */
export const projectMeshes = () => meshHashes(allDrawers(useStore.getState()).flatMap((d) => d.bins));

export function startMeshSync(firstView: Promise<unknown>): void {
  syncMeshes((fn) => useStore.subscribe(fn), projectMeshes);
  void firstView.then(() => cleanupMeshes(projectMeshes()));
}
