/**
 * IKEA SKÅDIS-compatible pegboards: a drawer whose `enclosure` is 'skadis'
 * prints a pegboard for a space on the wall instead of a Gridfinity grid
 * (enclosures.ts plans it, this file holds the board and its parts).
 *
 * The pattern is IKEA's: 5 × 15 mm upright slots, columns 20 mm apart, the
 * slots in a column 40 mm apart, every other column 20 mm higher. On a 20 mm
 * lattice that is every point (i, j) with i + j even; the points with i + j
 * odd are solid, 17.5 mm from the slots beside them and 12.5 mm from the slot
 * ends above and below. Joints and mounting points go there.
 *
 * Rectangle boards are split into tiles that fit the bed, as the MOSS 3D
 * Skadis generator does: an upright seam takes the place of one column of
 * slots, so it has 17.5 mm of plastic on each side, and a level seam runs
 * through a row of slots, so each slot it cuts is whole again once the tiles
 * are together. Tiles join with dovetail tabs (in the plane of the board)
 * and plates pressed into pockets on the back, with pins (holding it flat);
 * where seams cross there is always a plate.
 *
 * Hexagon boards (like Azntek's hexagonal Skadis board) are honeycomb tiles,
 * each its own board, as large as the bed takes.
 *
 * Every tile prints face down: the front comes off the bed smooth, the slots
 * and countersunk screw holes open toward the bed with a chamfer, and the
 * standoff posts on the back stand up. Coordinates here are the wall's, seen
 * from the front: x to the right, y up, from the space's bottom-left corner;
 * the meshes are turned face down for printing.
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec2, type Wasm } from './kernel';
import { HOLE_SEGMENTS, cylinderAt, loftRings, roundedRectRing } from './shapes';
import { textRects, textSize } from './digits';
import { balanceScore, enumeratePartitions } from '../layout/split';

export type SkadisShape = 'rect' | 'hex';
/** How rectangle tiles join: dovetail tabs, plates on the back, both, or nothing (each tile screwed up on its own). */
export type SkadisJoin = 'both' | 'tabs' | 'plates' | 'none';
/** What holds the board off the wall: posts printed on the back, separate spacers, or nothing. */
export type SkadisStandoff = 'posts' | 'spacers' | 'none';

export interface SkadisOptions {
  /** The space on the wall, mm: width (x) and height (y). A rectangle board fills it; hexagons fit in it. */
  width: number;
  height: number;
  shape: SkadisShape;
  /** Board thickness, mm. IKEA's board is 5 mm; its hooks are made for that. */
  thickness: number;
  /** Slot width and length, mm (IKEA: 5 × 15). */
  slotW: number;
  slotL: number;
  /** 45° chamfer on the slot edges, front and back, mm. */
  chamfer: number;
  /** Least plastic between a slot and the outer edge, mm. */
  border: number;
  /** Radius of the board's outer corners, mm. */
  corner: number;
  join: SkadisJoin;
  standoff: SkadisStandoff;
  /** Gap behind the board, mm: room for the hooks' tails. */
  depth: number;
  /** Screw diameter, mm; the holes are countersunk for its head on the front. */
  screw: number;
  /** About how far apart the mounting points on a tile are, mm (every tile gets at least its corners). */
  mountEvery: number;
  /** Hexagon width, corner to corner, mm; 0: the largest the bed and the space take. */
  hexWidth: number;
  /** Gap between hexagons on the wall, mm. */
  hexGap: number;
  /** Tile numbers on the back, matching the assembly map. */
  numbers: boolean;
}

export const DEFAULT_SKADIS: SkadisOptions = {
  // IKEA's square board.
  width: 560,
  height: 560,
  shape: 'rect',
  thickness: 5,
  slotW: 5,
  slotL: 15,
  chamfer: 0.6,
  border: 10,
  corner: 5,
  join: 'both',
  standoff: 'posts',
  depth: 20,
  screw: 4,
  mountEvery: 200,
  hexWidth: 0,
  hexGap: 3,
  numbers: true,
};

export const SKADIS = {
  /** The lattice: columns, and half the distance between slots in a column. */
  pitch: 20,
  /** Joint plate: a rounded square with four pins, one in each tile at a crossing, two each side of a seam. */
  plate: { size: 20, t: 1.4, r: 3, pinD: 5, pinH: 2.3, pinAt: 5.5, pocket: 1.5, gap: 0.2, hole: 5.3, holeDepth: 2.5, minFloor: 0.8 },
  /** Dovetail tab: `neck` wide at the seam, `head` wide `depth` in; `gap` all round in its socket. */
  tab: { depth: 8, neck: 8, head: 12, gap: 0.15 },
  /** Standoff post on the back: radius at the board and at the wall. */
  post: { r0: 6.5, r1: 5 },
  /** Separate standoff spacer (a tube). */
  spacer: { d: 11 },
  /** Clearance over the screw in its hole, on the diameter. */
  screwClear: 0.5,
  /** Mounting points sit about this far in from a tile's corners. */
  mountInset: 30,
  /** About this far apart along a seam, joints alternate tab and plate. */
  jointEvery: 60,
  /** Tile numbers: height, stroke, depth. */
  number: { h: 8, stroke: 1.3, depth: 0.6 },
} as const;

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

