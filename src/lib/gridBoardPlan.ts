/**
 * openGrid and Multiboard boards' plans (enclosures.ts EnclosurePlan): the
 * tiles are the floor pieces, openGrid's connectors extra parts, and the
 * drawer view shows the board lying face up as it hangs (the wall's up is the
 * view's back). It hands its planner to gridBoards.ts as it loads, which the
 * app does with the first such board.
 */
import type { EnclosureHardware, EnclosurePart, EnclosurePartPlan, EnclosurePlan, EnclosureSceneItem, PieceEnclosure } from './enclosures';
import { GRID_BOARD_NAMES, setGridBoardPlanner, type GridBoardInfo, type GridBoardKind } from './gridBoards';
import { clearAreas, packPlates, plateBed } from './layout/pack';
import type { GridLayout } from './layout/drawer';
import type { BaseplatePlan, PrintSetup } from './layout/plan';
import type { PieceDef } from './layout/split';
import type { Vec3 } from './geometry/kernel';
import type { BedArea, GridTile } from './geometry/gridTiles';
import {
  OPENGRID,
  connectorHoleZ,
  openGridConnectorPart,
  openGridConnectorSize,
  openGridTileSize,
  openGridTileSpecs,
  planOpenGrid,
  sanitizeOpenGrid,
  type OpenGridOptions,
} from './geometry/opengrid';
import { MULTIBOARD, multiboardTileSize, multiboardTileSpecs, planMultiboard, sanitizeMultiboard, type MultiboardOptions } from './geometry/multiboard';

type Input = Parameters<typeof import('./enclosures').planEnclosure>[0];

const r1 = (v: number) => Math.round(v * 10) / 10;

/** A tile as a floor piece. */
const pieceOf = (t: GridTile, P: number): PieceDef => ({
  id: t.id,
  col: t.col,
  row: t.row,
  x0: t.c0 * P,
  y0: t.r0 * P,
  x1: t.c1 * P,
  y1: t.r1 * P,
  cells: { x0: t.c0, x1: t.c1, y0: t.r0, y1: t.r1 },
  outer: { left: t.outer.left, right: t.outer.right, front: t.outer.bottom, back: t.outer.top },
});

/** Screws long enough to go through the board into a wall plug. */
const screwLength = (T: number) => Math.ceil((T + 25) / 5) * 5;

/** What every board has in common: pieces, plates, the scene, the sidebar's numbers. */
function boardPlan(
  d: Input,
  layout: GridLayout,
  setup: PrintSetup,
  b: {
    kind: GridBoardKind;
    P: number;
    T: number;
    tiles: GridTile[];
    tileCols: number;
    tileRows: number;
    cols: number;
    rows: number;
    sizes: { w: number; d: number; h: number }[];
    /** Each tile's spec and screws (identical tiles share a mesh). */
    enclosures: (PieceEnclosure & { kind: GridBoardKind })[];
    parts: EnclosurePartPlan[];
    items: EnclosureSceneItem[];
    steps: string[];
    warnings: string[];
    error?: string;
    info: Pick<GridBoardInfo, 'connectors' | 'screws' | 'holes' | 'pegs'>;
    map: (info: GridBoardInfo) => string;
  },
): EnclosurePlan {
  const pieces = b.tiles.map((t) => pieceOf(t, b.P));
  const byId = new Map(pieces.map((p, i) => [p.id, i]));
  const plates = packPlates(
    pieces.map((p, i) => ({ key: `piece:${p.id}`, w: b.sizes[i].w, d: b.sizes[i].d })),
    { ...plateBed(setup), spacing: setup.spacing, nest: setup.nest },
  ).plates;
  const plan: BaseplatePlan = { pieces, plates, cols: b.tileCols, rows: b.tileRows, ...(b.error ? { error: b.error } : {}) };
  const pieceAt: Record<number, Vec3> = {};
  for (const p of pieces) pieceAt[p.id] = [p.x0, p.y0, 0];
  const W = b.cols * b.P;
  const H = b.rows * b.P;
  const name = GRID_BOARD_NAMES[b.kind];
  const info: GridBoardInfo = {
    kind: b.kind,
    cols: b.cols,
    rows: b.rows,
    pitch: b.P,
    boardW: W,
    boardH: H,
    T: b.T,
    tiles: pieces.length,
    tileCols: b.tileCols,
    tileRows: b.tileRows,
    tileW: b.sizes.length ? r1(Math.max(...b.sizes.map((s) => s.w))) : 0,
    tileD: b.sizes.length ? r1(Math.max(...b.sizes.map((s) => s.d))) : 0,
    ...b.info,
  };
  return {
    kind: b.kind,
    pieceLayout: layout,
    // Nothing of the baseplate's: no joints, pads or holes of its own.
    baseplate: { ...d.baseplate, connector: 'none', magnets: false, screws: false, pieceNumbers: false, pads: undefined },
    plan,
    piece: (p) => {
      const i = byId.get(p.id);
      if (i === undefined) return null;
      const enclosure = b.enclosures[i];
      return { enclosure, ...b.sizes[i], name: `${name.replace(' board', '')} tile ${p.id}`, meshKey: `${b.kind}|${JSON.stringify(enclosure.tile)}` };
    },
    parts: b.parts,
    views: [],
    steps: b.steps,
    warnings: [...b.warnings, ...(b.error ? [b.error] : [])],
    binNotes: [],
    room: Infinity,
    plateName: name,
    scene: {
      kind: b.kind,
      pieceAt,
      items: b.items,
      shift: { x: 0, y: 0 },
      showBins: false,
      outline: false,
      seat: b.T,
      box: { x0: 0, y0: 0, x1: W, y1: H, h: b.T },
      info: { grid: info },
    },
    map: b.map(info),
  };
}

