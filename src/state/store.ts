import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_PROJECT, binCellsAt, type NamedDrawer, type PlacedBin, type ProjectState } from '../lib/project';
import { DEFAULT_BIN, binInnerSize, sanitizeBin, type BinOptions } from '../lib/geometry/bin';
import { DEFAULT_BASEPLATE, type BaseplateOptions } from '../lib/geometry/baseplate';
import { DEFAULT_DRAWER, computeLayout, type DrawerInput } from '../lib/layout/drawer';
import { cleanSetup, type PrintSetup } from '../lib/layout/plan';
import { findPrinter } from '../lib/printers';
import { canPlace, newId, occupancy, withBlocked } from '../lib/bins';
import { DEFAULT_INCH_PRECISION, formatBoth, formatLength, type FormatOptions, type InchPrecision, type Units } from '../lib/units';
import { cleanTemplates, mergeTemplates, type BinTemplate } from '../lib/templates';
import { trackHistory, type Snapshot } from './history';
import { cleanTool, cleanTools, mergeTools, removeToolFromBins, syncToolInBins, type Tool } from '../lib/tools';
import { carryContents, cleanBinContents, sanitizeContents, withCompContents, withContents } from '../lib/inventory';
import { cleanStretch, type BinStretch } from '../lib/geometry/placement';
import { switchHalfGrid } from '../lib/layout/halfgrid';
import { fitLayout, type DividerLayout } from '../lib/dividers';
import { bedOvershoot, placedOvershoot, shrinkToBed, usableBeds } from '../lib/bedfit';
import { cleanEnclosure } from '../lib/enclosureOptions';
import { NEW_SKADIS } from '../lib/geometry/skadisOptions';
import { cleanStacks, followFootprint, withBinsAbove, withNewIds } from '../lib/stacking';
import { cleanFillList, mergeBins, type NewBin } from '../lib/autofill/apply';
import { NO_PRINTS, cleanPrinted, type PrintedRecord } from '../lib/printed';
import { cleanExternal, cleanExternalOpts, patchExternalOpts } from '../lib/external';
import { cleanWall, type WallPlan } from '../lib/wallPlanner/data';

export type Tab = 'drawer' | 'bins' | 'print';
/** Bins tab, left pane: the drawer grid, the selected bin's compartment editor, or its tool cutouts. */
export type BinPane = 'drawer' | 'compartments' | 'cutouts';

export interface UIState {
  tab: Tab;
  /** The primary selected bin (the one the Bins panel edits). */
  selectedBinId: string | null;
  /**
   * Every selected bin. Only counts while it contains `selectedBinId`, so code
   * that sets just `selectedBinId` still means a single selection (see selection.ts).
   */
  selectedBinIds: string[];
  units: Units;
  /** How finely inches are shown (fraction denominator, 0 = decimal). */
  inchPrecision: InchPrecision;
  /** Spread baseplate pieces apart in the drawer view. */
  explode: boolean;
  /** Plate shown in the print view; -1 = all. */
  plate: number;
  /** Bins tab, left pane (see BinPane). */
  binPane: BinPane;
  /** A Skådis board's selected attachment (lib/wall), on its Attachments tab: the primary, the one its panel edits. */
  selectedAttachment?: string | null;
  /** Every selected attachment; like `selectedBinIds`, only counts while it contains `selectedAttachment` (see attachmentSelection). */
  selectedAttachments?: string[];
  /**
   * An attachment being dragged in the 3D view (components/wallDrag.ts): the anchor slot it's shown on, and
   * whether all its mounts have slots there, and the same for the rest of the selection moving with it (`group`).
   * The drop moves them (one undo step); this is never saved or undone.
   */
  wallDrag?: { id: string; x: number; y: number; fits: boolean; group?: { id: string; x: number; y: number; fits: boolean }[] } | null;
}

/**
 * A saved drawer. The active drawer's live data is in the store's top-level
 * `drawer` / `baseplate` / `bins`; its entry in `drawers` is only refreshed when
 * switching away (use `allDrawers()` to read every drawer up to date).
 */
export interface DrawerDoc extends NamedDrawer {
  /** The list last typed in "Fill from a list" (lib/autofill) for this drawer. Missing = none. */
  fillList?: string;
}

/**
 * Which drawers the print tab exports. 'selected': just the bins selected in
 * the active drawer (and their lids, inserts, …), without its baseplate. The
 * selection isn't saved, so neither is 'selected' (it opens as 'active').
 */
export type PrintScope = 'active' | 'all' | 'pick' | 'selected';

