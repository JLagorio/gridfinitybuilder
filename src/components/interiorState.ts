/**
 * State shared by the compartment editor (left pane) and its sidebar section:
 * what's selected inside the bin and which tool is active. Kept out of the main
 * store on purpose: it's transient UI, never saved.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { useStore } from '../state/store';
import { binCells, binInnerSize, type BinCells, type BinOptions } from '../lib/geometry/bin';
import { binCellsAt } from '../lib/project';
import type { GridLayout } from '../lib/layout/drawer';
import { resolveLayout, uniformLayout, type DividerLayout, type InnerSize, type ResolvedLayout } from '../lib/dividers';

export type InteriorTool = 'wall' | 'select';
export type OrientMode = 'auto' | 'v' | 'h';

interface InteriorState {
  /** Bin the selection belongs to; a selection for another bin reads as empty. */
  binId: string | null;
  wallId: string | null;
  compKey: string | null;
  tool: InteriorTool;
  orient: OrientMode;
  set(p: Partial<Omit<InteriorState, 'set'>>): void;
}

export const useInterior = create<InteriorState>((set) => ({
  binId: null,
  wallId: null,
  compKey: null,
  tool: 'wall',
  orient: 'auto',
  set: (p) => set(p),
}));

export function selectWall(binId: string, wallId: string | null) {
  useInterior.getState().set({ binId, wallId, compKey: null });
}

export function selectCompartment(binId: string, compKey: string | null) {
  useInterior.getState().set({ binId, compKey, wallId: null });
}

export function clearInteriorSelection() {
  useInterior.getState().set({ wallId: null, compKey: null });
}

export interface BinInterior {
  opts: BinOptions;
  cells: BinCells;
  size: InnerSize;
  /** The explicit layout (the uniform divX × divY split when the bin has none yet). */
  layout: DividerLayout;
  resolved: ResolvedLayout;
  /** True when the bin has its own layout (not just columns × rows). */
  custom: boolean;
}

export function interiorOf(opts: BinOptions, cells?: Partial<BinCells> | null): BinInterior {
  const c = binCells(opts, cells);
  const size = binInnerSize(opts, c);
  const layout = opts.layout ?? uniformLayout(opts.divX, opts.divY);
  return { opts, cells: c, size, layout, resolved: resolveLayout(layout, size.w, size.d), custom: !!opts.layout };
}

/** A placed bin's interior, with its real (possibly partial) cells. */
export function useBinInterior(binId: string | null, grid: GridLayout | null): (BinInterior & { binId: string }) | null {
  const bin = useStore((s) => (binId ? s.bins.find((b) => b.id === binId) : undefined));
  return useMemo(() => {
    if (!bin) return null;
    return { ...interiorOf(bin.opts, grid ? binCellsAt(grid, bin) : undefined), binId: bin.id };
  }, [bin, grid]);
}

/** The selection, restricted to walls/compartments that exist in this bin right now. */
export function useInteriorSelection(binId: string | null, r: ResolvedLayout | null) {
  const sel = useInterior();
  const mine = !!binId && sel.binId === binId;
  const wallId = mine && sel.wallId && r?.byId.has(sel.wallId) ? sel.wallId : null;
  const compKey = mine && sel.compKey && r?.compartments.some((c) => c.key === sel.compKey) ? sel.compKey : null;
  return { wallId, compKey, tool: sel.tool, orient: sel.orient };
}
