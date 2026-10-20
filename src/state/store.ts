import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_PROJECT, type PlacedBin, type ProjectState } from '../lib/project';
import { DEFAULT_BIN, sanitizeBin, type BinOptions } from '../lib/geometry/bin';
import type { BaseplateOptions } from '../lib/geometry/baseplate';
import { computeLayout, type DrawerInput } from '../lib/layout/drawer';
import type { PrintSetup } from '../lib/layout/plan';
import { findPrinter } from '../lib/printers';
import { canPlace, newId, occupancy } from '../lib/bins';

export type Tab = 'drawer' | 'bins' | 'print';

export interface UIState {
  tab: Tab;
  selectedBinId: string | null;
  units: 'mm' | 'in';
  /** Spread baseplate pieces apart in the drawer view. */
  explode: boolean;
  /** Plate shown in the print view; -1 = all. */
  plate: number;
}

export interface Store extends ProjectState {
  ui: UIState;
  /** Settings used for newly drawn bins. */
  newBin: BinOptions;
  setDrawer(p: Partial<DrawerInput>): void;
  setBaseplate(p: Partial<BaseplateOptions>): void;
  setSetup(p: Partial<PrintSetup>): void;
  setPrinter(id: string): void;
  setInclude(p: Partial<ProjectState['include']>): void;
  setUI(p: Partial<UIState>): void;
  setNewBin(p: Partial<BinOptions>): void;
  addBin(x: number, y: number, w: number, d: number): string;
  updateBin(id: string, patch: { x?: number; y?: number; opts?: Partial<BinOptions> }): void;
  removeBin(id: string): void;
  duplicateBin(id: string): string | null;
  clearBins(): void;
  fillEmpty(): number;
  resetAll(): void;
  /** Replace the project with one loaded from a saved file. */
  loadProject(data: unknown): void;
}

const DEFAULT_UI: UIState = { tab: 'drawer', selectedBinId: null, units: 'mm', explode: false, plate: -1 };