export interface Store extends ProjectState {
  ui: UIState;
  /** Settings used for newly drawn bins. */
  newBin: BinOptions;
  drawers: DrawerDoc[];
  activeDrawerId: string;
  printScope: PrintScope;
  /** Drawer ids printed when printScope is 'pick'. */
  printPick: string[];
  /** Saved bin settings, shared by all drawers (actions in templates.ts). */
  templates: BinTemplate[];
  /** Tool library (traced / imported outlines), shared by every drawer. */
  tools: Tool[];
  /** What has been printed, by part fingerprint (lib/printed.ts; marked through state/printed.ts). */
  printed: PrintedRecord;
  /** Print only what isn't printed yet. */
  onlyChanged: boolean;
  /** The wall the boards and wall grids hang on (lib/wallPlanner, components/WallPlanner.tsx). Unset: none measured yet. */
  wall?: WallPlan;
  /** Add a tool (outline in mm, any winding/origin; it's normalized). Returns its id. */
  addTool(t: Partial<Tool> & Pick<Tool, 'outline'>): string;
  /** Change a tool; its copies in placed bins follow. */
  updateTool(id: string, patch: Partial<Omit<Tool, 'id'>>): void;
  /** Remove a tool and its pockets from every bin. */
  removeTool(id: string): void;
  setDrawer(p: Partial<DrawerInput>): void;
  /**
   * "Just bins" for the active drawer (DrawerInput.haveBaseplate), as one undo
   * step. Turned on for a drawer with no bins yet that is sized to a drawer,
   * the size switches to grid units, the natural way to give a baseplate you
   * have (the drawer size is kept for a switch back).
   */
  setHaveBaseplate(on: boolean): void;
  setBaseplate(p: Partial<BaseplateOptions>): void;
  setSetup(p: Partial<PrintSetup>): void;
  setPrinter(id: string): void;
  setInclude(p: Partial<ProjectState['include']>): void;
  setUI(p: Partial<UIState>): void;
  setNewBin(p: Partial<BinOptions>): void;
  addBin(x: number, y: number, w: number, d: number): string;
  /** `stretch: null` clears the bin's stretch over the margin. */
  updateBin(id: string, patch: { x?: number; y?: number; opts?: Partial<BinOptions>; stretch?: Partial<BinStretch> | null }): void;
  /**
   * Turn the active drawer's half grid on or off, converting its bins and
   * blocked cells in the same step (one undo). Returns how many bins had to
   * change size or move.
   */
  setHalfGrid(on: boolean): number;
  removeBin(id: string): void;
  duplicateBin(id: string): string | null;
  clearBins(): void;
  fillEmpty(): number;
  /**
   * Put several bins in the active drawer as one undo step ("Fill from a
   * list", lib/autofill). Each is cut down to what the printer takes; one that
   * would overlap a bin or a blocked cell is left out. `replace` removes the
   * drawer's bins first; `newDrawers` adds drawers like this one (same size
   * and baseplate, after it) holding those bins. Returns the ids added here.
   */
  addBins(bins: NewBin[], o?: { replace?: boolean; newDrawers?: NewBin[][] }): string[];
  /** Remember the list typed in "Fill from a list" for the active drawer (not an undo step of its own). */
  setFillList(text: string): void;
  // Drawers
  /**
   * A new drawer after the others; `haveBaseplate`: for a baseplate you have
   * ("Just bins", sized in grid units); `skadis`: a Skådis pegboard instead of
   * a grid (geometry/skadis.ts).
   */
  addDrawer(name?: string, o?: { haveBaseplate?: boolean; skadis?: boolean }): string;
  duplicateDrawer(id: string): string;
  removeDrawer(id: string): void;
  renameDrawer(id: string, name: string): void;
  switchDrawer(id: string): void;
  setPrintScope(scope: PrintScope, pick?: string[]): void;
  // Contents (src/lib/inventory.ts): not geometry, so no mesh is rebuilt.
  /** What's in a bin of the active drawer, one item per line ('' clears it). */
  setBinContents(id: string, contents: string): void;
  /** What's in one compartment of a bin of the active drawer. */
  setCompContents(id: string, compKey: string, contents: string): void;
  /** Go to a bin found by search: switch to its drawer, open the Bins tab and select it (just the drawer without a bin). */
  locateBin(drawerId: string, binId?: string | null): void;
  resetAll(): void;
  /**
   * Start over with one empty drawer, as one undo step. Printers and print settings, templates,
   * the tool library and the settings for new bins are kept: they belong to the user, not the project.
   */
  newProject(): void;
  /**
   * Replace the project with one loaded from a saved file. A version 3 file's
   * `meshes` (imported bins) go in first, through imported/meshStore.ts adoptMeshes.
   */
  loadProject(data: unknown): void;
  /**
   * Put a divider layout (walls, diagonal walls, per-compartment options) into
   * other bins, in this drawer or any other, as one undo step. `from` is a bin
   * of this drawer or a layout. Ratio walls adapt to each bin's size; fixed-size
   * walls that don't fit a bin are dropped there (and reported).
   */
  copyLayout(from: string | LayoutSource, to: LayoutTarget[]): CopyLayoutReport;
}

/** What copyLayout copies: a layout, or columns × rows when `layout` is null. */
export interface LayoutSource {
  layout: DividerLayout | null;
  divX: number;
  divY: number;
}

export interface LayoutTarget {
  drawerId: string;
  binId: string;
}

export interface CopyLayoutReport {
  /** Bins that got the layout. */
  copied: number;
  /** Bins where fixed-size walls didn't fit and were left out (how many). */
  dropped: { drawerId: string; binId: string; walls: number }[];
}

