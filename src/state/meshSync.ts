import { attachmentMeshHashes, cleanupMeshes, syncMeshes } from '../lib/imported/meshStore';
import type { PlacedBin } from '../lib/project';
import { allDrawers, useStore } from './store';

/**
 * Imported meshes (lib/external.ts) for the open project: loaded from this
 * browser's storage into memory whenever a drawer uses one that isn't there
 * (at start-up, after undo, on switching drawers), and, once the first view
 * is up, the stored ones nothing (no drawer, no My bins or My attachments
 * entry) has used for a while forgotten (imported/meshStore.ts cleanupMeshes).
 */

/** Every mesh hash the bins use. */
export function meshHashes(bins: readonly Pick<PlacedBin, 'external'>[]): string[] {
  return [...new Set(bins.flatMap((b) => (b.external?.mesh ? [b.external.mesh.hash] : [])))];
}

/** Every mesh the project's drawers use: their imported bins', and their boards' imported models'. */
export const projectMeshes = () => {
  const drawers = allDrawers(useStore.getState());
  return [...new Set([...meshHashes(drawers.flatMap((d) => d.bins)), ...attachmentMeshHashes(drawers.flatMap((d) => d.drawer.attachments ?? []))])];
};

export function startMeshSync(firstView: Promise<unknown>): void {
  syncMeshes((fn) => useStore.subscribe(fn), projectMeshes);
  // My bins' imported bins and My attachments' imported models count as used too (they load after the first view anyway).
  void firstView.then(async () => {
    const [bins, attachments] = await Promise.all([import('./myBins'), import('./myAttachments')]);
    return cleanupMeshes([...projectMeshes(), ...bins.libraryMeshHashes(), ...attachments.libraryMeshHashes()]);
  });
}
