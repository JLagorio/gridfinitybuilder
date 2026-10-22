/**
 * openGrid boards (opengrid.world): a 28 mm grid of square openings that
 * openGrid's snaps push into, as tiles that fit the bed, with the connectors
 * that join them and screw holes to put them up. The numbers are openGrid's
 * own (the board is David D's), from its documentation (openGrid-3D/
 * openGrid-docs on GitHub: guides/board.mdx, guides/snaps.mdx) and its tile
 * generator (AndyLevesque/QuackWorks, openGrid/openGrid.scad); the snaps'
 * from the community snap library (mitufy/opengrid-projects,
 * lib/opengrid_base.scad). The geometry is built here from those numbers.
 *
 * - Full boards are 6.8 mm thick and take snaps from either face; Lite boards
 *   are 4 mm, the front 4 mm of a full one (lite snaps are 3.4 mm), flat on the
 *   wall.
 * - Round each 28 mm square a frame, half of the 1.6 mm wall between two
 *   squares: 0.8 mm through the middle, 1.5 at a lip 2.4 mm deep from each
 *   face (1 mm straight, then a 1 mm step back to the wall), its edge
 *   chamfered 0.4 at the face. So the opening is 25 mm square at the lips and
 *   26.4 behind them: a 24.8 mm snap passes the lips and its latches catch
 *   behind them.
 * - At every grid crossing a square turned 45°, 11.14 mm a side, its faces
 *   chamfered 1.4 at each face: the openings' corners. Screws go through
 *   these (⌀4.1, the head ⌀7.2 sunk 1 mm, 90° countersunk); the board's
 *   outer corners are cut 4.2 mm each way.
 * - Seams run between squares. Along each seam, at every crossing but the
 *   tile's corners, a connector hole: a round-ended slot ⌀5.2, 5.1 mm into
 *   the tile, its mouth pinched to 4.8 (circles r 2.7 either side) so the
 *   connector clicks in; 2.4 mm high, in the middle of a full board, 1 mm
 *   under a lite one's front. The connectors are the two holes back to back,
 *   a clearance smaller all round, and print flat.
 * Tiles print as they hang, back on the bed: every overhang is 45° or less.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec2, type Wasm } from './kernel';
import { cylinderAt, loftRings } from './shapes';
import { bool, int, pick, r3, splitGrid, tileScrews, type BedArea, type GridFit, type GridScrews, type GridTile } from './gridTiles';

export type OpenGridVariant = 'full' | 'lite';

export interface OpenGridOptions {
  variant: OpenGridVariant;
  /** Squares across and up. */
  cols: number;
  rows: number;
  /** Connector holes in the seams, and the connectors that join the tiles. */
  connectors: boolean;
  screws: GridScrews;
  /** Squares between screws, about ('grid'). */
  screwEvery: number;
  /** The board's outer corners cut off. */
  chamfer: boolean;
  /** How the connectors fit their holes. */
  fit: GridFit;
  /** Most squares a tile has each way (0: as many as the bed takes). */
  maxTile: number;
  /** Print one 2 × 2 tile, its holes and a connector, to check the fit first. */
  test: boolean;
}

export const DEFAULT_OPENGRID: OpenGridOptions = {
  variant: 'lite',
  cols: 12,
  rows: 8,
  connectors: true,
  screws: 'corners',
  screwEvery: 3,
  chamfer: true,
  fit: 'normal',
  maxTile: 0,
  test: false,
};

/** openGrid's numbers, mm (see the top of this file). */
export const OPENGRID = {
  pitch: 28,
  full: 6.8,
  lite: 4,
  wall: 0.8,
  lip: 1.5,
  lipDepth: 2.4,
  lipStep: 1,
  faceChamfer: 0.4,
  /** The squares at the crossings: half their side (11.14 / 2), and their faces' chamfer. */
  node: Math.SQRT1_2 * 4.2 + 2.6,
  nodeChamfer: 1.4,
  corner: 4.2,
  /** Connector holes: the slot's radius, how deep it goes and where its round end's centre is, the pinch circles (radius, off the slot's middle), the mouth's half width, its flare, height, and how far under a lite board's front. */
  hole: { r: 2.6, depth: 5.1, end: 2.5, pinchR: 2.7, pinchY: 5.1, mouth: 2.4, flare: 0.25, h: 2.4, liteTop: 1 },
  screw: { d: 4.1, head: 7.2, inset: 1 },
  /** openGrid's snaps: their size, their corners' cut each way, a lite one's thickness, how far their latches stand out. */
  snap: { w: 24.8, corner: (2.7 + Math.SQRT1_2) * Math.SQRT2, lite: 3.4, latch: 0.4 },
} as const;