/** Every selected bin id, primary first. */
export function selectedIds(ui: Pick<UIState, 'selectedBinId' | 'selectedBinIds'>): string[] {
  const p = ui.selectedBinId;
  if (!p) return [];
  return ui.selectedBinIds?.includes(p) ? [p, ...ui.selectedBinIds.filter((id) => id !== p)] : [p];
}

/** Every selected attachment id, primary first. */
export function attachmentSelection(ui: Pick<UIState, 'selectedAttachment' | 'selectedAttachments'>): string[] {
  const p = ui.selectedAttachment;
  if (!p) return [];
  return ui.selectedAttachments?.includes(p) ? [p, ...ui.selectedAttachments.filter((id) => id !== p)] : [p];
}

const DEFAULT_UI: UIState = {
  tab: 'drawer',
  selectedBinId: null,
  selectedBinIds: [],
  units: 'mm',
  inchPrecision: DEFAULT_INCH_PRECISION,
  explode: false,
  plate: -1,
  binPane: 'drawer',
};

function gridSize(s: ProjectState) {
  const l = computeLayout(s.drawer);
  return { nx: l.nx, ny: l.ny, mask: l.mask };
}

const FIRST_DRAWER_ID = 'd1';

function cleanDrawer(d: Partial<DrawerInput> | undefined): DrawerInput {
  const out = { ...DEFAULT_DRAWER, ...d };
  const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n > 0) : []);
  out.widthSamples = nums(out.widthSamples);
  out.depthSamples = nums(out.depthSamples);
  out.height = Number(out.height) > 0 ? Number(out.height) : 0;
  if (!['solid', 'half', 'fit', 'spacers'].includes(out.fill)) out.fill = 'solid';
  // Blocked cells: "i,j" keys, deduplicated.
  out.mask = Array.isArray(out.mask) ? [...new Set(out.mask.map(String).filter((k) => /^\d+,\d+$/.test(k)))] : [];
  out.maskStyle = out.maskStyle === 'void' ? 'void' : 'solid';
  // Half grid: only kept when on, so drawers saved before it existed stay as they were.
  if (out.halfGrid === true) out.halfGrid = true;
  else delete out.halfGrid;
  // "Just bins" likewise: drawers saved before it existed print their baseplate.
  if (out.haveBaseplate === true) out.haveBaseplate = true;
  else delete out.haveBaseplate;
  return cleanEnclosure(out);
}

/** A bin with its stretch cleaned (dropped when there is none). */
function withStretch(b: PlacedBin, stretch: unknown): PlacedBin {
  const { stretch: _, ...rest } = b;
  const st = cleanStretch(stretch);
  return st ? { ...rest, stretch: st } : rest;
}

/** Bins from a saved file or storage, made valid (also My bins' entries, state/myBins.ts). */
export function cleanBins(bins: unknown): PlacedBin[] {
  if (!Array.isArray(bins)) return [];
  // Stacked bins keep the bin they stand on, and its footprint (stacking.ts).
  return cleanStacks(bins.map((b) => {
    // Bins from elsewhere (external.ts): footprint and height only, never stretched.
    const external = cleanExternal(b?.external);
    return withStretch(
      {
        id: String(b?.id ?? newId()),
        x: Math.round(Number(b?.x) || 0),
        y: Math.round(Number(b?.y) || 0),
        opts: external ? cleanExternalOpts(b?.opts, external) : sanitizeBin({ ...DEFAULT_BIN, ...b?.opts }),
        ...cleanBinContents(b),
        ...(typeof b?.on === 'string' ? { on: b.on } : {}),
        ...(external ? { external } : {}),
      },
      external ? undefined : b?.stretch,
    );
  }));
}

/** Patches that can change a bin's compartments (and so where per-compartment contents belong). */
const WALL_KEYS = ['layout', 'divX', 'divY', 'unitsX', 'unitsY'] as const;

function cleanDoc(d: Partial<DrawerDoc>, i: number): DrawerDoc {
  const fillList = cleanFillList(d.fillList);
  return {
    id: String(d.id ?? newId()),
    name: String(d.name ?? `Drawer ${i + 1}`),
    drawer: cleanDrawer(d.drawer),
    baseplate: { ...DEFAULT_BASEPLATE, ...d.baseplate },
    bins: cleanBins(d.bins),
    ...(fillList ? { fillList } : {}),
  };
}

/** Every drawer, with the active one's live data. */
export function allDrawers(s: Pick<Store, 'drawers' | 'activeDrawerId' | 'drawer' | 'baseplate' | 'bins'>): DrawerDoc[] {
  return s.drawers.map((d) =>
    d.id === s.activeDrawerId ? { ...d, drawer: s.drawer, baseplate: s.baseplate, bins: s.bins } : d,
  );
}

export function activeDrawer(s: Store): DrawerDoc {
  return allDrawers(s).find((d) => d.id === s.activeDrawerId) ?? allDrawers(s)[0];
}

/**
 * The drawers the print tab should export, in workspace order. With the
 * 'selected' scope, the active drawer with just its selected bins, planned
 * like a bins-only drawer (haveBaseplate) so no baseplate prints.
 */
