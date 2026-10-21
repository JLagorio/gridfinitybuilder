/**
 * State shared by the compartment editor (left pane) and its sidebar section:
 * what's selected inside the bin and which tool is active. Kept out of the main
 * store on purpose: it's transient UI, never saved.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { useStore } from '../state/store';
import { binCells, binInnerSize, type BinCells, type BinOptions } from '../lib/geometry/bin';
import { compartmentInside } from '../lib/geometry/compartments';
import { binCellsAt } from '../lib/project';
import type { GridLayout } from '../lib/layout/drawer';
import { resolveLayout, uniformLayout, type DividerLayout, type InnerSize, type ResolvedLayout } from '../lib/dividers';

/** 'free': draw diagonal / curved walls. */
export type InteriorTool = 'wall' | 'select' | 'free';
export type OrientMode = 'auto' | 'v' | 'h';

interface InteriorState {
  /** Bin the selection belongs to; a selection for another bin reads as empty. */
  binId: string | null;
  wallId: string | null;
  compKey: string | null;
  /** Selected diagonal / curved wall. */
  freeId: string | null;
  tool: InteriorTool;
  orient: OrientMode;
  set(p: Partial<Omit<InteriorState, 'set'>>): void;
}

export const useInterior = create<InteriorState>((set) => ({
  binId: null,
  wallId: null,
  compKey: null,
  freeId: null,
  tool: 'wall',
  orient: 'auto',
  set: (p) => set(p),
}));

export function selectWall(binId: string, wallId: string | null) {
  useInterior.getState().set({ binId, wallId, compKey: null, freeId: null });
}

export function selectCompartment(binId: string, compKey: string | null) {
  useInterior.getState().set({ binId, compKey, wallId: null, freeId: null });
}

export function clearInteriorSelection() {
  useInterior.getState().set({ wallId: null, compKey: null, freeId: null });
}

export function selectFreeWall(binId: string, freeId: string | null) {
  useInterior.getState().set({ binId, freeId, wallId: null, compKey: null });
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

/**
 * Effective options of a compartment (its own, else the bin's). Filled insides
 * have no scoop or label tab.
 */
export function compartmentOptions(info: BinInterior, key: string) {
  const co = info.layout.comps?.[key];
  const inside = compartmentInside(co);
  const open = inside === 'open';
  return {
    scoop: open ? (co?.scoop ?? info.opts.scoop) : 0,
    label: open ? (co?.label ?? info.opts.label) : ('none' as const),
    floor: inside === 'tools' || inside === 'solid' ? 0 : (co?.floor ?? 0),
    own: !!co,
    inside,
  };
}

/** The selection, restricted to walls/compartments that exist in this bin right now. */
export function useInteriorSelection(binId: string | null, r: ResolvedLayout | null) {
  const sel = useInterior();
  const mine = !!binId && sel.binId === binId;
  const wallId = mine && sel.wallId && r?.byId.has(sel.wallId) ? sel.wallId : null;
  const compKey = mine && sel.compKey && r?.compartments.some((c) => c.key === sel.compKey) ? sel.compKey : null;
  const freeId = mine && sel.freeId && r?.free.some((f) => f.id === sel.freeId) ? sel.freeId : null;
  return { wallId, compKey, freeId, tool: sel.tool, orient: sel.orient };
}