/** Clearance a side between a connector and its holes, by fit. */
export const OPENGRID_FIT: Record<GridFit, number> = { snug: 0.05, normal: 0.1, loose: 0.15 };

export function sanitizeOpenGrid(raw: unknown): OpenGridOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_OPENGRID;
  return {
    variant: pick(r.variant, ['full', 'lite'] as const, d.variant),
    cols: int(r.cols, 1, 80, d.cols),
    rows: int(r.rows, 1, 80, d.rows),
    connectors: bool(r.connectors, d.connectors),
    screws: pick(r.screws, ['corners', 'grid', 'none'] as const, d.screws),
    screwEvery: int(r.screwEvery, 1, 20, d.screwEvery),
    chamfer: bool(r.chamfer, d.chamfer),
    fit: pick(r.fit, ['snug', 'normal', 'loose'] as const, d.fit),
    maxTile: int(r.maxTile, 0, 40, d.maxTile),
    test: bool(r.test, d.test),
  };
}

export const openGridThickness = (o: Pick<OpenGridOptions, 'variant'>) => (o.variant === 'full' ? OPENGRID.full : OPENGRID.lite);

/** A connector across a seam: the crossing it sits on (board mm, from the bottom left), lying across an upright seam ('x') or a level one ('y'). */
export interface OpenGridConnector {
  x: number;
  y: number;
  dir: 'x' | 'y';
}

export interface OpenGridPlan {
  /** Squares across and up (a test tile: 2 × 2). */
  cols: number;
  rows: number;
  T: number;
  tiles: GridTile[];
  tileCols: number;
  tileRows: number;
  connectors: OpenGridConnector[];
  /** Screws (board mm) and the tile each goes through. */
  screws: { x: number; y: number; tile: number }[];
  warnings: string[];
  error?: string;
}

/** Plan a board on the bed areas it prints on. */
export function planOpenGrid(o: OpenGridOptions, areas: BedArea[]): OpenGridPlan {
  const P = OPENGRID.pitch;
  const cols = o.test ? 2 : o.cols;
  const rows = o.test ? 2 : o.rows;
  const split = splitGrid(cols, rows, P, areas, { reach: 0, max: o.maxTile });
  const warnings: string[] = [];
  const connectors: OpenGridConnector[] = [];
  const screws: OpenGridPlan['screws'] = [];
  let unjoined = false;
  let bare = 0;
  for (const t of split.tiles) {
    if (o.connectors && !t.outer.right) {
      for (let j = t.r0 + 1; j < t.r1; j++) connectors.push({ x: t.c1 * P, y: j * P, dir: 'x' });
      if (t.r1 - t.r0 < 2) unjoined = true;
    }
    if (o.connectors && !t.outer.top) {
      for (let i = t.c0 + 1; i < t.c1; i++) connectors.push({ x: i * P, y: t.r1 * P, dir: 'y' });
      if (t.c1 - t.c0 < 2) unjoined = true;
    }
    const mine = tileScrews(t.c1 - t.c0, t.r1 - t.r0, o.screws, o.screwEvery);
    if (o.screws !== 'none' && !mine.length) bare++;
    for (const [i, j] of mine) screws.push({ x: (t.c0 + i) * P, y: (t.r0 + j) * P, tile: t.id });
  }
  if (unjoined) warnings.push('Tiles one square wide or high have no connector holes along their long sides: those seams aren’t joined.');
  if (bare) warnings.push(`${bare} tile${bare === 1 ? ' is' : 's are'} one square wide or high: no room for a screw in ${bare === 1 ? 'it' : 'them'}.`);
  return {
    cols,
    rows,
    T: openGridThickness(o),
    tiles: split.tiles,
    tileCols: split.cols,
    tileRows: split.rows,
    connectors,
    screws,
    warnings,
    ...(split.error ? { error: split.error } : {}),
  };
}

