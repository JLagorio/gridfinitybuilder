import { beforeEach, describe, expect, it } from 'vitest';
import { history, selectedIds, useStore } from '../src/state/store';
import {
  copySelection,
  duplicateSelection,
  moveBins,
  nudgeSelection,
  pasteClipboard,
  removeSelection,
  resizeBin,
  selectAll,
  selectBins,
  toggleSelected,
} from '../src/state/selection';
import { fitResize, nearestBoundary, resizeTarget } from '../src/lib/binLayout';
import type { PlacedBin } from '../src/lib/project';
import { DEFAULT_BIN } from '../src/lib/geometry/bin';

const s = () => useStore.getState();
const sel = () => selectedIds(s().ui);
const at = (id: string) => {
  const b = s().bins.find((x) => x.id === id)!;
  return [b.x, b.y, b.opts.unitsX, b.opts.unitsY];
};

beforeEach(() => {
  s().resetAll();
  // A 4 × 3 grid.
  s().setDrawer({ mode: 'grid', gridX: 4, gridY: 3 });
  history.clear();
});

describe('selection', () => {
  it('setting only selectedBinId still means a single selection', () => {
    const a = s().addBin(0, 0, 1, 1);
    const b = s().addBin(1, 0, 1, 1);
    selectBins([a, b]);
    expect(sel()).toEqual([a, b]);
    s().setUI({ selectedBinId: b });
    expect(sel()).toEqual([b]);
    // An action that writes the primary directly (addBin) also wins.
    selectBins([a, b]);
    const c = s().addBin(2, 0, 1, 1);
    expect(sel()).toEqual([c]);
  });

  it('toggles and selects all', () => {
    const a = s().addBin(0, 0, 1, 1);
    const b = s().addBin(1, 0, 1, 1);
    selectBins([a]);
    toggleSelected(b);
    expect(sel()).toEqual([b, a]);
    toggleSelected(b);
    expect(sel()).toEqual([a]);
    selectAll();
    expect(sel().sort()).toEqual([a, b].sort());
  });
});

describe('group editing', () => {
  it('moves several bins together, only when all fit', () => {
    const a = s().addBin(0, 0, 1, 1);
    const b = s().addBin(1, 0, 1, 1);
    const c = s().addBin(3, 0, 1, 1);
    // a moves into b's old cell: bins in the group never block each other.
    expect(moveBins([a, b], 1, 0)).toBe(true);
    expect(at(a)).toEqual([1, 0, 1, 1]);
    expect(at(b)).toEqual([2, 0, 1, 1]);
    expect(moveBins([a, b], 1, 0)).toBe(false); // b would hit c
    expect(at(a)).toEqual([1, 0, 1, 1]);
    selectBins([a, b]);
    expect(nudgeSelection(0, 2)).toBe(true);
    expect(nudgeSelection(0, 1)).toBe(false); // off the back edge
    expect(at(c)).toEqual([3, 0, 1, 1]);
  });

  it('deletes every selected bin', () => {
    const a = s().addBin(0, 0, 1, 1);
    const b = s().addBin(1, 0, 1, 1);
    s().addBin(2, 0, 1, 1);
    selectBins([a, b]);
    history.checkpoint();
    removeSelection();
    expect(s().bins).toHaveLength(1);
    expect(sel()).toEqual([]);
    history.undo();
    expect(s().bins).toHaveLength(3);
  });

  it('copies and pastes at the hovered cell or the first free spot', () => {
    const a = s().addBin(0, 0, 2, 1);
    const b = s().addBin(0, 1, 1, 1);
    selectBins([a, b]);
    expect(copySelection()).toBe(2);
    const pasted = pasteClipboard([2, 1]);
    expect(pasted).toHaveLength(2);
    expect(pasted.map(at)).toEqual([
      [2, 1, 2, 1],
      [2, 2, 1, 1],
    ]);
    expect(sel()).toEqual(pasted);
    // Nowhere left for the pair.
    expect(pasteClipboard([3, 2])).toEqual([]);
    expect(s().bins).toHaveLength(4);
    selectBins([b]);
    copySelection();
    expect(pasteClipboard([3, 2]).map(at)).toEqual([[3, 2, 1, 1]]);
    // Hovered cell taken: first free spot, front row first.
    expect(pasteClipboard([0, 0]).map(at)).toEqual([[2, 0, 1, 1]]);
  });

  it('duplicates next to the selection', () => {
    const a = s().addBin(0, 0, 1, 2);
    selectBins([a]);
    const [copy] = duplicateSelection();
    expect(at(copy)).toEqual([1, 0, 1, 2]);
    expect(s().bins.find((b) => b.id === copy)!.opts).toEqual(s().bins.find((b) => b.id === a)!.opts);
  });

  it('copies, pastes and duplicates keep what is in the bin', () => {
    const a = s().addBin(0, 0, 1, 1);
    useStore.setState({ bins: s().bins.map((b) => (b.id === a ? { ...b, contents: 'M3 screws\nM3 nuts', compContents: { k: 'washers' } } : b)) });
    selectBins([a]);
    const [dup] = duplicateSelection();
    copySelection();
    const [pasted] = pasteClipboard([3, 2]);
    for (const id of [dup, pasted]) {
      const b = s().bins.find((x) => x.id === id)!;
      expect(b.contents).toBe('M3 screws\nM3 nuts');
      expect(b.compContents).toEqual({ k: 'washers' });
    }
    // Copies don't share the per-compartment object with the original.
    expect(s().bins.find((x) => x.id === pasted)!.compContents).not.toBe(s().bins.find((x) => x.id === a)!.compContents);
  });

  it('resizes a bin', () => {
    const a = s().addBin(1, 1, 1, 1);
    resizeBin(a, { x: 0, y: 0, w: 3, d: 2 });
    expect(at(a)).toEqual([0, 0, 3, 2]);
  });
});