export function sanitizeSkadis(raw: unknown): SkadisOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SkadisOptions>;
  const d = DEFAULT_SKADIS;
  const thickness = num(r.thickness, 3.5, 10, d.thickness);
  const slotW = num(r.slotW, 4, 8, d.slotW);
  return {
    width: num(r.width, 60, 5000, d.width),
    height: num(r.height, 60, 5000, d.height),
    shape: r.shape === 'hex' ? 'hex' : 'rect',
    thickness,
    slotW,
    slotL: num(r.slotL, slotW + 2, 25, Math.max(d.slotL, slotW + 2)),
    chamfer: num(r.chamfer, 0, Math.min(1.5, thickness / 3, slotW / 4), d.chamfer),
    border: num(r.border, 4, 60, d.border),
    corner: num(r.corner, 0, 30, d.corner),
    join: r.join === 'tabs' || r.join === 'plates' || r.join === 'none' ? r.join : 'both',
    standoff: r.standoff === 'spacers' || r.standoff === 'none' ? r.standoff : 'posts',
    depth: num(r.depth, 5, 60, d.depth),
    screw: num(r.screw, 3, 6, d.screw),
    mountEvery: num(r.mountEvery, 60, 600, d.mountEvery),
    hexWidth: num(r.hexWidth, 0, 1000, d.hexWidth),
    hexGap: num(r.hexGap, 0, 50, d.hexGap),
    numbers: r.numbers === undefined ? d.numbers : !!r.numbers,
  };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const EPS = 1e-6;
const SQ3 = Math.sqrt(3);

/** Countersunk head diameter for a screw (90°). */
export const headDiameter = (screw: number) => 2 * screw + 0.5;
/** Joint plates need room for their pocket and pin holes (1.5 mm at least) in the board. */
export const platesFit = (thickness: number) => thickness - SKADIS.plate.pocket - SKADIS.plate.minFloor >= 1.5 - 1e-9;
/** How deep the pin holes go (and so how long the pins are) in a board this thick. */
export const pinHoleDepth = (thickness: number) => Math.min(SKADIS.plate.holeDepth, thickness - SKADIS.plate.pocket - SKADIS.plate.minFloor);

// ---------------------------------------------------------------------------
// Planning (no kernel)
// ---------------------------------------------------------------------------

/** The slot lattice of a rectangle board: slot (i, j) is at (ox + 20 i, oy + 20 j) when i + j is even. */
export interface SkadisLattice {
  ox: number;
  oy: number;
  nx: number;
  ny: number;
}

export interface SkadisTile {
  id: number;
  col: number;
  row: number;
  /** Outline bounds on the wall (a hexagon's bounding box). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Which sides are the board's outside edge (not a seam). */
  outer: { left: boolean; right: boolean; bottom: boolean; top: boolean };
}

/**
 * A joint at a seam: a tab carried by the left (or lower) tile, pointing +x
 * (or +y) into its neighbour, or a plate across the seam ('xy': where seams
 * cross, over four tiles).
 */
export interface SkadisJoint {
  kind: 'tab' | 'plate';
  x: number;
  y: number;
  seam: 'x' | 'y' | 'xy';
}

/** A mounting point: a standoff, and (`screw`) a countersunk hole through it. */
export interface SkadisMount {
  x: number;
  y: number;
  screw: boolean;
  tile: number;
}

export interface SkadisPlan {
  shape: SkadisShape;
  /** The space, mm. */
  W: number;
  H: number;
  tiles: SkadisTile[];
  cols: number;
  rows: number;
  /** Rectangle boards: the lattice, and where the seams are (upright seams are lattice columns without slots). */
  lattice?: SkadisLattice;
  seamsX: number[];
  seamsY: number[];
  joints: SkadisJoint[];
  mounts: SkadisMount[];
  /** Hexagons: their size and centres. */
  hex?: { w: number; h: number; centres: Vec2[] };
  /** Slots on the whole board (rectangle: whole slots, a cut one counted once). */
  slots: number;
  error?: string;
  warnings: string[];
}

/** A usable bed area, mm (pack.ts clearAreas). */
export interface BedArea {
  w: number;
  d: number;
}

export function skadisLattice(W: number, H: number, o: Pick<SkadisOptions, 'border' | 'slotW' | 'slotL'>): SkadisLattice {
  const P = SKADIS.pitch;
  const ex = o.border + o.slotW / 2;
  const ey = o.border + o.slotL / 2;
  const nx = Math.max(0, Math.floor((W - 2 * ex) / P + EPS) + 1);
  const ny = Math.max(0, Math.floor((H - 2 * ey) / P + EPS) + 1);
  return { ox: r3((W - P * Math.max(nx - 1, 0)) / 2), oy: r3((H - P * Math.max(ny - 1, 0)) / 2), nx, ny };
}

/** The fewest pieces along one axis, the most even split of them, cutting only at `cuts`. */
function partition(total: number, cuts: number[], maxLen: number): number[] | null {
  if (total <= maxLen + EPS) return [0, total];
  const all = enumeratePartitions(total, cuts, maxLen);
  if (!all.length) return null;
  return all.sort((a, b) => balanceScore(a) - balanceScore(b))[0];
}

/** Largest hexagon width (corner to corner) whose bounding box fits one of the bed areas, either way round. */
export function maxHexWidth(areas: BedArea[]): number {
  let best = 0;
  for (const a of areas) best = Math.max(best, Math.min(a.w, (a.d * 2) / SQ3), Math.min(a.d, (a.w * 2) / SQ3));
  return Math.floor(best * 10) / 10;
}

const fitsArea = (w: number, d: number, areas: BedArea[]) => areas.some((a) => (w <= a.w + EPS && d <= a.d + EPS) || (d <= a.w + EPS && w <= a.d + EPS));

/** Plan a board for the space on the bed areas it prints on. */
export function planSkadis(o: SkadisOptions, areas: BedArea[]): SkadisPlan {
  return o.shape === 'hex' ? planHex(o, areas) : planRect(o, areas);
}