export function printDrawers(s: Store): DrawerDoc[] {
  const all = allDrawers(s);
  if (s.printScope === 'all') return all;
  if (s.printScope === 'selected') {
    const doc = all.find((d) => d.id === s.activeDrawerId) ?? all[0];
    const ids = new Set(selectedIds(s.ui));
    return [{ ...doc, drawer: { ...doc.drawer, haveBaseplate: true }, bins: doc.bins.filter((b) => ids.has(b.id)) }];
  }
  if (s.printScope === 'pick') {
    const picked = all.filter((d) => s.printPick.includes(d.id));
    if (picked.length) return picked;
  }
  return all.filter((d) => d.id === s.activeDrawerId);
}

function uniqueName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

/** Live state with the active drawer written back into the drawer list. */
function synced(s: Store): DrawerDoc[] {
  return allDrawers(s);
}

/** The print scope as saved: the bin selection isn't, so 'selected' opens as 'active'. */
const savedScope = (p: PrintScope): PrintScope => (p === 'selected' ? 'active' : p);

/** What autosave keeps. Undo/redo covers the same keys, minus `ui` (see `history` below). */
function persisted(s: Store) {
  return {
    drawer: s.drawer,
    baseplate: s.baseplate,
    setup: s.setup,
    bins: s.bins,
    include: s.include,
    newBin: s.newBin,
    drawers: allDrawers(s),
    activeDrawerId: s.activeDrawerId,
    printScope: savedScope(s.printScope),
    printPick: s.printPick,
    templates: s.templates,
    tools: s.tools,
    printed: s.printed,
    onlyChanged: s.onlyChanged,
    wall: s.wall,
    // View-only state (selection, spread pieces, shown plate, a drag in the 3D view) starts fresh on every load.
    ui: { ...s.ui, selectedBinId: null, selectedBinIds: [], selectedAttachments: [], explode: false, plate: -1, wallDrag: null },
  };
}