export type GridSide = 'left' | 'right' | 'bottom' | 'top';

/** One tile, as the geometry worker builds it (tile mm, from its bottom left). */
export interface OpenGridTileSpec {
  lite: boolean;
  /** Squares across and up. */
  w: number;
  h: number;
  /** Connector holes: the side, and how far along it. */
  holes: { side: GridSide; at: number }[];
  screws: Vec2[];
  /** The board's corners on this tile, cut off. */
  corners: ('bl' | 'br' | 'tl' | 'tr')[];
}

export function openGridTileSpecs(plan: OpenGridPlan, o: OpenGridOptions): OpenGridTileSpec[] {
  const P = OPENGRID.pitch;
  return plan.tiles.map((t) => {
    const holes: OpenGridTileSpec['holes'] = [];
    if (o.connectors) {
      for (let j = 1; j < t.r1 - t.r0; j++) {
        if (!t.outer.left) holes.push({ side: 'left', at: j * P });
        if (!t.outer.right) holes.push({ side: 'right', at: j * P });
      }
      for (let i = 1; i < t.c1 - t.c0; i++) {
        if (!t.outer.bottom) holes.push({ side: 'bottom', at: i * P });
        if (!t.outer.top) holes.push({ side: 'top', at: i * P });
      }
    }
    const corners: OpenGridTileSpec['corners'] = [];
    if (o.chamfer) {
      if (t.outer.left && t.outer.bottom) corners.push('bl');
      if (t.outer.right && t.outer.bottom) corners.push('br');
      if (t.outer.left && t.outer.top) corners.push('tl');
      if (t.outer.right && t.outer.top) corners.push('tr');
    }
    return {
      lite: o.variant === 'lite',
      w: t.c1 - t.c0,
      h: t.r1 - t.r0,
      holes,
      screws: plan.screws.filter((s) => s.tile === t.id).map((s) => [r3(s.x - t.c0 * P), r3(s.y - t.r0 * P)] as Vec2),
      corners,
    };
  });
}

export const openGridTileSize = (t: OpenGridTileSpec) => ({ w: t.w * OPENGRID.pitch, d: t.h * OPENGRID.pitch, h: t.lite ? OPENGRID.lite : OPENGRID.full });

/** A connector, by the fit: its clearance a side and its height. */
export interface OpenGridConnectorPart {
  c: number;
  h: number;
}

export const openGridConnectorPart = (o: Pick<OpenGridOptions, 'fit'>): OpenGridConnectorPart => {
  const c = OPENGRID_FIT[o.fit];
  return { c, h: r3(OPENGRID.hole.h - 2 * c) };
};

/** As printed: along x, flat. */
export const openGridConnectorSize = (p: OpenGridConnectorPart) => ({ w: r3(2 * (OPENGRID.hole.depth - p.c)), d: r3(2 * (OPENGRID.hole.r - p.c)), h: p.h });

/** Where a tile's connector holes are, up from its back (z0 to z0 + 2.4). */
export const connectorHoleZ = (lite: boolean) => (lite ? OPENGRID.lite - OPENGRID.hole.liteTop - OPENGRID.hole.h : OPENGRID.full / 2 - OPENGRID.hole.h / 2);

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * A full board's opening at height z (0 at the back): half its size and its
 * corners' cut (|x| + |y| ≤ k, from the square's middle). Both are straight
 * lines between the profile's corners, so the openings loft exactly.
 */