function emptyPlan(o: SkadisOptions, error: string): SkadisPlan {
  return {
    shape: o.shape,
    W: o.width,
    H: o.height,
    tiles: [],
    cols: 0,
    rows: 0,
    seamsX: [],
    seamsY: [],
    joints: [],
    mounts: [],
    slots: 0,
    error,
    warnings: [],
  };
}

function planRect(o: SkadisOptions, areas: BedArea[]): SkadisPlan {
  const P = SKADIS.pitch;
  const W = o.width;
  const H = o.height;
  const L = skadisLattice(W, H, o);
  if (!L.nx || !L.ny) return emptyPlan(o, `The space is too small for a slot inside a ${o.border} mm border.`);
  const warnings: string[] = [];
  const plates = (o.join === 'both' || o.join === 'plates') && platesFit(o.thickness);
  if ((o.join === 'both' || o.join === 'plates') && !plates)
    warnings.push(`A ${o.thickness} mm board is too thin for joint plates: the tiles only join with tabs.`);
  const join: SkadisJoin = plates ? o.join : o.join === 'none' ? 'none' : 'tabs';
  const tabs = join === 'both' || join === 'tabs';
  // Tabs reach into the tile to the right and the one above.
  const reach = tabs ? SKADIS.tab.depth + SKADIS.tab.gap : 0;
  const colX = (i: number) => r3(L.ox + P * i);
  const rowY = (j: number) => r3(L.oy + P * j);
  // Upright seams on a slot column (it loses its slots), level ones through a row of slots; never in the outermost ones.
  const cutsX = Array.from({ length: Math.max(0, L.nx - 2) }, (_, k) => colX(k + 1));
  const cutsY = Array.from({ length: Math.max(0, L.ny - 2) }, (_, k) => rowY(k + 1));
  let best: { xs: number[]; ys: number[]; score: number[] } | null = null;
  for (const a of areas) {
    for (const [mw, mh] of [
      [a.w, a.d],
      [a.d, a.w],
    ]) {
      const xs = partition(W, cutsX, mw - reach);
      const ys = partition(H, cutsY, mh - reach);
      if (!xs || !ys) continue;
      const score = [(xs.length - 1) * (ys.length - 1), balanceScore(xs) + balanceScore(ys)];
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1] - EPS)) best = { xs, ys, score };
    }
  }
  if (!best) return emptyPlan(o, 'Could not split the board into tiles that fit this bed: make the border smaller, or pick a bigger printer.');
  const { xs, ys } = best;
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  const seamsX = xs.slice(1, -1);
  const seamsY = ys.slice(1, -1);
  const tiles: SkadisTile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({
        id: r * cols + c + 1,
        col: c,
        row: r,
        x0: xs[c],
        y0: ys[r],
        x1: xs[c + 1],
        y1: ys[r + 1],
        outer: { left: c === 0, right: c === cols - 1, bottom: r === 0, top: r === rows - 1 },
      });
    }
  }
  const joints = planJoints(join, xs, ys, L);
  const mounts = planMounts(o, tiles, L, seamsX, seamsY, joints);
  let slots = 0;
  const seamCol = new Set(seamsX.map((x) => Math.round((x - L.ox) / P)));
  for (let i = 0; i < L.nx; i++) if (!seamCol.has(i)) for (let j = 0; j < L.ny; j++) if ((i + j) % 2 === 0) slots++;
  return { shape: 'rect', W, H, tiles, cols, rows, lattice: L, seamsX, seamsY, joints, mounts, slots, warnings };
}

/** Joints along the seams: plates where seams cross, then evenly spaced sites along each stretch of seam. */
function planJoints(join: SkadisJoin, xs: number[], ys: number[], L: SkadisLattice): SkadisJoint[] {
  if (join === 'none') return [];
  const P = SKADIS.pitch;
  const plates = join === 'both' || join === 'plates';
  const out: SkadisJoint[] = [];
  const seamsX = xs.slice(1, -1);
  const seamsY = ys.slice(1, -1);
  if (plates) for (const x of seamsX) for (const y of seamsY) out.push({ kind: 'plate', x, y, seam: 'xy' });
  // Room left for a crossing's plate (and a joint's own half), and from the outer edge.
  const fromCross = SKADIS.plate.size / 2 + SKADIS.plate.gap + 12;
  const fromEdge = SKADIS.plate.size / 2 + SKADIS.plate.gap + 3;
  const pick = (a: number, b: number, candidates: number[]): number[] => {
    const ok = candidates.filter((v) => v >= a - EPS && v <= b + EPS);
    if (!ok.length) return [];
    const n = Math.max(1, Math.round((b - a) / SKADIS.jointEvery));
    const at: number[] = [];
    for (let k = 0; k < n; k++) {
      const target = n === 1 ? (a + b) / 2 : a + ((b - a) * k) / (n - 1);
      const v = ok.reduce((p, q) => (Math.abs(q - target) < Math.abs(p - target) ? q : p));
      if (!at.includes(v)) at.push(v);
    }
    return at.sort((p, q) => p - q);
  };
  const kindAt = (k: number): SkadisJoint['kind'] => (join === 'tabs' ? 'tab' : join === 'plates' ? 'plate' : k % 2 === 0 ? 'tab' : 'plate');
  const rowsY = Array.from({ length: L.ny }, (_, j) => r3(L.oy + P * j));
  for (const x of seamsX) {
    for (let r = 0; r + 1 < ys.length; r++) {
      const a = ys[r] + (r > 0 ? fromCross : fromEdge);
      const b = ys[r + 1] - (r + 2 < ys.length ? fromCross : fromEdge);
      pick(a, b, rowsY).forEach((y, k) => out.push({ kind: kindAt(k), x, y, seam: 'x' }));
    }
  }
  for (const y of seamsY) {
    const j = Math.round((y - L.oy) / P);
    // Along a level seam, only where no slot is cut: the solid lattice points of its row.
    const empty = Array.from({ length: L.nx }, (_, i) => i)
      .filter((i) => (i + j) % 2 === 1)
      .map((i) => r3(L.ox + P * i));
    for (let c = 0; c + 1 < xs.length; c++) {
      const a = xs[c] + (c > 0 ? fromCross : fromEdge);
      const b = xs[c + 1] - (c + 2 < xs.length ? fromCross : fromEdge);
      pick(a, b, empty).forEach((x, k) => out.push({ kind: kindAt(k), x, y, seam: 'y' }));
    }
  }
  return out;
}

