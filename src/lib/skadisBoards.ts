/**
 * Skådis boards (drawer.enclosure 'skadis', geometry/skadis.ts): only this
 * much of their planning is on the first screen. The rest (skadisBoardPlan.ts:
 * the tiles, joints, mounting points, frame, ways to hang, the assembly map
 * and the drawer view, with geometry/skadis.ts and the attachments' slots)
 * loads with the first board: until it's in, a board plans bare (no tiles,
 * parts or warnings) and the app plans again once it has loaded
 * (subscribeSkadisBoards), as it does for openGrid boards (gridBoards.ts) and
 * the attachments' kinds (wall/ready.ts). The tests load it (tests/setup.ts).
 */
import type { EnclosurePart, EnclosurePlan, PieceEnclosure, planEnclosure } from './enclosures';
import type { BaseplateOptions } from './geometry/baseplate';
import type { MeshData, Wasm } from './geometry/kernel';
import type { GridLayout } from './layout/drawer';
import type { PrintSetup } from './layout/plan';

type Planner = (d: Parameters<typeof planEnclosure>[0], layout: GridLayout, setup: PrintSetup) => EnclosurePlan;

let planner: Planner | null = null;
let version = 0;
let loading: Promise<unknown> | null = null;
const listeners = new Set<() => void>();

/** Bumped when the planning has loaded: plan again. */
export const skadisBoardsVersion = () => version;
/** Whether boards plan in full yet. */
export const skadisBoardsReady = () => planner !== null;

export function subscribeSkadisBoards(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Load the boards' planning (once). */
export const loadSkadisBoards = () => (loading ??= import('./skadisBoardPlan'));

/** skadisBoardPlan.ts hands in its planner as it loads. */
export function setSkadisBoardPlanner(p: Planner): void {
  planner = p;
  version++;
  for (const l of listeners) l();
}

/** What a board takes of the drawer's baseplate options: nothing (no joints, pads or holes of its own). */
export const boardBaseplate = (o: BaseplateOptions): BaseplateOptions => ({
  ...o,
  connector: 'none',
  magnets: false,
  screws: false,
  pieceNumbers: false,
  pads: undefined,
});

/** A board's plan; a bare board until the planning has loaded (asking for it starts the load). */
export function planSkadisBoard(d: Parameters<Planner>[0], layout: GridLayout, setup: PrintSetup): EnclosurePlan {
  if (planner) return planner(d, layout, setup);
  void loadSkadisBoards();
  return {
    kind: 'skadis',
    pieceLayout: layout,
    baseplate: boardBaseplate(d.baseplate),
    plan: { pieces: [], plates: [], cols: 0, rows: 0 },
    piece: () => null,
    parts: [],
    views: [],
    steps: [],
    warnings: [],
    binNotes: [],
    room: Infinity,
    scene: { kind: 'skadis', pieceAt: {}, items: [], shift: { x: 0, y: 0 }, showBins: false, outline: false, seat: 0, info: {} },
  };
}

/** The boards' mesh builders (geometry/skadisBuild.ts). */
export interface SkadisBoardBuilders {
  piece(w: Wasm, e: PieceEnclosure): MeshData;
  part(w: Wasm, p: EnclosurePart): MeshData;
}

let builders: SkadisBoardBuilders | null = null;

/** Whoever builds meshes hands them in: the geometry worker (worker/meshes.ts), the tests (tests/setup.ts). */
export function setSkadisBoardBuilders(b: SkadisBoardBuilders): void {
  builders = b;
}

export function skadisBoardBuilders(): SkadisBoardBuilders {
  if (!builders) throw new Error('Skådis board builders not set (setSkadisBoardBuilders with geometry/skadisBuild.ts, as worker/meshes.ts does).');
  return builders;
}
