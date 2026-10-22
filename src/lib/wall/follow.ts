/**
 * Attachments that hold a bin (PlacedAttachment.follow): a lip clip, a Gridfinity shelf or wall plate, a box sleeve,
 * linked to one of the project's bins, takes its size from that bin as its kind says (AttachmentDef.follow), so it
 * follows when the bin changes. Planning sizes it from the bin (place.ts, given the project's drawers by project.ts's
 * setWallParts hook); the store writes the bin's size into its options too (state/follow.ts), so when the bin is gone
 * (deleted, or its drawer) it keeps the size it had last. Loaded with the kinds and the board editors, not on the
 * first screen.
 */
import { binCellsAt, type NamedDrawer, type PlacedBin } from '../project';
import { binSize, binTotalHeight } from '../geometry/bin';
import { lipRise } from '../geometry/variants';
import { GRID, HEIGHT_UNIT } from '../geometry/spec';
import { computeLayout } from '../layout/drawer';
import { attachmentDef, type BinLink, type HeldBin, type PlacedAttachment } from './registry';

const round = (v: number, d = 100) => Math.round(v * d) / d;

/** The bin a link is to, and its drawer; null when either is gone. */
export function linkedBin<D extends Pick<NamedDrawer, 'id' | 'bins'>>(drawers: readonly D[], l: BinLink): { drawer: D; bin: PlacedBin } | null {
  const drawer = drawers.find((d) => d.id === l.drawer);
  const bin = drawer?.bins.find((b) => b.id === l.bin);
  return drawer && bin ? { drawer, bin } : null;
}

/** What a holder is sized from: a placed bin's footprint in cells (on its drawer's grid), its height in units and its outside. */
export function heldBin(drawer: Pick<NamedDrawer, 'drawer'>, b: PlacedBin): HeldBin {
  const { w, d } = binSize(b.opts, binCellsAt(computeLayout(drawer.drawer), b));
  const h = binTotalHeight(b.opts);
  // A bin is half a millimetre narrower than its cells.
  return {
    cellsX: round((w + 0.5) / GRID, 1e4),
    cellsY: round((d + 0.5) / GRID, 1e4),
    units: round((h - lipRise(b.opts)) / HEIGHT_UNIT, 1e4),
    w: round(w),
    d: round(d),
    h: round(h),
    lip: !!b.opts.lip,
  };
}

/** How an attachment that holds a bin is sized now. */
export interface Holding {
  /** The options its bin sets; unset when its bin is gone. */
  set?: Record<string, unknown>;
  /** Its options with them in (as they are when its bin is gone). */
  opts: Record<string, unknown>;
  /** For planning's warnings: its bin is gone, or it can't be made the bin's size. */
  note?: string;
}

/** How an attachment is sized by the bin it holds, among these drawers; null when it holds none (or its kind can't). */
export function holding(a: PlacedAttachment, drawers: readonly NamedDrawer[]): Holding | null {
  const def = a.follow ? attachmentDef(a.type) : null;
  if (!a.follow || !def?.follow) return null;
  const found = linkedBin(drawers, a.follow);
  if (!found) return { opts: a.opts, note: 'Its bin is gone (deleted, or its drawer): it keeps its last size.' };
  const set = def.follow(def.sanitize(a.opts), heldBin(found.drawer, found.bin)) as Record<string, unknown>;
  const opts = { ...a.opts, ...set };
  const o = def.sanitize(opts) as Record<string, unknown>;
  const off = Object.keys(set).some((k) => o[k] !== set[k]);
  return { set, opts, ...(off ? { note: 'It can’t be made the size of its bin: it’s as near as it goes.' } : {}) };
}

/**
 * Every holder in these drawers with its bin's size written into its options (state/follow.ts keeps the project so,
 * which is what leaves one at its last size when its bin goes): the drawers with that done, or null when they have it.
 */
export function syncHolders<D extends NamedDrawer>(drawers: readonly D[]): D[] | null {
  let changed = false;
  const out = drawers.map((d) => {
    const list = d.drawer.attachments;
    if (!list?.some((a) => a.follow)) return d;
    let mine = false;
    const next = list.map((a) => {
      const h = holding(a, drawers);
      if (!h?.set || Object.entries(h.set).every(([k, v]) => a.opts[k] === v)) return a;
      mine = true;
      return { ...a, opts: h.opts };
    });
    if (!mine) return d;
    changed = true;
    return { ...d, drawer: { ...d.drawer, attachments: next } };
  });
  return changed ? out : null;
}

/** The attachments that hold a bin, and the boards they're on. */
export function holdersOf<D extends NamedDrawer>(drawers: readonly D[], l: BinLink): { board: D; a: PlacedAttachment }[] {
  return drawers.flatMap((board) =>
    (board.drawer.attachments ?? []).filter((a) => a.follow?.drawer === l.drawer && a.follow.bin === l.bin).map((a) => ({ board, a })),
  );
}

type Board = { attachments?: PlacedAttachment[] };

/**
 * A project file (state/store.ts projectFile) as a share link or a saved file carries it: a link to a bin that isn't
 * in it is dropped (the attachment keeps its options, the size it had last).
 */
export function dropLostLinks<T extends { drawer?: Board; drawers?: { id: string; bins: PlacedBin[]; drawer?: Board }[] }>(file: T): T {
  const found = (a: PlacedAttachment) => !a.follow || !!linkedBin(file.drawers ?? [], a.follow);
  const clean = <B extends Board | undefined>(b: B): B =>
    b?.attachments?.every(found) === false ? { ...b, attachments: b.attachments.map((a) => (found(a) ? a : unlinked(a))) } : b;
  return {
    ...file,
    ...(file.drawer ? { drawer: clean(file.drawer) } : {}),
    ...(file.drawers ? { drawers: file.drawers.map((d) => (clean(d.drawer) === d.drawer ? d : { ...d, drawer: clean(d.drawer) })) } : {}),
  };
}

/** An attachment without its link: sized by hand from here, at the size it has. */
export function unlinked(a: PlacedAttachment): PlacedAttachment {
  const { follow: _, ...rest } = a;
  return rest;
}