function openingAt(z: number): { a: number; k: number } {
  const G = OPENGRID;
  const T = G.full;
  const zs = [0, G.faceChamfer, G.lipDepth - G.lipStep, G.lipDepth, T - G.lipDepth, T - G.lipDepth + G.lipStep, T - G.faceChamfer, T];
  const ins = [G.lip - G.faceChamfer, G.lip, G.lip, G.wall, G.wall, G.lip, G.lip, G.lip - G.faceChamfer];
  let i = 0;
  while (i < zs.length - 2 && z > zs[i + 1]) i++;
  const f = Math.min(1, Math.max(0, (z - zs[i]) / (zs[i + 1] - zs[i])));
  const inset = ins[i] + (ins[i + 1] - ins[i]) * f;
  const node = G.node - Math.max(0, G.nodeChamfer - z, z - (T - G.nodeChamfer));
  return { a: G.pitch / 2 - inset, k: G.pitch - node * Math.SQRT2 };
}

/** Heights the opening's profile turns at (a full board's), from z0 to z1. */
function openingKnots(z0: number, z1: number): number[] {
  const G = OPENGRID;
  const T = G.full;
  const all = [
    0,
    G.faceChamfer,
    G.lipDepth - G.lipStep,
    G.lipDepth,
    T - G.lipDepth,
    T - G.lipDepth + G.lipStep,
    T - G.faceChamfer,
    T,
    G.nodeChamfer,
    T - G.nodeChamfer,
    z0,
    z1,
  ];
  return [...new Set(all.map(r3))].filter((z) => z >= z0 - 1e-9 && z <= z1 + 1e-9).sort((a, b) => a - b);
}

/** A square with its corners cut (|x| + |y| ≤ k), CCW, round (cx, cy). */
export function octagon(cx: number, cy: number, a: number, k: number): Vec2[] {
  const e = k - a;
  return [
    [cx + a, cy - e],
    [cx + a, cy + e],
    [cx + e, cy + a],
    [cx - e, cy + a],
    [cx - a, cy + e],
    [cx - a, cy - e],
    [cx - e, cy - a],
    [cx + e, cy - a],
  ];
}

/** The opening through one square of a tile, centred on the origin, reaching 1 mm past both faces. */
function opening(w: Wasm, lite: boolean): Manifold {
  const T = lite ? OPENGRID.lite : OPENGRID.full;
  // A lite board is the front of a full one.
  const z0 = OPENGRID.full - T;
  const zs = openingKnots(z0, OPENGRID.full);
  const rings = zs.map((z) => {
    const { a, k } = openingAt(z);
    return octagon(0, 0, a, k);
  });
  const at = zs.map((z) => z - z0);
  return loftRings(w, [rings[0], ...rings, rings[rings.length - 1]], [-1, ...at, T + 1]);
}

/** Half the connector hole's width at u in from the tile's edge (0 to its depth). */
function holeHalf(u: number): number {
  const H = OPENGRID.hole;
  const pinchEnd = Math.sqrt(H.pinchR ** 2 - (H.pinchY - H.r) ** 2);
  if (u < pinchEnd) return H.pinchY - Math.sqrt(H.pinchR ** 2 - u * u);
  if (u <= H.end) return H.r;
  return Math.sqrt(Math.max(0, H.r ** 2 - (u - H.end) ** 2));
}

/** The top half of a slot's outline from its mouth (u = 0) to its tip, `c` smaller all round. */
function slotHalf(c: number, mouth: boolean): Vec2[] {
  const H = OPENGRID.hole;
  const pinchEnd = Math.sqrt(H.pinchR ** 2 - (H.pinchY - H.r) ** 2);
  const pts: Vec2[] = [];
  const from = mouth ? H.flare : 0;
  if (mouth) pts.push([-0.6, H.mouth + H.flare + 0.6], [0, H.mouth + H.flare]);
  for (let k = 0; k <= 6; k++) {
    const u = from + ((pinchEnd - from) * k) / 6;
    pts.push([u, holeHalf(u) - c]);
  }
  pts.push([H.end, H.r - c]);
  for (let k = 1; k <= 12; k++) {
    const t = (Math.PI / 2) * (1 - k / 12);
    pts.push([H.end + (H.r - c) * Math.cos(t), (H.r - c) * Math.sin(t)]);
  }
  return pts;
}

const area = (pts: Vec2[]) => pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2;
const ccw = (pts: Vec2[]) => (area(pts) < 0 ? [...pts].reverse() : pts);

