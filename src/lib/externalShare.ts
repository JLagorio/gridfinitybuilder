/**
 * Share links and bins from elsewhere (external.ts): a link can't hold a
 * mesh, so an imported bin goes as a placeholder box of its footprint and
 * height, and a model hung on a board (wall/kinds/model.ts) as a box of its
 * size, its clips where they were. Loaded when a link is copied.
 */
import { lipRise } from './geometry/variants';
import { externalOpts, meshSize } from './external';
import type { PlacedBin } from './project';
import type { PlacedAttachment } from './wall/registry';

/** The bin as a share link carries it: a mesh can't go in a link, so it's a placeholder box of the same footprint and height. */
export function shareableBin(b: PlacedBin): PlacedBin {
  const m = b.external?.mesh;
  if (!m) return b;
  // The nearest whole units (a lip on top when it's stackable).
  const units = Math.max(1, Math.round((meshSize(m).h - lipRise({ lip: b.opts.lip })) / 7));
  const { mesh: _, print: __, ...rest } = b.external!;
  return { ...b, external: rest, opts: externalOpts({ unitsX: b.opts.unitsX, unitsY: b.opts.unitsY, heightUnits: units, stackable: b.opts.lip }) };
}

type Board = { attachments?: PlacedAttachment[] };
type ProjectBins = { bins?: PlacedBin[]; drawer?: Board; drawers?: { bins: PlacedBin[]; drawer?: Board }[]; wall?: { photo?: { hash?: string } } };

/** An imported model on a board (its options' `mesh`) as a link carries it: its file name, size and flat faces, not its mesh's hash, so a box of its size stands in. */
export function shareableAttachment(a: PlacedAttachment): PlacedAttachment {
  const m = a.opts.mesh as { hash?: string } | null | undefined;
  if (!m || typeof m !== 'object' || !m.hash) return a;
  const { hash: _, ...rest } = m;
  return { ...a, opts: { ...a.opts, mesh: rest } };
}

/**
 * A project file as a share link carries it (shareableBin, shareableAttachment):
 * imported meshes become boxes of their footprint and height, and models on
 * boards boxes of their size. `dropped`: how many bins' meshes that left
 * behind, `models` how many models' (each counted). The wall planner's photo
 * (lib/wallPlanner/photoStore.ts) stays behind too: the wall keeps how it was
 * lined up, without its hash (`photo`: whether there was one to leave).
 */
export function shareableProject<T extends ProjectBins>(file: T): { file: T; dropped: number; models: number; photo: boolean } {
  const strip = (bins: PlacedBin[]) => bins.map(shareableBin);
  const meshes = (bins: PlacedBin[] = []) => bins.filter((b) => b.external?.mesh).length;
  const board = <B extends Board | undefined>(d: B): B => (d?.attachments ? { ...d, attachments: d.attachments.map(shareableAttachment) } : d);
  const models = (d?: Board) => (d?.attachments ?? []).filter((a) => shareableAttachment(a) !== a).length;
  // The top-level bins and drawer are the active drawer's again (store.ts projectFile): count the drawers'.
  const dropped = file.drawers ? file.drawers.reduce((t, d) => t + meshes(d.bins), 0) : meshes(file.bins);
  return {
    file: {
      ...file,
      ...(file.bins ? { bins: strip(file.bins) } : {}),
      ...(file.drawer ? { drawer: board(file.drawer) } : {}),
      ...(file.drawers ? { drawers: file.drawers.map((d) => ({ ...d, bins: strip(d.bins), ...(d.drawer ? { drawer: board(d.drawer) } : {}) })) } : {}),
      ...(file.wall?.photo ? { wall: { ...file.wall, photo: { ...file.wall.photo, hash: '' } } } : {}),
    },
    dropped,
    models: file.drawers ? file.drawers.reduce((t, d) => t + models(d.drawer), 0) : models(file.drawer),
    photo: !!file.wall?.photo?.hash,
  };
}
