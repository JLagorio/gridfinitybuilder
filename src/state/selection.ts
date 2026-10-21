import { useShallow } from 'zustand/react/shallow';
import { computeLayout } from '../lib/layout/drawer';
import { newId, withBlocked, type CellRect } from '../lib/bins';
import type { PlacedBin } from '../lib/project';
import { besideGroup, canMoveGroup, findSpot, groupBounds, toClip, type ClipBin } from '../lib/binLayout';
import { binsWithAbove, columnIds, withBinsAbove } from '../lib/stacking';
import { selectedIds, useStore } from './store';

/**
 * Multi-bin editing for the layout editor: selection, moving several bins,
 * resizing, copy/paste/duplicate, nudging. Everything goes through the store,
 * so undo/redo covers it. Stacks (stacking.ts) move as one; deleting,
 * copying and duplicating a bin takes the bins stacked on it along.
 */

export { selectedIds };

/** Selected bin ids (primary first), re-rendering only when they change. */
export function useSelectedIds(): string[] {
  return useStore(useShallow((s) => selectedIds(s.ui)));
}

const state = () => useStore.getState();

function grid() {
  const l = computeLayout(state().drawer);
  return { nx: l.nx, ny: l.ny, mask: l.mask };
}

/** Select these bins; `primary` (default: the first) is the one the Bins panel edits. */
export function selectBins(ids: string[], primary?: string | null) {
  const s = state();
  const known = [...new Set(ids)].filter((id) => s.bins.some((b) => b.id === id));
  const p = primary && known.includes(primary) ? primary : (known[0] ?? null);
  useStore.setState({ ui: { ...s.ui, selectedBinId: p, selectedBinIds: p ? [p, ...known.filter((id) => id !== p)] : [] } });
}

/** Shift/Cmd-click: add a bin to the selection, or take it out. */
export function toggleSelected(id: string) {
  const sel = selectedIds(state().ui);
  if (sel.includes(id)) selectBins(sel.filter((x) => x !== id));
  else selectBins([id, ...sel], id);
}

export function selectAll() {
  selectBins(state().bins.map((b) => b.id), state().ui.selectedBinId);
}

export function selectedBins(): PlacedBin[] {
  const s = state();
  const ids = selectedIds(s.ui);
  return s.bins.filter((b) => ids.includes(b.id));
}

/** Move bins together; nothing moves unless all of them fit. A stack moves as one. */
export function moveBins(ids: string[], dx: number, dy: number): boolean {
  if (!dx && !dy) return false;
  const s = state();
  const { nx, ny, mask } = grid();
  ids = columnIds(s.bins, ids);
  if (!canMoveGroup(withBlocked(s.bins, mask), ids, dx, dy, nx, ny)) return false;
  const set = new Set(ids);
  useStore.setState({ bins: s.bins.map((b) => (set.has(b.id) ? { ...b, x: b.x + dx, y: b.y + dy } : b)) });
  return true;
}

export function nudgeSelection(dx: number, dy: number): boolean {
  return moveBins(selectedIds(state().ui), dx, dy);
}

export function removeBins(ids: string[]) {
  if (!ids.length) return;
  const s = state();
  const set = new Set(withBinsAbove(s.bins, ids));
  const left = selectedIds(s.ui).filter((id) => !set.has(id));
  useStore.setState({
    bins: s.bins.filter((b) => !set.has(b.id)),
    ui: { ...s.ui, selectedBinId: left[0] ?? null, selectedBinIds: left },
  });
}

export function removeSelection() {
  removeBins(selectedIds(state().ui));
}

/** Resize (and possibly move) a bin to cover exactly this rect. */
export function resizeBin(id: string, r: CellRect) {
  state().updateBin(id, { x: r.x, y: r.y, opts: { unitsX: r.w, unitsY: r.d } });
}

// Not part of the project or of undo history: a plain in-memory clipboard.
let clipboard: ClipBin[] = [];

export function copySelection(): number {
  const bins = selectedBins();
  if (bins.length) clipboard = toClip(binsWithAbove(state().bins, bins));
  return bins.length;
}

export const hasClipboard = () => clipboard.length > 0;

/** Add copies of clip bins with their group's front-left corner at (x, y), and select them. */
function place(clip: ClipBin[], [x, y]: [number, number]): string[] {
  const fresh = clip.map(() => newId());
  const added: PlacedBin[] = clip.map(({ dx, dy, opts, on, ...contents }, i) => ({
    id: fresh[i],
    x: x + dx,
    y: y + dy,
    opts: structuredClone(opts),
    ...structuredClone(contents),
    ...(on !== undefined ? { on: fresh[on] } : {}),
  }));
  const s = state();
  const ids = added.map((b) => b.id);
  useStore.setState({ bins: [...s.bins, ...added], ui: { ...s.ui, selectedBinId: ids[0] ?? null, selectedBinIds: ids } });
  return ids;
}

/** Paste at the hovered cell if the bins fit there, else at the first free spot. Returns the new ids. */
export function pasteClipboard(at?: [number, number] | null): string[] {
  if (!clipboard.length) return [];
  const { nx, ny, mask } = grid();
  const spot = findSpot(withBlocked(state().bins, mask), clipboard, nx, ny, at ? [at] : []);
  return spot ? place(clipboard, spot) : [];
}

/** Copies of the selected bins, next to them when there's room. */
export function duplicateSelection(): string[] {
  const bins = selectedBins();
  if (!bins.length) return [];
  const clip = toClip(binsWithAbove(state().bins, bins));
  const { nx, ny, mask } = grid();
  const spot = findSpot(withBlocked(state().bins, mask), clip, nx, ny, besideGroup(groupBounds(bins)));
  return spot ? place(clip, spot) : [];
}
