/**
 * Share links and bins from elsewhere (external.ts): a link can't hold a
 * mesh, so an imported bin goes as a placeholder box of its footprint and
 * height. Loaded when a link is copied.
 */
import { lipRise } from './geometry/variants';
import { externalOpts, meshSize } from './external';
import type { PlacedBin } from './project';

/** The bin as a share link carries it: a mesh can't go in a link, so it's a placeholder box of the same footprint and height. */
export function shareableBin(b: PlacedBin): PlacedBin {
  const m = b.external?.mesh;
  if (!m) return b;
  // The nearest whole units (a lip on top when it's stackable).
  const units = Math.max(1, Math.round((meshSize(m).h - lipRise({ lip: b.opts.lip })) / 7));
  const { mesh: _, print: __, ...rest } = b.external!;
  return { ...b, external: rest, opts: externalOpts({ unitsX: b.opts.unitsX, unitsY: b.opts.unitsY, heightUnits: units, stackable: b.opts.lip }) };
}

type ProjectBins = { bins?: PlacedBin[]; drawers?: { bins: PlacedBin[] }[] };

/**
 * A project file as a share link carries it (shareableBin): imported meshes
 * become boxes of their footprint and height. `dropped`: how many meshes
 * that left behind (each bin counted).
 */
export function shareableProject<T extends ProjectBins>(file: T): { file: T; dropped: number } {
  const strip = (bins: PlacedBin[]) => bins.map(shareableBin);
  const meshes = (bins: PlacedBin[] = []) => bins.filter((b) => b.external?.mesh).length;
  // The top-level bins are the active drawer's again (store.ts projectFile): count the drawers'.
  const dropped = file.drawers ? file.drawers.reduce((t, d) => t + meshes(d.bins), 0) : meshes(file.bins);
  return {
    file: { ...file, ...(file.bins ? { bins: strip(file.bins) } : {}), ...(file.drawers ? { drawers: file.drawers.map((d) => ({ ...d, bins: strip(d.bins) })) } : {}) },
    dropped,
  };
}