/** The tiles as numbered, seen from the front (top row first). */
function tileMap(tiles: GridTile[], rows: number): string[] {
  const out: string[] = [];
  for (let r = rows - 1; r >= 0; r--) {
    const row = tiles.filter((t) => t.row === r).sort((a, b) => a.col - b.col);
    out.push('  ' + row.map((t) => `[${String(t.id).padStart(3)} ]`).join(' '));
  }
  return out;
}

function mapText(title: string, info: GridBoardInfo, head: string[], tiles: GridTile[], steps: string[], tail: string[]): string {
  const P = info.pitch;
  const lines = [
    title,
    '='.repeat(40),
    ...head,
    `Tiles: ${tiles.length} (${info.tileCols} × ${info.tileRows}), front up as on the wall:`,
    ...tileMap(tiles, info.tileRows),
  ];
  lines.push('', 'TILES', '-'.repeat(40));
  for (const t of tiles)
    lines.push(
      `Tile ${t.id}: ${t.c1 - t.c0} × ${t.r1 - t.r0} squares (${(t.c1 - t.c0) * P} × ${(t.r1 - t.r0) * P} mm), ${t.c0 * P} mm from the left, ${t.r0 * P} mm up`,
    );
  if (steps.length) lines.push('', ...steps);
  lines.push(...tail, '');
  return lines.join('\n') + '\n';
}

function planOpenGridBoard(d: Input, layout: GridLayout, setup: PrintSetup, areas: BedArea[]): EnclosurePlan {
  const o: OpenGridOptions = sanitizeOpenGrid(d.drawer.opengrid);
  const plan = planOpenGrid(o, areas);
  const specs = openGridTileSpecs(plan, o);
  const P = OPENGRID.pitch;
  const T = plan.T;
  const long = screwLength(T);
  const enclosures = specs.map((tile): PieceEnclosure & { kind: 'opengrid' } => {
    const hardware: EnclosureHardware[] = tile.screws.length
      ? [
          {
            item: `Countersunk screws ⌀4 × ${long} mm or longer (openGrid board)`,
            count: tile.screws.length,
            note: 'into the wall, with plugs where it needs them',
          },
        ]
      : [];
    return { kind: 'opengrid', origin: [0, 0, 0], cuts: [], tile, ...(hardware.length ? { hardware } : {}) };
  });
  const parts: EnclosurePartPlan[] = [];
  const items: EnclosureSceneItem[] = [];
  if (plan.connectors.length) {
    const connector = openGridConnectorPart(o);
    const part: EnclosurePart = { kind: 'openGridConnector', connector };
    const meshKey = `opengridconnector|${JSON.stringify(connector)}`;
    const size = openGridConnectorSize(connector);
    const z = connectorHoleZ(o.variant === 'lite') + connector.c;
    const L = size.w / 2;
    const R = size.d / 2;
    plan.connectors.forEach((c, i) => {
      parts.push({ key: `connector:${i + 1}`, name: `openGrid connector ${i + 1}`, kind: 'enclosure', part, meshKey, ...size, group: 'openGrid connectors' });
      // In its holes, spread with the tile left of (or under) its seam.
      const tile = plan.tiles.find((t) =>
        c.dir === 'x' ? t.c1 * P === c.x && c.y > t.r0 * P && c.y < t.r1 * P : t.r1 * P === c.y && c.x > t.c0 * P && c.x < t.c1 * P,
      );
      const at = c.dir === 'x' ? { x: c.x - L, y: c.y - R } : { x: c.x - R, y: c.y - L };
      items.push({
        id: `opengrid-connector-${i}`,
        meshKey,
        ...at,
        z,
        ...size,
        ...(c.dir === 'y' ? { turn: [0, 0, 90] as [number, number, number] } : {}),
        role: 'joint',
        when: 'always',
        ...(tile ? { col: tile.col, row: tile.row } : {}),
      });
    });
  }
  const n = plan.tiles.length;
  const steps: string[] = [];
  if (n) {
    steps.push(`openGrid board: ${n} tile${n === 1 ? '' : 's'}, laid out as on this map, front up.`);
    if (plan.connectors.length)
      steps.push(
        `Push a connector into each of the ${plan.connectors.length} holes along one side of each seam (they click in), then press the next tile on from the front, fingers on both tiles.`,
      );
    if (plan.screws.length)
      steps.push(`Screw it to the wall through the ${plan.screws.length} countersunk holes at the grid crossings, with wall plugs where the wall needs them.`);
    steps.push(
      o.variant === 'full'
        ? 'openGrid snaps push into the squares from either face; openGrid accessories (and Multiconnect ones on its snaps) go on them.'
        : 'openGrid snaps (lite ones, 3.4 mm) push into the squares; openGrid accessories (and Multiconnect ones on its snaps) go on them.',
    );
  }
  return boardPlan(d, layout, setup, {
    kind: 'opengrid',
    P,
    T,
    tiles: plan.tiles,
    tileCols: plan.tileCols,
    tileRows: plan.tileRows,
    cols: plan.cols,
    rows: plan.rows,
    sizes: specs.map(openGridTileSize),
    enclosures,
    parts,
    items,
    steps,
    warnings: plan.warnings,
    ...(plan.error ? { error: plan.error } : {}),
    info: { connectors: plan.connectors.length, screws: plan.screws.length, holes: plan.cols * plan.rows, pegs: 0 },
    map: (info) =>
      mapText(
        'OPENGRID BOARD ASSEMBLY MAP',
        info,
        [
          `Board: ${info.cols} × ${info.rows} squares of ${P} mm: ${info.boardW} × ${info.boardH} mm, ${o.variant === 'full' ? 'Full' : 'Lite'} (${T} mm thick)${o.test ? ' (a test tile)' : ''}`,
          `Connectors: ${info.connectors}`,
        ],
        plan.tiles,
        steps,
        info.screws ? [`Screws: ⌀4 countersunk, ${long} mm or longer.`] : [],
      ),
  });
}