describe('resize helpers', () => {
  const bin = (id: string, x: number, y: number, w = 1, d = 1): PlacedBin => ({ id, x, y, opts: { ...DEFAULT_BIN, unitsX: w, unitsY: d } });

  it('picks the nearest cell boundary', () => {
    expect(nearestBoundary([0, 42, 84, 126], 70)).toBe(2);
    expect(nearestBoundary([0, 42, 84, 126], -50)).toBe(0);
    expect(nearestBoundary([0, 42, 84, 126], 999)).toBe(3);
  });

  it('turns a handle drag into a rect, never smaller than one cell', () => {
    const r = { x: 1, y: 1, w: 1, d: 1 };
    expect(resizeTarget(r, 'e', 4, 0)).toEqual({ x: 1, y: 1, w: 3, d: 1 });
    expect(resizeTarget(r, 'w', 0, 0)).toEqual({ x: 0, y: 1, w: 2, d: 1 });
    expect(resizeTarget(r, 'w', 5, 0)).toEqual({ x: 1, y: 1, w: 1, d: 1 });
    expect(resizeTarget(r, 'ne', 3, 3)).toEqual({ x: 1, y: 1, w: 2, d: 2 });
    expect(resizeTarget(r, 's', 0, 0)).toEqual({ x: 1, y: 0, w: 1, d: 2 });
    expect(resizeTarget({ x: 0, y: 0, w: 1, d: 1 }, 'e', 40, 0).w).toBe(12);
  });

  it('stops growing at other bins and the grid edge', () => {
    const others = [bin('o', 3, 0)];
    const from = { x: 0, y: 0, w: 1, d: 1 };
    expect(fitResize(others, from, { x: 0, y: 0, w: 4, d: 1 }, 4, 3)).toEqual({ x: 0, y: 0, w: 3, d: 1 });
    expect(fitResize(others, from, { x: 0, y: 0, w: 1, d: 5 }, 4, 3)).toEqual({ x: 0, y: 0, w: 1, d: 3 });
    // Corner drag: grows each way as far as it can.
    expect(fitResize(others, from, { x: 0, y: 0, w: 4, d: 2 }, 4, 3)).toEqual({ x: 0, y: 0, w: 3, d: 2 });
    // Shrinking is always allowed.
    expect(fitResize(others, { x: 0, y: 0, w: 3, d: 2 }, { x: 1, y: 0, w: 2, d: 1 }, 4, 3)).toEqual({ x: 1, y: 0, w: 2, d: 1 });
  });
});