const DEFAULT_WORKSPACE = {
  drawers: [{ id: FIRST_DRAWER_ID, name: 'Drawer 1', drawer: DEFAULT_DRAWER, baseplate: DEFAULT_BASEPLATE, bins: [] }] as DrawerDoc[],
  activeDrawerId: FIRST_DRAWER_ID,
  printScope: 'active' as PrintScope,
  printPick: [] as string[],
  printed: NO_PRINTS,
  onlyChanged: false,
  wall: undefined as WallPlan | undefined,
};

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...DEFAULT_PROJECT,
      ...DEFAULT_WORKSPACE,
      ui: DEFAULT_UI,
      newBin: DEFAULT_BIN,
      templates: [],
      tools: [],
      setDrawer: (p) => set((s) => ({ drawer: { ...s.drawer, ...p } })),
      setHaveBaseplate: (on) => {
        const s = get();
        if (!!s.drawer.haveBaseplate === on) return;
        const { haveBaseplate: _, ...rest } = s.drawer;
        // Nothing drawn yet: a baseplate you have is easiest given by its cells.
        const grid = on && !s.bins.length && s.drawer.mode === 'drawer' && s.drawer.enclosure !== 'skadis' ? { mode: 'grid' as const } : {};
        history.checkpoint();
        set({ drawer: on ? { ...rest, ...grid, haveBaseplate: true } : rest });
        history.checkpoint();
      },
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
      setUI: (p) =>
        set((s) => {
          // Setting only the primary selection means selecting just that bin.
          const ids = 'selectedBinId' in p && !p.selectedBinIds ? { selectedBinIds: p.selectedBinId ? [p.selectedBinId] : [] } : {};
          return { ui: { ...s.ui, ...p, ...ids } };
        }),
      // New bins never start with another bin's tool pockets.
      setNewBin: (p) =>
        set((s) => {
          const nb = sanitizeBin({ ...s.newBin, ...p, cutouts: undefined });
          // Settings that leave no bin the printer can take (too tall) are refused (bedfit.ts).
          const bed = usableBeds(s.setup);
          if (bedOvershoot({ ...nb, unitsX: 1, unitsY: 1 }, null, bed) > bedOvershoot({ ...s.newBin, unitsX: 1, unitsY: 1 }, null, bed) + 1e-6) return {};
          return { newBin: nb.interior === 'cutouts' ? { ...nb, interior: 'compartments' } : nb };
        }),
      addBin: (x, y, w, d) => {
        const id = newId();
        // Never bigger than the printer takes (bedfit.ts): a new bin is cut down to fit.
        const s0 = get();
        const bin = shrinkToBed(computeLayout(s0.drawer), { id, x, y, opts: sanitizeBin({ ...s0.newBin, unitsX: w, unitsY: d }) }, usableBeds(s0.setup));
        set((s) => ({ bins: [...s.bins, bin], ui: { ...s.ui, selectedBinId: id } }));
        return id;
      },
      updateBin: (id, patch) =>
        set((s) => ({
          // A stack has one footprint: the bins above and below take the new place and size (stacking.ts).
          bins: followFootprint(s.bins, s.bins.map((b) => {
            if (b.id !== id) return b;
            const layout = computeLayout(s.drawer);
            const bed = usableBeds(s.setup);
            const next = {
              ...b,
              x: patch.x ?? b.x,
              y: patch.y ?? b.y,
              // A bin from elsewhere only takes its footprint, height and stackable (external.ts).
              opts: patch.opts ? (b.external ? patchExternalOpts(b, patch.opts) : sanitizeBin({ ...b.opts, ...patch.opts })) : b.opts,
            };
            const stretched = patch.stretch !== undefined && !b.external ? withStretch(next, patch.stretch) : next;
            // Per-compartment contents follow their compartments when the walls change.
            const walls = b.compContents && patch.opts && WALL_KEYS.some((k) => k in patch.opts!);
            const out = walls ? carryContents({ ...stretched, opts: b.opts }, stretched.opts) : stretched;
            // Never past the print bed (bedfit.ts): an edit that makes the bin overshoot it more than it already does is refused.
            return placedOvershoot(layout, out, bed) > placedOvershoot(layout, b, bed) + 1e-6 ? b : out;
          }), id, computeLayout(s.drawer), usableBeds(s.setup)),
        })),
      setHalfGrid: (on) => {
        const s = get();
        const r = switchHalfGrid(s.drawer, s.bins, on);
        if (r.drawer !== s.drawer) set({ drawer: r.drawer, bins: r.bins });
        return r.adjusted;
      },
      removeBin: (id) =>
        set((s) => {
          // The bins stacked on it go with it (stacking.ts).
          const gone = new Set(withBinsAbove(s.bins, [id]));
          return {
            bins: s.bins.filter((b) => !gone.has(b.id)),
            ui: s.ui.selectedBinId && gone.has(s.ui.selectedBinId) ? { ...s.ui, selectedBinId: null } : s.ui,
          };
        }),
      duplicateBin: (id) => {
        const s = get();
        const src = s.bins.find((b) => b.id === id);
        if (!src) return null;
        const { nx, ny, mask } = gridSize(s);
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const r = { x: i, y: j, w: src.opts.unitsX, d: src.opts.unitsY };
            if (canPlace(withBlocked(s.bins, mask), r, nx, ny)) {
              const nid = newId();
              set({ bins: [...s.bins, { id: nid, x: i, y: j, opts: { ...src.opts }, ...(src.external ? { external: structuredClone(src.external) } : {}) }], ui: { ...s.ui, selectedBinId: nid } });
              return nid;
            }
          }
        }
        return null;
      },
      clearBins: () => set((s) => ({ bins: [], ui: { ...s.ui, selectedBinId: null } })),
      fillEmpty: () => {
        const s = get();
        const { nx, ny, mask } = gridSize(s);
        const added: PlacedBin[] = [];
        // 1 × 1 u bins: 2 × 2 cells on a half grid, then half-unit bins in what's left.
        for (const n of s.drawer.halfGrid ? [2, 1] : [1]) {
          const occ = occupancy(withBlocked([...s.bins, ...added], mask), nx, ny);
          const free = (i: number, j: number) => i + n <= nx && j + n <= ny && occ.slice(i, i + n).every((col) => col.slice(j, j + n).every((c) => !c));
          for (let i = 0; i < nx; i++) {
            for (let j = 0; j < ny; j++) {
              if (!free(i, j)) continue;
              added.push({ id: newId(), x: i, y: j, opts: sanitizeBin({ ...s.newBin, unitsX: n, unitsY: n }) });
              for (let a = i; a < i + n; a++) for (let b = j; b < j + n; b++) occ[a][b] = '#new';
            }
          }
        }
        set({ bins: [...s.bins, ...added] });
        return added.length;
      },
      addBins: (add, o = {}) => {
        const s = get();
        const layout = computeLayout(s.drawer);
        const bed = usableBeds(s.setup);
        const r = mergeBins(layout, o.replace ? [] : s.bins, add, bed);
        const docs = synced(s);
        const names = docs.map((d) => d.name);
        const more: DrawerDoc[] = (o.newDrawers ?? [])
          .filter((list) => list.length)
          .map((list, i) => {
            const name = uniqueName(`Drawer ${docs.length + 1 + i}`, names);
            names.push(name);
            return { id: newId(), name, drawer: { ...s.drawer }, baseplate: { ...s.baseplate }, bins: mergeBins(layout, [], list, bed).bins };
          });
        if (!r.added.length && !more.length && !(o.replace && s.bins.length)) return [];
        const at = docs.findIndex((d) => d.id === s.activeDrawerId) + 1;
        history.checkpoint();
        set({
          bins: r.bins,
          drawers: more.length ? [...docs.slice(0, at), ...more, ...docs.slice(at)] : s.drawers,
          ui: { ...s.ui, selectedBinId: null, selectedBinIds: [] },
        });
        history.checkpoint();
        return r.added;
      },
      setFillList: (text) => {
        const s = get();
        const list = cleanFillList(text);
        const doc = s.drawers.find((d) => d.id === s.activeDrawerId);
        if (!doc || (doc.fillList ?? '') === list) return;
        const next = (d: DrawerDoc): DrawerDoc => {
          const { fillList: _, ...rest } = d;
          return list ? { ...rest, fillList: list } : rest;
        };
        // Remembered with the project, but typing a list isn't an edit to undo.
        history.silently(() => set({ drawers: s.drawers.map((d) => (d.id === s.activeDrawerId ? next(d) : d)) }));
      },

      addDrawer: (name, o = {}) => {
        const s = get();
        const id = newId();
        const docs = synced(s);
        // New drawers start with the current baseplate settings: magnets, connectors etc. are usually shared.
        const doc: DrawerDoc = {
          id,
          name: uniqueName(name?.trim() || (o.skadis ? 'Skådis board' : `Drawer ${docs.length + 1}`), docs.map((d) => d.name)),
          drawer: {
            ...DEFAULT_DRAWER,
            mode: s.drawer.mode,
            clearance: s.drawer.clearance,
            fill: s.drawer.fill,
            ...(s.drawer.halfGrid ? { halfGrid: true } : {}),
            // For a baseplate you have: given by its cells, and nothing of it prints.
            ...(o.haveBaseplate && !o.skadis ? { mode: 'grid' as const, haveBaseplate: true as const } : {}),
            // A pegboard built from tiles, one to start (geometry/skadis.ts).
            ...(o.skadis ? { enclosure: 'skadis' as const, skadis: { ...NEW_SKADIS } } : {}),
          },
          baseplate: { ...s.baseplate },
          bins: [],
        };
        set({
          drawers: [...docs, doc],
          activeDrawerId: id,
          drawer: doc.drawer,
          baseplate: doc.baseplate,
          bins: doc.bins,
          ui: { ...s.ui, selectedBinId: null, plate: -1 },
        });
        return id;
      },
      duplicateDrawer: (id) => {
        const s = get();
        const docs = synced(s);
        const src = docs.find((d) => d.id === id);
        if (!src) return s.activeDrawerId;
        const nid = newId();
        const copy: DrawerDoc = {
          ...structuredClone(src),
          id: nid,
          name: uniqueName(`${src.name} copy`, docs.map((d) => d.name)),
          bins: withNewIds(src.bins),
        };
        const at = docs.indexOf(src) + 1;
        set({
          drawers: [...docs.slice(0, at), copy, ...docs.slice(at)],
          activeDrawerId: nid,
          drawer: copy.drawer,
          baseplate: copy.baseplate,
          bins: copy.bins,
          ui: { ...s.ui, selectedBinId: null, plate: -1 },
        });
        return nid;
      },
      removeDrawer: (id) => {
        const s = get();
        const docs = synced(s);
        if (docs.length <= 1) return;
        const at = docs.findIndex((d) => d.id === id);
        if (at < 0) return;
        const rest = docs.filter((d) => d.id !== id);
        const next = id === s.activeDrawerId ? rest[Math.min(at, rest.length - 1)] : rest.find((d) => d.id === s.activeDrawerId)!;
        set({
          drawers: rest,
          activeDrawerId: next.id,
          drawer: next.drawer,
          baseplate: next.baseplate,
          bins: next.bins,
          printPick: s.printPick.filter((p) => p !== id),
          ui: id === s.activeDrawerId ? { ...s.ui, selectedBinId: null, plate: -1 } : s.ui,
        });
      },
      renameDrawer: (id, name) =>
        set((s) => ({ drawers: s.drawers.map((d) => (d.id === id ? { ...d, name: name.trim() || d.name } : d)) })),
      switchDrawer: (id) => {
        const s = get();
        if (id === s.activeDrawerId) return;
        const docs = synced(s);
        const next = docs.find((d) => d.id === id);
        if (!next) return;
        set({
          drawers: docs,
          activeDrawerId: id,
          drawer: next.drawer,
          baseplate: next.baseplate,
          bins: next.bins,
          ui: { ...s.ui, selectedBinId: null, plate: -1 },
        });
      },
      setPrintScope: (printScope, pick) => set((s) => ({ printScope, printPick: pick ?? s.printPick, ui: { ...s.ui, plate: -1 } })),

      setBinContents: (id, contents) => {
        const b = get().bins.find((x) => x.id === id);
        if (!b || sanitizeContents(contents) === (b.contents ?? '')) return;
        set((s) => ({ bins: s.bins.map((x) => (x.id === id ? withContents(x, contents) : x)) }));
      },
      setCompContents: (id, compKey, contents) => {
        const b = get().bins.find((x) => x.id === id);
        if (!b || !compKey || sanitizeContents(contents) === (b.compContents?.[compKey] ?? '')) return;
        set((s) => ({ bins: s.bins.map((x) => (x.id === id ? withCompContents(x, compKey, contents) : x)) }));
      },
      locateBin: (drawerId, binId) => {
        if (!get().drawers.some((d) => d.id === drawerId)) return;
        get().switchDrawer(drawerId);
        const s = get();
        if (binId && s.bins.some((b) => b.id === binId)) s.setUI({ tab: 'bins', binPane: 'drawer', selectedBinId: binId });
      },

      // Tool library. Placed bins hold copies of a tool, refreshed here in every drawer.
      addTool: (t) => {
        const tool = cleanTool({ ...t, id: t.id ?? newId() });
        if (!tool) throw new Error('A tool outline needs at least 3 points.');
        set((s) => ({ tools: [...s.tools.filter((x) => x.id !== tool.id), tool] }));
        return tool.id;
      },
      updateTool: (id, patch) => {
        const s = get();
        const cur = s.tools.find((t) => t.id === id);
        // Only re-normalize a new outline, so an unchanged one stays identical (and meshes stay cached).
        const next = cur && cleanTool({ ...cur, ...patch, id });
        if (!cur || !next) return;
        if (!patch.outline) next.outline = cur.outline;
        set({
          tools: s.tools.map((t) => (t.id === id ? next : t)),
          bins: syncToolInBins(s.bins, next),
          drawers: s.drawers.map((d) => {
            const bins = syncToolInBins(d.bins, next);
            return bins === d.bins ? d : { ...d, bins };
          }),
        });
      },
      removeTool: (id) =>
        set((s) => ({
          tools: s.tools.filter((t) => t.id !== id),
          bins: removeToolFromBins(s.bins, id),
          drawers: s.drawers.map((d) => {
            const bins = removeToolFromBins(d.bins, id);
            return bins === d.bins ? d : { ...d, bins };
          }),
        })),

      copyLayout: (from, to) => {
        const s = get();
        const src = typeof from === 'string' ? s.bins.find((b) => b.id === from)?.opts : from;
        const report: CopyLayoutReport = { copied: 0, dropped: [] };
        if (!src) return report;
        const want = new Map<string, Set<string>>();
        for (const t of to) {
          if (typeof from === 'string' && t.binId === from && t.drawerId === s.activeDrawerId) continue;
          if (!want.has(t.drawerId)) want.set(t.drawerId, new Set());
          want.get(t.drawerId)!.add(t.binId);
        }
        const apply = (doc: DrawerDoc): PlacedBin[] => {
          const ids = want.get(doc.id);
          if (!ids) return doc.bins;
          const grid = computeLayout(doc.drawer);
          return doc.bins.map((b) => {
            // Bins from elsewhere (lib/external.ts) have no walls of Gridfit's.
            if (!ids.has(b.id) || b.external) return b;
            let patch: Partial<BinOptions> = { divX: src.divX, divY: src.divY, layout: null };
            if (src.layout) {
              const fit = fitLayout(src.layout, binInnerSize(b.opts, binCellsAt(grid, b)));
              if (fit.dropped.length) report.dropped.push({ drawerId: doc.id, binId: b.id, walls: fit.dropped.length });
              patch = { layout: fit.layout };
            }
            report.copied++;
            // The target's per-compartment contents follow its new compartments.
            return carryContents(b, sanitizeBin({ ...b.opts, ...patch }));
          });
        };
        const bins = apply(activeDrawer(s));
        const drawers = s.drawers.map((d) => (d.id === s.activeDrawerId || !want.has(d.id) ? d : { ...d, bins: apply(d) }));
        if (!report.copied) return report;
        history.checkpoint();
        set({ bins, drawers });
        history.checkpoint();
        return report;
      },

      resetAll: () => set({ ...DEFAULT_PROJECT, ...DEFAULT_WORKSPACE, ui: { ...DEFAULT_UI, units: get().ui.units }, newBin: DEFAULT_BIN }),
      newProject: () => {
        const s = get();
        history.checkpoint();
        set({ ...DEFAULT_PROJECT, ...DEFAULT_WORKSPACE, setup: s.setup, ui: { ...DEFAULT_UI, units: s.ui.units } });
        history.checkpoint();
      },
      loadProject: (data) => {
        const p = (data ?? {}) as Partial<Store> & { app?: string };
        if (typeof p !== 'object' || (p.app !== undefined && p.app !== 'gridfit')) throw new Error('Not a Gridfit project file.');
        // Version 1 files hold a single drawer at the top level.
        const docs = Array.isArray(p.drawers) && p.drawers.length
          ? p.drawers.map(cleanDoc)
          : [cleanDoc({ id: FIRST_DRAWER_ID, name: 'Drawer 1', drawer: p.drawer, baseplate: p.baseplate, bins: p.bins }, 0)];
        const active = docs.find((d) => d.id === p.activeDrawerId) ?? docs[0];
        set((s) => ({
          drawers: docs,
          activeDrawerId: active.id,
          drawer: active.drawer,
          baseplate: active.baseplate,
          bins: active.bins,
          setup: cleanSetup(p.setup),
          include: { ...DEFAULT_PROJECT.include, ...p.include },
          newBin: sanitizeBin({ ...DEFAULT_BIN, ...p.newBin }),
          printScope: p.printScope === 'all' || p.printScope === 'pick' ? p.printScope : 'active',
          printPick: Array.isArray(p.printPick) ? p.printPick.map(String) : [],
          templates: mergeTemplates(s.templates, cleanTemplates(p.templates)),
          // Like templates: the file's tools join the library (same id = the file's version).
          tools: mergeTools(s.tools, cleanTools(p.tools)),
          printed: cleanPrinted(p.printed),
          onlyChanged: p.onlyChanged === true,
          wall: cleanWall(p.wall, docs),
          ui: { ...s.ui, selectedBinId: null, plate: -1 },
        }));
      },
    }),
    {
      name: 'gridfit-project',
      version: 2,
      partialize: persisted,
      // Version 1 had no drawer list; merge() below builds it from the top-level drawer.
      migrate: (persisted) => persisted as never,
      // Fill in fields added after the project was saved.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Store>;
        const drawer = cleanDrawer({ ...current.drawer, ...p.drawer });
        const baseplate = { ...current.baseplate, ...p.baseplate };
        const bins = cleanBins(p.bins ?? current.bins);
        let docs = Array.isArray(p.drawers) && p.drawers.length ? p.drawers.map(cleanDoc) : null;
        let activeDrawerId = String(p.activeDrawerId ?? FIRST_DRAWER_ID);
        if (!docs) docs = [{ id: activeDrawerId, name: 'Drawer 1', drawer, baseplate, bins }];
        if (!docs.some((d) => d.id === activeDrawerId)) activeDrawerId = docs[0].id;
        return {
          ...current,
          ...p,
          drawer,
          baseplate,
          bins,
          drawers: docs,
          activeDrawerId,
          setup: cleanSetup(p.setup, current.setup),
          include: { ...current.include, ...p.include },
          newBin: sanitizeBin({ ...current.newBin, ...p.newBin }),
          printScope: p.printScope ?? current.printScope,
          printPick: p.printPick ?? current.printPick,
          templates: cleanTemplates(p.templates ?? current.templates),
          tools: cleanTools(p.tools ?? current.tools),
          printed: cleanPrinted(p.printed ?? current.printed),
          onlyChanged: (p.onlyChanged ?? current.onlyChanged) === true,
          wall: cleanWall(p.wall, docs),
          // Saved before view state stopped being persisted: never come back with pieces spread apart.
          ui: { ...current.ui, ...p.ui, explode: false, plate: -1 },
        };
      },
    },
  ),
);