/** Radius a mounting point keeps clear around itself on the board. */
const mountRadius = (o: Pick<SkadisOptions, 'standoff' | 'screw'>) =>
  o.standoff === 'posts' ? SKADIS.post.r0 : Math.max(headDiameter(o.screw) / 2, o.standoff === 'spacers' ? SKADIS.spacer.d / 2 : 0);

/** Mounting points on each tile: near its corners and about every `mountEvery` between, on solid lattice points. */
function planMounts(o: SkadisOptions, tiles: SkadisTile[], L: SkadisLattice, seamsX: number[], seamsY: number[], joints: SkadisJoint[]): SkadisMount[] {
  const P = SKADIS.pitch;
  const rad = mountRadius(o);
  const seamCols = new Set(seamsX.map((x) => Math.round((x - L.ox) / P)));
  const out: SkadisMount[] = [];
  for (const t of tiles) {
    const m = rad + 2;
    const cands: Vec2[] = [];
    for (let i = 0; i < L.nx; i++) {
      if (seamCols.has(i)) continue;
      const x = L.ox + P * i;
      if (x < t.x0 + m || x > t.x1 - m) continue;
      for (let j = 0; j < L.ny; j++) {
        if ((i + j) % 2 === 0) continue;
        const y = L.oy + P * j;
        if (y < t.y0 + m || y > t.y1 - m) continue;
        if (seamsY.some((s) => Math.abs(s - y) < m)) continue;
        if (joints.some((jt) => Math.hypot(jt.x - x, jt.y - y) < 20 - EPS)) continue;
        cands.push([r3(x), r3(y)]);
      }
    }
    if (!cands.length) continue;
    const along = (a: number, b: number) => {
      const inset = Math.min(SKADIS.mountInset, (b - a) / 4);
      const span = b - a - 2 * inset;
      const n = span < 20 ? 1 : Math.max(2, Math.round(span / o.mountEvery) + 1);
      return n === 1 ? [(a + b) / 2] : Array.from({ length: n }, (_, k) => a + inset + (span * k) / (n - 1));
    };
    const used = new Set<string>();
    for (const ty of along(t.y0, t.y1)) {
      for (const tx of along(t.x0, t.x1)) {
        const c = cands.reduce((p, q) => (Math.hypot(q[0] - tx, q[1] - ty) < Math.hypot(p[0] - tx, p[1] - ty) ? q : p));
        const k = `${c[0]},${c[1]}`;
        if (used.has(k)) continue;
        used.add(k);
        out.push({ x: c[0], y: c[1], screw: true, tile: t.id });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hexagons
// ---------------------------------------------------------------------------

/** A flat-topped hexagon (corners left and right) of width `w`, centred at (cx, cy), CCW from the right corner. */
export function hexCorners(cx: number, cy: number, w: number): Vec2[] {
  const R = w / 2;
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k;
    return [r3(cx + R * Math.cos(a)), r3(cy + R * Math.sin(a))] as Vec2;
  });
}

function planHex(o: SkadisOptions, areas: BedArea[]): SkadisPlan {
  const W = o.width;
  const H = o.height;
  const bedMax = maxHexWidth(areas);
  const auto = !(o.hexWidth > 0);
  const hw = auto ? Math.min(bedMax, W, (H * 2) / SQ3) : o.hexWidth;
  const hh = (hw * SQ3) / 2;
  if (hw < 60) return emptyPlan(o, auto ? 'The space or the bed is too small for a hexagon board.' : 'Hexagons need to be at least 60 mm wide.');
  if (!fitsArea(hw, hh, areas))
    return emptyPlan(o, `A ${r3(hw)} mm hexagon is bigger than the bed: make it smaller, or leave the width empty for the largest that fits.`);
  if (hw > W + EPS || hh > H + EPS) return emptyPlan(o, `The space is smaller than one ${r3(hw)} mm hexagon.`);
  // Neighbours across a slanted edge are one hexagon height (plus the gap) apart, 30° up.
  const step = hh + o.hexGap;
  const dx = (step * SQ3) / 2;
  const nc = Math.floor((W - hw) / dx + EPS) + 1;
  const centres: Vec2[] = [];
  const colRows = (k: number) => Math.max(0, Math.floor((H - hh - (k % 2 ? step / 2 : 0)) / step + EPS) + 1);
  for (let k = 0; k < nc; k++) for (let r = 0; r < colRows(k); r++) centres.push([hw / 2 + k * dx, hh / 2 + r * step + (k % 2 ? step / 2 : 0)]);
  // Centred in the space.
  const minX = Math.min(...centres.map((c) => c[0])) - hw / 2;
  const maxX = Math.max(...centres.map((c) => c[0])) + hw / 2;
  const minY = Math.min(...centres.map((c) => c[1])) - hh / 2;
  const maxY = Math.max(...centres.map((c) => c[1])) + hh / 2;
  const sx = (W - (maxX - minX)) / 2 - minX;
  const sy = (H - (maxY - minY)) / 2 - minY;
  const placed = centres.map(([x, y]) => [r3(x + sx), r3(y + sy)] as Vec2);
  const tiles: SkadisTile[] = placed.map(([x, y], i) => ({
    id: i + 1,
    col: Math.round((x - placed[0][0]) / dx),
    row: Math.floor((y - Math.min(...placed.map((p) => p[1]))) / step + EPS),
    x0: r3(x - hw / 2),
    y0: r3(y - hh / 2),
    x1: r3(x + hw / 2),
    y1: r3(y + hh / 2),
    outer: { left: true, right: true, bottom: true, top: true },
  }));
  const local = hexLocalMounts(o, hw);
  const mounts: SkadisMount[] = tiles.flatMap((t) => local.map((m) => ({ x: r3(t.x0 + m.x), y: r3(t.y0 + m.y), screw: m.screw, tile: t.id })));
  const one = hexSlots(o, hw, local).length;
  return {
    shape: 'hex',
    W,
    H,
    tiles,
    cols: nc,
    rows: Math.max(...Array.from({ length: nc }, (_, k) => colRows(k))),
    seamsX: [],
    seamsY: [],
    joints: [],
    mounts,
    hex: { w: r3(hw), h: r3(hh), centres: placed },
    slots: one * tiles.length,
    warnings: [],
  };
}

/**
 * A hexagon's mounting points (tile coordinates): one in each corner, far
 * enough in for its standoff. Screws go in the left and right corners; the
 * other four are posts the board rests on. Separate spacers need a screw
 * each to stay put, so with them every corner gets one.
 */
function hexLocalMounts(o: SkadisOptions, hw: number): { x: number; y: number; screw: boolean }[] {
  const hh = (hw * SQ3) / 2;
  const rad = mountRadius(o);
  // Far enough from both edges at a 120° corner, the rounding and the border.
  const inset = (rad + 2.5) / Math.sin(Math.PI / 3) + o.corner * 0.3;
  return hexCorners(hw / 2, hh / 2, hw).flatMap(([x, y], k) => {
    const side = k === 0 || k === 3;
    if (o.standoff !== 'posts' && o.standoff !== 'spacers' && !side) return [];
    const ux = (hw / 2 - x) / (hw / 2);
    const uy = (hh / 2 - y) / (hw / 2);
    return [{ x: r3(x + ux * inset), y: r3(y + uy * inset), screw: o.standoff === 'spacers' || side }];
  });
}

/** Slots of one hexagon (tile coordinates): the lattice centred on it, inside its border, clear of its mounts. */
function hexSlots(o: SkadisOptions, hw: number, mounts: { x: number; y: number }[]): Vec2[] {
  const P = SKADIS.pitch;
  const hh = (hw * SQ3) / 2;
  const cx = hw / 2;
  const cy = hh / 2;
  const corners = hexCorners(cx, cy, hw);
  const keep = o.border + o.slotW / 2;
  const a = (o.slotL - o.slotW) / 2;
  // Inside the inset hexagon: on the inner side of every edge by `keep`.
  const inside = (x: number, y: number) =>
    corners.every((p, k) => {
      const q = corners[(k + 1) % 6];
      const ex = q[0] - p[0];
      const ey = q[1] - p[1];
      return (ex * (y - p[1]) - ey * (x - p[0])) / Math.hypot(ex, ey) >= keep - EPS;
    });
  const rad = mountRadius(o) + 1.5;
  const out: Vec2[] = [];
  const n = Math.ceil(hw / P) + 1;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if ((((i + j) % 2) + 2) % 2 !== 0) continue;
      const x = cx + P * i;
      const y = cy + P * j;
      if (!inside(x, y - a) || !inside(x, y + a)) continue;
      // Distance from a mount to the slot's centre line, less its half width.
      if (mounts.some((m) => Math.hypot(m.x - x, Math.max(0, Math.abs(m.y - y) - a)) - o.slotW / 2 < rad)) continue;
      out.push([r3(x), r3(y)]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// What each tile is built from
// ---------------------------------------------------------------------------

/** One tile's geometry in its own coordinates (wall view, its bounding box's bottom-left at 0, 0). */
export interface SkadisTileSpec {
  /** Outline, CCW. */
  outline: Vec2[];
  t: number;
  chamfer: number;
  slotW: number;
  slotL: number;
  /** Slot centres (a slot cut by an edge included: only its part on the tile is cut). */
  slots: Vec2[];
  /** Tabs it carries at its right ('x') or top ('y') edge, and the sockets for its neighbours' at its left or bottom edge. */
  tabs: { x: number; y: number; dir: 'x' | 'y' }[];
  sockets: { x: number; y: number; dir: 'x' | 'y' }[];
  /** Pockets for joint plates on the back, by centre. */
  pockets: Vec2[];
  pinHole: number;
  mounts: { x: number; y: number; screw: boolean }[];
  /** Posts on the back this tall, or 0. */
  posts: number;
  screw: number;
  number?: { text: string; x: number; y: number };
}

/** The spec for each tile of a plan, in tile order. */
export function skadisTileSpecs(plan: SkadisPlan, o: SkadisOptions): SkadisTileSpec[] {
  const posts = o.standoff === 'posts' ? r3(o.depth) : 0;
  const common = { t: o.thickness, chamfer: o.chamfer, slotW: o.slotW, slotL: o.slotL, pinHole: r3(pinHoleDepth(o.thickness)), posts, screw: o.screw };
  if (plan.shape === 'hex' && plan.hex) {
    const hw = plan.hex.w;
    const hh = plan.hex.h;
    const local = hexLocalMounts(o, hw);
    const slots = hexSlots(o, hw, local);
    const outline = roundedPolygon(hexCorners(hw / 2, hh / 2, hw), o.corner);
    // Hexagons go up in any order: no numbers, so they are all one part.
    return plan.tiles.map(() => ({ outline, ...common, slots, tabs: [], sockets: [], pockets: [], mounts: local }));
  }
  const L = plan.lattice!;
  const P = SKADIS.pitch;
  const seamCols = new Set(plan.seamsX.map((x) => Math.round((x - L.ox) / P)));
  const sl = o.slotL / 2;
  const sw = o.slotW / 2;
  return plan.tiles.map((t) => {
    const at = (x: number, y: number): Vec2 => [r3(x - t.x0), r3(y - t.y0)];
    const slots: Vec2[] = [];
    for (let i = 0; i < L.nx; i++) {
      if (seamCols.has(i)) continue;
      const x = L.ox + P * i;
      if (x + sw < t.x0 - EPS || x - sw > t.x1 + EPS) continue;
      for (let j = 0; j < L.ny; j++) {
        if ((i + j) % 2) continue;
        const y = L.oy + P * j;
        if (y + sl <= t.y0 + EPS || y - sl >= t.y1 - EPS) continue;
        slots.push(at(x, y));
      }
    }
    const R = o.corner;
    const outline = roundedRectRing(0, 0, r3(t.x1 - t.x0), r3(t.y1 - t.y0), [
      t.outer.left && t.outer.bottom ? R : 0,
      t.outer.right && t.outer.bottom ? R : 0,
      t.outer.right && t.outer.top ? R : 0,
      t.outer.left && t.outer.top ? R : 0,
    ]).map(([x, y]) => [r3(x), r3(y)] as Vec2);
    const tabs: SkadisTileSpec['tabs'] = [];
    const sockets: SkadisTileSpec['sockets'] = [];
    const pockets: Vec2[] = [];
    const on = (x: number, y: number, m = 0) => x >= t.x0 - m - EPS && x <= t.x1 + m + EPS && y >= t.y0 - m - EPS && y <= t.y1 + m + EPS;
    for (const j of plan.joints) {
      if (j.kind === 'plate') {
        if (on(j.x, j.y)) pockets.push(at(j.x, j.y));
        continue;
      }
      if (j.seam === 'x' && j.y > t.y0 && j.y < t.y1) {
        if (Math.abs(j.x - t.x1) < EPS) tabs.push({ ...pt(at(j.x, j.y)), dir: 'x' });
        else if (Math.abs(j.x - t.x0) < EPS) sockets.push({ ...pt(at(j.x, j.y)), dir: 'x' });
      }
      if (j.seam === 'y' && j.x > t.x0 && j.x < t.x1) {
        if (Math.abs(j.y - t.y1) < EPS) tabs.push({ ...pt(at(j.x, j.y)), dir: 'y' });
        else if (Math.abs(j.y - t.y0) < EPS) sockets.push({ ...pt(at(j.x, j.y)), dir: 'y' });
      }
    }
    const mounts = plan.mounts.filter((m) => m.tile === t.id).map((m) => ({ ...pt(at(m.x, m.y)), screw: m.screw }));
    let number: SkadisTileSpec['number'];
    if (o.numbers) {
      // A solid lattice point near the middle, clear of the mounts and the joints.
      const busy = [...mounts.map((m) => [m.x, m.y] as Vec2), ...pockets, ...tabs.map((b) => [b.x, b.y] as Vec2), ...sockets.map((b) => [b.x, b.y] as Vec2)];
      const tw = t.x1 - t.x0;
      const th = t.y1 - t.y0;
      let best: Vec2 | null = null;
      for (let i = 0; i < L.nx; i++) {
        if (seamCols.has(i)) continue;
        for (let j = 0; j < L.ny; j++) {
          if ((i + j) % 2 === 0) continue;
          const [x, y] = at(L.ox + P * i, L.oy + P * j);
          if (x < 15 || x > tw - 15 || y < 12 || y > th - 12) continue;
          if (busy.some((b) => Math.hypot(b[0] - x, b[1] - y) < 19)) continue;
          if (!best || Math.hypot(x - tw / 2, y - th / 2) < Math.hypot(best[0] - tw / 2, best[1] - th / 2)) best = [x, y];
        }
      }
      if (best) number = { text: String(t.id), x: best[0], y: best[1] };
    }
    return { outline, ...common, slots, tabs, sockets, pockets, mounts, ...(number ? { number } : {}) };
  });
}

const pt = ([x, y]: Vec2) => ({ x, y });

/**
 * Bounds of a tile as built, tile coordinates: its tabs reach past the
 * outline, and a hexagon's rounded corners stop short of its box.
 */
export function tileBounds(spec: SkadisTileSpec): { x0: number; y0: number; w: number; d: number; h: number } {
  const reach = SKADIS.tab.depth;
  const x0 = Math.min(...spec.outline.map((p) => p[0]));
  const y0 = Math.min(...spec.outline.map((p) => p[1]));
  const x1 = Math.max(...spec.outline.map((p) => p[0]), ...spec.tabs.filter((b) => b.dir === 'x').map((b) => b.x + reach));
  const y1 = Math.max(...spec.outline.map((p) => p[1]), ...spec.tabs.filter((b) => b.dir === 'y').map((b) => b.y + reach));
  return { x0: r3(x0), y0: r3(y0), w: r3(x1 - x0), d: r3(y1 - y0), h: r3(spec.t + spec.posts) };
}

/** A convex polygon (CCW) with its corners rounded to radius `r`. */
export function roundedPolygon(pts: Vec2[], r: number, segs = 6): Vec2[] {
  if (r <= 0) return pts;
  const n = pts.length;
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const p = pts[(k + n - 1) % n];
    const v = pts[k];
    const q = pts[(k + 1) % n];
    const a = norm([p[0] - v[0], p[1] - v[1]]);
    const b = norm([q[0] - v[0], q[1] - v[1]]);
    const half = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) / 2;
    const d = r / Math.tan(half);
    const bis = norm([a[0] + b[0], a[1] + b[1]]);
    const c: Vec2 = [v[0] + (bis[0] * r) / Math.sin(half), v[1] + (bis[1] * r) / Math.sin(half)];
    const t0: Vec2 = [v[0] + a[0] * d, v[1] + a[1] * d];
    const t1: Vec2 = [v[0] + b[0] * d, v[1] + b[1] * d];
    let a0 = Math.atan2(t0[1] - c[1], t0[0] - c[0]);
    let a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    while (a1 < a0) a1 += 2 * Math.PI;
    if (a1 - a0 > Math.PI) a0 += 2 * Math.PI;
    for (let i = 0; i <= segs; i++) {
      const ang = a0 + ((a1 - a0) * i) / segs;
      out.push([r3(c[0] + r * Math.cos(ang)), r3(c[1] + r * Math.sin(ang))]);
    }
  }
  return out;
}

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

// ---------------------------------------------------------------------------
// Parts besides the tiles
// ---------------------------------------------------------------------------

export interface SkadisPlatePart {
  size: number;
  t: number;
  r: number;
  pinD: number;
  pinH: number;
  pinAt: number;
}

export interface SkadisSpacerPart {
  d: number;
  h: number;
  hole: number;
}

export function skadisPlatePart(o: SkadisOptions): SkadisPlatePart {
  const p = SKADIS.plate;
  return { size: p.size, t: p.t, r: p.r, pinD: p.pinD, pinH: r3(Math.max(0.8, pinHoleDepth(o.thickness) - 0.2)), pinAt: p.pinAt };
}

export function skadisSpacerPart(o: SkadisOptions): SkadisSpacerPart {
  return { d: SKADIS.spacer.d, h: r3(o.depth), hole: r3(o.screw + SKADIS.screwClear) };
}

export const plateSize = (p: SkadisPlatePart) => ({ w: p.size, d: p.size, h: r3(p.t + p.pinH) });

// ---------------------------------------------------------------------------
// Building (geometry worker)
// ---------------------------------------------------------------------------

/** A slot's outline (a stadium) grown by `off`, CCW, with the same point count whatever its size. */
function stadium(cx: number, cy: number, w: number, l: number, off: number, segs = 12): Vec2[] {
  const r = w / 2 + off;
  const a = (l - w) / 2;
  const out: Vec2[] = [];
  for (let i = 0; i <= segs; i++) {
    const ang = Math.PI + (Math.PI * i) / segs;
    out.push([cx + r * Math.cos(ang), cy - a + r * Math.sin(ang)]);
  }
  for (let i = 0; i <= segs; i++) {
    const ang = (Math.PI * i) / segs;
    out.push([cx + r * Math.cos(ang), cy + a + r * Math.sin(ang)]);
  }
  return out;
}

/** A slot through the board, chamfered at both faces (z = 0 front, z = t back). */
function slotSolid(w: Wasm, cx: number, cy: number, spec: SkadisTileSpec): Manifold {
  const c = spec.chamfer;
  const t = spec.t;
  if (c <= 0) return w.Manifold.extrude([stadium(cx, cy, spec.slotW, spec.slotL, 0)], t + 2).translate([0, 0, -1]);
  const knots: [number, number][] = [
    [-0.3, c + 0.3],
    [c, 0],
    [t - c, 0],
    [t + 0.3, c + 0.3],
  ];
  return loftRings(
    w,
    knots.map(([, off]) => stadium(cx, cy, spec.slotW, spec.slotL, off)),
    knots.map(([z]) => z),
  );
}

/** A dovetail at a seam: `base` is the seam, `along` the middle of the tab; it points +x (dir 'x') or +y. `g` grows it all round. */
function dovetail(base: number, along: number, dir: 'x' | 'y', g: number, back: number): Vec2[] {
  const { depth, neck, head } = SKADIS.tab;
  const half = (u: number) => neck / 2 + ((head - neck) / 2) * (u / depth) + g;
  const u0 = -back;
  const u1 = depth + g;
  const pts: [number, number][] = [
    [u0, -half(u0)],
    [u1, -half(u1)],
    [u1, half(u1)],
    [u0, half(u0)],
  ];
  // (u along the tab, v across it) to (x, y): 'y' turns it a quarter left, so the order stays CCW.
  return pts.map(([u, v]) => (dir === 'x' ? [base + u, along + v] : [along - v, base + u]) as Vec2);
}

/** A tile, face down (front on the bed, posts up), its bounding box's min corner at the origin. */
export function buildSkadisTile(w: Wasm, spec: SkadisTileSpec): MeshData {
  const s = new Scope();
  try {
    const t = spec.t;
    const P = SKADIS.plate;
    const adds: Manifold[] = [];
    const cuts: Manifold[] = [];
    // Tabs: overlapping the tile a little, so they fuse with it.
    for (const b of spec.tabs) {
      const base = b.dir === 'x' ? b.x : b.y;
      const along = b.dir === 'x' ? b.y : b.x;
      adds.push(s.t(w.Manifold.extrude([dovetail(base, along, b.dir, 0, 0.5)], t)));
    }
    for (const b of spec.sockets) {
      const base = b.dir === 'x' ? b.x : b.y;
      const along = b.dir === 'x' ? b.y : b.x;
      cuts.push(s.t(w.Manifold.extrude([dovetail(base, along, b.dir, SKADIS.tab.gap, 2)], t + 2).translate([0, 0, -1])));
    }
    const headR = headDiameter(spec.screw) / 2;
    const holeR = (spec.screw + SKADIS.screwClear) / 2;
    for (const m of spec.mounts) {
      if (spec.posts > 0) adds.push(s.t(cylinderAt(w, m.x, m.y, t - 0.01, t + spec.posts, SKADIS.post.r0, SKADIS.post.r1, 48)));
      if (!m.screw) continue;
      cuts.push(s.t(cylinderAt(w, m.x, m.y, -1, t + spec.posts + 1, holeR, holeR, HOLE_SEGMENTS)));
      // Countersink on the front (on the bed): 90°, opening toward the bed.
      cuts.push(s.t(cylinderAt(w, m.x, m.y, -0.3, headR - holeR, headR + 0.3, holeR, 48)));
    }
    for (const [x, y] of spec.pockets) {
      const half = P.size / 2 + P.gap;
      cuts.push(s.t(w.Manifold.extrude([roundedRectRing(x - half, y - half, x + half, y + half, P.r + P.gap)], P.pocket + 1).translate([0, 0, t - P.pocket])));
      for (const sx of [-1, 1])
        for (const sy of [-1, 1]) cuts.push(s.t(cylinderAt(w, x + sx * P.pinAt, y + sy * P.pinAt, t - P.pocket - spec.pinHole, t, P.hole / 2, P.hole / 2, 32)));
    }
    if (spec.number) {
      const N = SKADIS.number;
      const size = textSize(spec.number.text, N.h, N.stroke);
      // Mirrored here, so it reads from the back once the tile is turned face down.
      for (const g of textRects(spec.number.text, N.h, N.stroke)) {
        const x0 = spec.number.x + size.w / 2 - g.x1;
        const x1 = spec.number.x + size.w / 2 - g.x0;
        const y0 = spec.number.y - size.h / 2 + g.y0;
        const y1 = spec.number.y - size.h / 2 + g.y1;
        cuts.push(s.t(w.Manifold.cube([x1 - x0, y1 - y0, N.depth + 1]).translate([x0, y0, t - N.depth])));
      }
    }
    let body = s.t(w.Manifold.extrude([spec.outline], t));
    if (adds.length) body = s.t(w.Manifold.union([body, ...adds]));
    // Slots never touch each other: one compose, then one difference.
    if (spec.slots.length) body = s.t(body.subtract(s.t(w.Manifold.compose(spec.slots.map(([x, y]) => s.t(slotSolid(w, x, y, spec)))))));
    if (cuts.length) body = s.t(body.subtract(s.t(w.Manifold.union(cuts))));
    // Face down: turned over about the y axis (x mirrored, front on the bed).
    const down = s.t(body.mirror([1, 0, 0]));
    const b = down.boundingBox();
    const out = s.t(down.translate([-b.min[0], -b.min[1], -b.min[2]]));
    assertValid(out, 'Skådis tile');
    return toMeshData(out);
  } finally {
    s.dispose();
  }
}

/** A joint plate: pins up (as printed), or pins down (in its pocket, for the drawer view). */
export function buildSkadisPlate(w: Wasm, p: SkadisPlatePart, pinsDown = false): MeshData {
  const s = new Scope();
  try {
    const c = p.size / 2;
    const parts: Manifold[] = [s.t(w.Manifold.extrude([roundedRectRing(0, 0, p.size, p.size, p.r)], p.t))];
    const tip = Math.min(0.4, p.pinH / 3);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = c + sx * p.pinAt;
        const y = c + sy * p.pinAt;
        parts.push(s.t(cylinderAt(w, x, y, p.t - 0.01, p.t + p.pinH - tip, p.pinD / 2, p.pinD / 2, 32)));
        // A small lead-in on the tip.
        parts.push(s.t(cylinderAt(w, x, y, p.t + p.pinH - tip - 0.01, p.t + p.pinH, p.pinD / 2, p.pinD / 2 - tip, 32)));
      }
    }
    let m = s.t(w.Manifold.union(parts));
    if (pinsDown) m = s.t(s.t(m.rotate([180, 0, 0])).translate([0, p.size, p.t + p.pinH]));
    assertValid(m, 'Skådis joint plate');
    return toMeshData(m);
  } finally {
    s.dispose();
  }
}

/** A standoff spacer: a tube the screw goes through. */
export function buildSkadisSpacer(w: Wasm, p: SkadisSpacerPart): MeshData {
  const s = new Scope();
  try {
    const r = p.d / 2;
    const tube = s.t(cylinderAt(w, r, r, 0, p.h, r, r, 48));
    const m = s.t(tube.subtract(s.t(cylinderAt(w, r, r, -1, p.h + 1, p.hole / 2, p.hole / 2, HOLE_SEGMENTS))));
    assertValid(m, 'Skådis spacer');
    return toMeshData(m);
  } finally {
    s.dispose();
  }
}