function planMultiboardBoard(d: Input, layout: GridLayout, setup: PrintSetup, areas: BedArea[]): EnclosurePlan {
  const o: MultiboardOptions = sanitizeMultiboard(d.drawer.multiboard);
  const plan = planMultiboard(o, areas);
  const specs = multiboardTileSpecs(plan, o);
  const P = MULTIBOARD.pitch;
  const long = screwLength(plan.T);
  const enclosures = specs.map((tile): PieceEnclosure & { kind: 'multiboard' } => {
    const hardware: EnclosureHardware[] = tile.screws.length
      ? [
          {
            item: `Countersunk screws ⌀${o.screw} × ${long} mm or longer (Multiboard board)`,
            count: tile.screws.length,
            note: 'into the wall, with plugs where it needs them',
          },
        ]
      : [];
    return { kind: 'multiboard', origin: [0, 0, 0], cuts: [], tile, ...(hardware.length ? { hardware } : {}) };
  });
  const n = plan.tiles.length;
  const steps: string[] = [];
  if (n) {
    steps.push(`Multiboard board: ${n} tile${n === 1 ? '' : 's'}, laid out as on this map, front up.`);
    if (n > 1) steps.push('Fit the teeth along each tile’s right and top edges into the notches of the tile next to it.');
    if (plan.screws.length)
      steps.push(`Screw each tile to the wall through its countersunk peg holes (${plan.screws.length} in all), with wall plugs where the wall needs them.`);
    steps.push(
      `Multiboard snaps click into the large holes${o.threads ? ', big-thread parts screw into them' : ''}; pegboard hooks go in the peg holes${o.pegThreads ? ', small-thread parts screw into them' : ''}.`,
    );
  }
  return boardPlan(d, layout, setup, {
    kind: 'multiboard',
    P,
    T: plan.T,
    tiles: plan.tiles,
    tileCols: plan.tileCols,
    tileRows: plan.tileRows,
    cols: plan.cols,
    rows: plan.rows,
    sizes: specs.map(multiboardTileSize),
    enclosures,
    parts: [],
    items: [],
    steps,
    warnings: plan.warnings,
    ...(plan.error ? { error: plan.error } : {}),
    info: { connectors: 0, screws: plan.screws.length, holes: plan.holes, pegs: plan.pegs },
    map: (info) =>
      mapText(
        'MULTIBOARD BOARD ASSEMBLY MAP',
        info,
        [
          `Board: ${info.cols} × ${info.rows} squares of ${P} mm: ${info.boardW} × ${info.boardH} mm, ${plan.T} mm thick${o.test ? ' (a test tile)' : ''}`,
          `Holes: ${info.holes} large (${o.hole} mm across the flats${o.threads ? ', threaded' : ''}), ${info.pegs} peg holes (⌀${o.peg}${o.pegThreads ? ', threaded' : ''})`,
          'Dimensions measured, not published: check one tile with your snaps first.',
        ],
        plan.tiles,
        steps,
        info.screws ? [`Screws: ⌀${o.screw} countersunk, ${long} mm or longer.`] : [],
      ),
  });
}

/** A board's plan for the space on the wall (drawer.opengrid / drawer.multiboard). */
export function planGridBoard(d: Input, layout: GridLayout, setup: PrintSetup): EnclosurePlan {
  const areas = clearAreas({ ...plateBed(setup), spacing: setup.spacing }).map((a) => ({ w: a.w, d: a.d }));
  return d.drawer.enclosure === 'multiboard' ? planMultiboardBoard(d, layout, setup, areas) : planOpenGridBoard(d, layout, setup, areas);
}

setGridBoardPlanner(planGridBoard);