/**
 * Contents of a saved .gridfit.json file. Version 3: bins may be from
 * elsewhere (`external`, external.ts), and a saved file adds the bytes of their
 * meshes as `meshes` (imported/meshStore.ts projectWithMeshes); 1 and 2 load as
 * before.
 */
export function projectFile(s: Store) {
  return {
    app: 'gridfit',
    version: 3,
    ...projectOf(s),
    newBin: s.newBin,
    drawers: allDrawers(s),
    activeDrawerId: s.activeDrawerId,
    printScope: savedScope(s.printScope),
    printPick: s.printPick,
    templates: s.templates,
    tools: s.tools,
    printed: s.printed,
    onlyChanged: s.onlyChanged,
    ...(s.wall ? { wall: s.wall } : {}),
  };
}

/** The serializable project for the active drawer (what planJob needs). */
export function projectOf(s: Store): ProjectState {
  return { drawer: s.drawer, baseplate: s.baseplate, setup: s.setup, bins: s.bins, include: s.include };
}

/** Current display units plus formatters bound to them. */
export function useUnits() {
  const units = useStore((s) => s.ui.units);
  const precision = useStore((s) => s.ui.inchPrecision);
  return {
    units,
    precision,
    /** "20 1/8″" or "511.2 mm". */
    fmt: (mm: number, o: FormatOptions = {}) => formatLength(mm, units, { precision, ...o }),
    /** "20 1/8″ (511.2 mm)" in inch mode. */
    fmtBoth: (mm: number, o: FormatOptions = {}) => formatBoth(mm, units, { precision, ...o }),
  };
}

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

