/**
 * openGrid and Multiboard boards (drawer.enclosure 'opengrid' / 'multiboard'):
 * boards for those systems' own snaps and accessories, split into tiles that
 * fit the bed (geometry/opengrid.ts, geometry/multiboard.ts).
 *
 * Only this much of them is on the first screen. Their planning
 * (gridBoardPlan.ts) loads with the first such board: until it's in, a board
 * plans empty and the app plans again once it has loaded (subscribeGridBoards).
 * Their geometry is handed to the mesh builders by whoever builds meshes (the
 * geometry worker, the tests), as the attachments' is (project.ts setWallBuilders).
 */
import type { EnclosurePart, EnclosurePlan, PieceEnclosure, planEnclosure } from './enclosures';
import type { GridLayout } from './layout/drawer';
import type { PrintSetup } from './layout/plan';
import type { MeshData, Wasm } from './geometry/kernel';

export type GridBoardKind = 'opengrid' | 'multiboard';

/** What each board is called. */
export const GRID_BOARD_NAMES: Record<GridBoardKind, string> = { opengrid: 'openGrid board', multiboard: 'Multiboard board' };

export const isGridBoard = (k: unknown): k is GridBoardKind => k === 'opengrid' || k === 'multiboard';

/** A board in numbers, for the sidebar (EnclosureScene.info.grid). */
export interface GridBoardInfo {
  kind: GridBoardKind;
  /** Squares across and up, and their pitch, mm. */
  cols: number;
  rows: number;
  pitch: number;
  /** The board, mm. */
  boardW: number;
  boardH: number;
  T: number;
  tiles: number;
  tileCols: number;
  tileRows: number;
  /** Largest tile as printed, mm. */
  tileW: number;
  tileD: number;
  connectors: number;
  screws: number;
  /** Multiboard: large holes and peg holes. */
  holes: number;
  pegs: number;
}

type Planner = (d: Parameters<typeof planEnclosure>[0], layout: GridLayout, setup: PrintSetup) => EnclosurePlan;

let planner: Planner | null = null;
let version = 0;
let loading: Promise<unknown> | null = null;
const listeners = new Set<() => void>();

/** Bumped when the planning has loaded: plan again. */
export const gridBoardsVersion = () => version;

export function subscribeGridBoards(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Load the boards' planning (once). */
export const loadGridBoards = () => (loading ??= import('./gridBoardPlan'));

/** gridBoardPlan.ts hands in its planner as it loads. */
export function setGridBoardPlanner(p: Planner): void {
  planner = p;
  version++;
  for (const l of listeners) l();
}

/** A board's plan; an empty board until the planning has loaded (asking for it starts the load). */
export function planGridBoard(d: Parameters<Planner>[0], layout: GridLayout, setup: PrintSetup): EnclosurePlan {
  if (planner) return planner(d, layout, setup);
  void loadGridBoards();
  const kind = d.drawer.enclosure as GridBoardKind;
  return {
    kind,
    pieceLayout: layout,
    baseplate: d.baseplate,
    plan: { pieces: [], plates: [], cols: 0, rows: 0 },
    piece: () => null,
    parts: [],
    views: [],
    steps: [],
    warnings: [],
    binNotes: [],
    room: Infinity,
    scene: { kind, pieceAt: {}, items: [], shift: { x: 0, y: 0 }, showBins: false, outline: false, seat: 0, info: {} },
  };
}

/** The boards' mesh builders (geometry/gridBoardBuild.ts). */
export interface GridBoardBuilders {
  piece(w: Wasm, e: PieceEnclosure): MeshData;
  part(w: Wasm, p: EnclosurePart): MeshData;
}

let builders: GridBoardBuilders | null = null;

export function setGridBoardBuilders(b: GridBoardBuilders): void {
  builders = b;
}

export function gridBoardBuilders(): GridBoardBuilders {
  if (!builders) throw new Error('Board builders not set (setGridBoardBuilders).');
  return builders;
}