function gridSize(s: ProjectState) {
  const l = computeLayout(s.drawer);
  return { nx: l.nx, ny: l.ny };
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...DEFAULT_PROJECT,
      ui: DEFAULT_UI,
      newBin: DEFAULT_BIN,
      setDrawer: (p) => set((s) => ({ drawer: { ...s.drawer, ...p } })),
      setBaseplate: (p) => set((s) => ({ baseplate: { ...s.baseplate, ...p } })),
      setSetup: (p) => set((s) => ({ setup: { ...s.setup, ...p } })),
      setPrinter: (id) => {
        const pr = findPrinter(id);
        set((s) => ({
          setup:
            id === 'custom'
              ? { ...s.setup, printerId: id }
              : { ...s.setup, printerId: id, bedW: pr.bedW, bedD: pr.bedD, maxH: pr.maxH },
        }));
      },
      setInclude: (p) => set((s) => ({ include: { ...s.include, ...p } })),
      setUI: (p) => set((s) => ({ ui: { ...s.ui, ...p } })),
      setNewBin: (p) => set((s) => ({ newBin: sanitizeBin({ ...s.newBin, ...p }) })),
      addBin: (x, y, w, d) => {
        const id = newId();
        const bin: PlacedBin = { id, x, y, opts: sanitizeBin({ ...get().newBin, unitsX: w, unitsY: d }) };
        set((s) => ({ bins: [...s.bins, bin], ui: { ...s.ui, selectedBinId: id } }));
        return id;
      },
      updateBin: (id, patch) =>
        set((s) => ({
          bins: s.bins.map((b) =>
            b.id === id
              ? {
                  ...b,
                  x: patch.x ?? b.x,
                  y: patch.y ?? b.y,
                  opts: patch.opts ? sanitizeBin({ ...b.opts, ...patch.opts }) : b.opts,
                }
              : b,
          ),
        })),
      removeBin: (id) =>
        set((s) => ({
          bins: s.bins.filter((b) => b.id !== id),
          ui: s.ui.selectedBinId === id ? { ...s.ui, selectedBinId: null } : s.ui,
        })),
      duplicateBin: (id) => {
        const s = get();
        const src = s.bins.find((b) => b.id === id);
        if (!src) return null;
        const { nx, ny } = gridSize(s);
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const r = { x: i, y: j, w: src.opts.unitsX, d: src.opts.unitsY };
            if (canPlace(s.bins, r, nx, ny)) {
              const nid = newId();
              set({ bins: [...s.bins, { id: nid, x: i, y: j, opts: { ...src.opts } }], ui: { ...s.ui, selectedBinId: nid } });
              return nid;
            }
          }
        }
        return null;
      },
      clearBins: () => set((s) => ({ bins: [], ui: { ...s.ui, selectedBinId: null } })),
      fillEmpty: () => {
        const s = get();
        const { nx, ny } = gridSize(s);
        const occ = occupancy(s.bins, nx, ny);
        const added: PlacedBin[] = [];
        for (let i = 0; i < nx; i++) {
          for (let j = 0; j < ny; j++) {
            if (!occ[i][j]) added.push({ id: newId(), x: i, y: j, opts: sanitizeBin({ ...s.newBin, unitsX: 1, unitsY: 1 }) });
          }
        }
        set({ bins: [...s.bins, ...added] });
        return added.length;
      },
      resetAll: () => set({ ...DEFAULT_PROJECT, ui: DEFAULT_UI, newBin: DEFAULT_BIN }),
      loadProject: (data) => {
        const p = (data ?? {}) as Partial<Store> & { app?: string };
        if (typeof p !== 'object' || (p.app !== undefined && p.app !== 'gridfit')) throw new Error('Not a Gridfit project file.');
        set((s) => ({
          drawer: { ...DEFAULT_PROJECT.drawer, ...p.drawer },
          baseplate: { ...DEFAULT_PROJECT.baseplate, ...p.baseplate },
          setup: { ...DEFAULT_PROJECT.setup, ...p.setup },
          include: { ...DEFAULT_PROJECT.include, ...p.include },
          newBin: sanitizeBin({ ...DEFAULT_BIN, ...p.newBin }),
          bins: Array.isArray(p.bins)
            ? p.bins.map((b) => ({
                id: String(b.id ?? newId()),
                x: Math.round(Number(b.x) || 0),
                y: Math.round(Number(b.y) || 0),
                opts: sanitizeBin({ ...DEFAULT_BIN, ...b.opts }),
              }))
            : [],
          ui: { ...s.ui, selectedBinId: null },
        }));
      },
    }),
    {
      name: 'gridfit-project',
      version: 1,
      partialize: (s) => ({
        drawer: s.drawer,
        baseplate: s.baseplate,
        setup: s.setup,
        bins: s.bins,
        include: s.include,
        newBin: s.newBin,
        ui: { ...s.ui, selectedBinId: null },
      }),
      // Fill in fields added after the project was saved.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Store>;
        return {
          ...current,
          ...p,
          drawer: { ...current.drawer, ...p.drawer },
          baseplate: { ...current.baseplate, ...p.baseplate },
          setup: { ...current.setup, ...p.setup },
          include: { ...current.include, ...p.include },
          newBin: { ...current.newBin, ...p.newBin },
          ui: { ...current.ui, ...p.ui },
          bins: (p.bins ?? current.bins).map((b) => ({ ...b, opts: sanitizeBin({ ...DEFAULT_BIN, ...b.opts }) })),
        };
      },
    },
  ),
);

/** Contents of a saved .gridfit.json file. */
export function projectFile(s: Store) {
  return { app: 'gridfit', version: 1, ...projectOf(s), newBin: s.newBin };
}

/** The serializable project (what planJob needs). */
export function projectOf(s: Store): ProjectState {
  return { drawer: s.drawer, baseplate: s.baseplate, setup: s.setup, bins: s.bins, include: s.include };
}