/** Keys that make up the active drawer; a drawer switch only moves them between here and `drawers`. */
const DRAWER_KEYS = new Set(['drawers', 'activeDrawerId', 'drawer', 'baseplate', 'bins']);

function sameFields(a: object, b: object) {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k as keyof typeof a], b[k as keyof typeof b]));
}

/** Same project data. Switching drawers isn't an edit, so it isn't an undo step of its own. */
function sameProject(a: Snapshot, b: Snapshot) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!DRAWER_KEYS.has(k) && !Object.is(a[k], b[k])) return false;
  const da = allDrawers(a as unknown as Store);
  const db = allDrawers(b as unknown as Store);
  return da.length === db.length && da.every((d, i) => sameFields(d, db[i]));
}

/** Undo/redo for everything autosave keeps except UI state. */
export const history = trackHistory(useStore, {
  keys: (s) => Object.keys(persisted(s)).filter((k) => k !== 'ui'),
  equal: sameProject,
  // Drop selected bins that the restored state doesn't have.
  afterRestore: (s) => {
    const sel = selectedIds(s.ui);
    const ids = sel.filter((id) => s.bins.some((b) => b.id === id));
    if (ids.length === sel.length) return null;
    const primary = ids.includes(s.ui.selectedBinId!) ? s.ui.selectedBinId : (ids[0] ?? null);
    return { ui: { ...s.ui, selectedBinId: primary, selectedBinIds: ids } };
  },
});