/** A connector hole's outline on a tile of W × H mm (tile mm, CCW). */
function holeOutline(side: GridSide, at: number, W: number, H: number): Vec2[] {
  const top = slotHalf(0, true);
  const uv: Vec2[] = [
    ...top,
    ...top
      .slice(0, -1)
      .reverse()
      .map(([u, v]) => [u, -v] as Vec2),
  ];
  const map = ([u, v]: Vec2): Vec2 => (side === 'left' ? [u, at + v] : side === 'right' ? [W - u, at + v] : side === 'bottom' ? [at + v, u] : [at + v, H - u]);
  return ccw(uv.map(map));
}

/** The connector's outline, centred on the origin along x (CCW). */
export function connectorOutline(c: number): Vec2[] {
  const half = slotHalf(c, false);
  const upper: Vec2[] = [
    ...half
      .slice(1)
      .reverse()
      .map(([u, v]) => [-u, v] as Vec2),
    ...half,
  ];
  const lower = upper
    .slice(1, -1)
    .reverse()
    .map(([u, v]) => [u, -v] as Vec2);
  return ccw([...upper, ...lower]);
}

/** A tile, printed as it hangs (back on the bed), its min corner at the origin. */
export function buildOpenGridTile(w: Wasm, spec: OpenGridTileSpec): MeshData {
  const s = new Scope();
  try {
    const G = OPENGRID;
    const P = G.pitch;
    const T = spec.lite ? G.lite : G.full;
    const W = spec.w * P;
    const H = spec.h * P;
    const hole = s.t(opening(w, spec.lite));
    const squares: Manifold[] = [];
    for (let j = 0; j < spec.h; j++) for (let i = 0; i < spec.w; i++) squares.push(s.t(hole.translate([i * P + P / 2, j * P + P / 2, 0])));
    const cuts: Manifold[] = [s.t(w.Manifold.compose(squares))];
    const hz = connectorHoleZ(spec.lite);
    for (const h of spec.holes) cuts.push(s.t(w.Manifold.extrude([holeOutline(h.side, h.at, W, H)], G.hole.h).translate([0, 0, hz])));
    if (spec.screws.length) {
      // One screw hole, copied: they never touch, so they compose.
      const { d, head, inset } = G.screw;
      const hole = s.t(
        w.Manifold.union([
          s.t(cylinderAt(w, 0, 0, -1, T + 1, d / 2, d / 2, 32)),
          s.t(cylinderAt(w, 0, 0, T - inset - (head - d) / 2, T - inset + 0.001, d / 2, head / 2, 48)),
          s.t(cylinderAt(w, 0, 0, T - inset, T + 1, head / 2, head / 2, 48)),
        ]),
      );
      cuts.push(s.t(w.Manifold.compose(spec.screws.map(([x, y]) => s.t(hole.translate([x, y, 0]))))));
    }
    const c = G.corner;
    for (const k of spec.corners) {
      const [x, y] = [k[1] === 'l' ? 0 : W, k[0] === 'b' ? 0 : H];
      const diamond: Vec2[] = [
        [x + c, y],
        [x, y + c],
        [x - c, y],
        [x, y - c],
      ];
      cuts.push(s.t(w.Manifold.extrude([diamond], T + 2).translate([0, 0, -1])));
    }
    const slab = s.t(w.Manifold.cube([W, H, T]));
    const out = s.t(slab.subtract(s.t(w.Manifold.union(cuts))));
    assertValid(out, 'openGrid tile');
    return toMeshData(out);
  } finally {
    s.dispose();
  }
}

/** A connector, printed flat, its min corner at the origin. */
export function buildOpenGridConnector(w: Wasm, p: OpenGridConnectorPart): MeshData {
  const s = new Scope();
  try {
    const size = openGridConnectorSize(p);
    const out = s.t(w.Manifold.extrude([connectorOutline(p.c)], p.h).translate([size.w / 2, size.d / 2, 0]));
    assertValid(out, 'openGrid connector');
    return toMeshData(out);
  } finally {
    s.dispose();
  }
}
