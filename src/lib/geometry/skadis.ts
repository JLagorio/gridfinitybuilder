/**
 * Skådis-pattern pegboards: a drawer whose `enclosure` is 'skadis'
 * prints a pegboard for a space on the wall instead of a Gridfinity grid
 * (enclosures.ts plans it, this file holds the board and its parts).
 *
 * The standard pattern: 5 × 15 mm upright slots, columns 20 mm apart, the
 * slots in a column 40 mm apart, every other column 20 mm higher. On a 20 mm
 * lattice that is every point (i, j) with i + j even; the points with i + j
 * odd are solid, 17.5 mm from the slots beside them and 12.5 mm from the slot
 * ends above and below. Joints and mounting points go there. Two more patterns
 * use the same lattice (any step from 14 to 40 mm): 'square', a slot where i
 * and j are both even (a square grid two steps apart: openGrid-like 28 mm
 * squares on a 14 mm step), and 'dense', a slot at every point (twice the standard's,
 * so attachments sit at any step; its solid points are the middles between
 * four slots). Attachments' mounts are always an even number of steps apart,
 * so on every pattern a part whose anchor is on a slot finds all its slots.
 *
 * Rectangle boards are split into tiles that fit the bed, as the MOSS 3D
 * Skadis generator does: an upright seam takes the place of one column of
 * slots, so it has 17.5 mm of plastic on each side, and a level seam runs
 * through a row of slots, so each slot it cuts is whole again once the tiles
 * are together. On a square grid seams run along the empty columns and rows
 * between the slots and cost none; on a dense board a level seam takes the
 * place of a row of slots too (between two rows there would be 2.5 mm). Tiles
 * join with dovetail tabs (in the plane of the board) and plates pressed into
 * pockets on the back, with pins (holding it flat); where seams cross there is
 * a plate whenever it clears the slots.
 *
 * Hexagon boards (like Azntek's hexagonal Skadis board) are honeycomb tiles,
 * each its own board, as large as the bed takes.
 *
 * A board is laid out one of two ways. Filling a space ('space', the first
 * boards' way): a width and a height on the wall, a rectangle split into tiles
 * or whole hexagons fitted in. Built from tiles ('tiles', new boards): tiles
 * of one size (the largest the bed takes, or one picked) added one by one on a
 * grid, (column, row) for rectangles, axial (q, r) for hexagons. Every tile's
 * slots are on one lattice then, so an attachment can span two tiles. A
 * rectangle tile is a whole number of steps each way and they butt together
 * as seams do (an edge with no tile past it runs along a lattice line too,
 * the slots it would cut left out). Hexagons stand on a corner: the one to a
 * hexagon's right is 2a steps across, the one up and to its right a across
 * and b up, with a+b even on the standard pattern and a and b even on the
 * square one, so every hexagon has the same slots and they are still all one
 * part. No a and b make a regular hexagon, so it is the cell those steps give
 * (a few % taller or flatter), drawn in by half the gap all round. Two side by
 * side share an upright edge, every other row of slots running on from one to
 * the next a column apart, so a part across them finds its slots; joint
 * plates on the back across the gap hold them in line. (Hexagons filling a
 * space have their corners left and right, each its own lattice.)
 *
 * Every tile prints face down: the front comes off the bed smooth, the slots
 * and countersunk screw holes open toward the bed with a chamfer, and the
 * standoff posts on the back stand up. Coordinates here are the wall's, seen
 * from the front: x to the right, y up, from the space's bottom-left corner;
 * the meshes are turned face down for printing.
 *
 * Rectangle boards can also have (planned here, the parts built in skadisParts.ts):
 * - zones: solid areas without slots, blank, with text engraved in the front,
 *   or with 6 × 2 mm magnet pockets from the back (a strip for knives and bits);
 * - a frame: a rim proud of the front all round. A rim would hold a tile off the
 *   bed it prints face down on, so it is separate frame strips, printed front
 *   face down, pins up, pressed into holes in the border and glued; the strips
 *   cross the tile seams along the edge, so they help hold the tiles in line.
 *   With 'led' the outer tiles also get a channel round the back edge (it
 *   prints on top) for an LED strip facing the wall, deeper at the corners for
 *   the wire joints;
 * - other ways to hang than screws through the board into the wall: a French
 *   cleat, hooks over a door, or feet (or clamps) on a desk: printed parts
 *   screwed on from the front through countersunk holes in the board.
 *
 * Any board screwed up through its posts can have snap-on screw covers: each
 * screw hole is sunk 4.5 mm deeper (the head sits in the post) behind a 1.5 mm
 * mouth with a groove under it, and a round cap's slit legs push through the
 * mouth and spring out into the groove (skadisParts.ts builds the caps).
 */
import { Scope, assertValid, toMeshData, type Manifold, type MeshData, type Vec2, type Wasm } from './kernel';
import { HOLE_SEGMENTS, cylinderAt, loftRings, roundedRectRing } from './shapes';
import { textRects, textSize } from './digits';
import { hasFont, textOutline, textSolid } from './text';
import { balanceScore, enumeratePartitions } from '../layout/split';

export type SkadisShape = 'rect' | 'hex';
/** How rectangle tiles join: dovetail tabs, plates on the back, both, or nothing (each tile screwed up on its own). */
export type SkadisJoin = 'both' | 'tabs' | 'plates' | 'none';
/** What holds the board off the wall: posts printed on the back, separate spacers, or nothing. */
export type SkadisStandoff = 'posts' | 'spacers' | 'none';
/** Where the slots are on the lattice: the standard staggered pattern, a square grid (two steps apart), or every point. */
export type SkadisPattern = 'skadis' | 'square' | 'dense';
/** A rim proud of the front all round (separate frame strips), with or without an LED channel round the back edge. */
export type SkadisFrame = 'none' | 'rim' | 'led';
/** How the board hangs: screws through it into the wall, a French cleat, hooks over a door, or on a desk. */
export type SkadisHang = 'screws' | 'cleat' | 'door' | 'desk';
/** A tile's place on the board's grid: (column, row) for rectangles, axial (q, r) for hexagons. */
export type SkadisCell = [number, number];

/** A solid area of a rectangle board, wall coordinates (mm), snapped to the lattice: no slots, and text or magnets. */
export interface SkadisZone {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'blank' | 'text' | 'magnets';
  /** Engraved in the front ('text'). */
  text: string;
}

export interface SkadisOptions {
  /** The space on the wall, mm: width (x) and height (y). A rectangle board fills it; hexagons fit in it. */
  width: number;
  height: number;
  shape: SkadisShape;
  /** Board thickness, mm. Standard boards are 5 mm; hooks are made for that. */
  thickness: number;
  /** Slot width and length, mm (standard: 5 × 15). */
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
  /** How tightly attachments' clips fit the slots (lib/wall/mount.ts). */
  fit: SlotFit;
  /** Slot pattern and lattice step, mm (standard: 'skadis', 20). */
  pattern: SkadisPattern;
  pitch: number;
  /** Rectangle boards: a frame, how far its rim stands proud of the front (mm), and the LED strip's width (mm). */
  frame: SkadisFrame;
  rimHeight: number;
  ledWidth: number;
  /** Rectangle boards: solid zones. */
  zones: SkadisZone[];
  /** Rectangle boards: how it hangs; the door's thickness for door hooks; on a desk, feet or clamps on its edge (that thick). */
  hang: SkadisHang;
  doorThickness: number;
  deskMount: 'stand' | 'clamp';
  deskThickness: number;
  /** Snap-on caps over the screw heads (screws through posts, up to 5 mm). */
  covers: boolean;
  /** 'tiles': the board is built from tiles added one by one (`tiles`); unset, it fills the space (`width` × `height`). */
  layout?: 'tiles';
  /** Built from tiles: where they are on the grid. */
  tiles: SkadisCell[];
  /** Built from tiles: their size, mm (a hexagon's, corner to corner; a rectangle's width; 0: the largest the bed takes), and a rectangle's height (0: as wide, or the largest). */
  tileSize: number;
  tileHeight: number;
}

/** Clip fit in the slots: tighter for a board that runs large, looser for one that runs small. */
export type SlotFit = 'snug' | 'normal' | 'loose';

export const DEFAULT_SKADIS: SkadisOptions = {
  // The standard square board.
  width: 560,
  height: 560,
  shape: 'rect',
  thickness: 5,
  // Standard boards' slots measure about 5.1 × 15.2; printed slots come out a little smaller than drawn.
  slotW: 5.1,
  slotL: 15.3,
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
  fit: 'normal',
  pattern: 'skadis',
  pitch: 20,
  frame: 'none',
  rimHeight: 5,
  ledWidth: 10,
  zones: [],
  hang: 'screws',
  doorThickness: 40,
  deskMount: 'stand',
  deskThickness: 25,
  covers: false,
  tiles: [[0, 0]],
  tileSize: 0,
  tileHeight: 0,
};

/** A new board: one tile, to add more to. */
export const NEW_SKADIS: SkadisOptions = { ...DEFAULT_SKADIS, layout: 'tiles' };

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
  /** Frame strips: pins (in holes 0.3 wider, 0.4 deeper) about every `every` mm; the LED channel's depth. */
  rim: { pinD: 3, pinH: 1.8, every: 60, led: 2 },
  /** Magnet pockets: magnet size, fit on the diameter, plastic left in front, centre to centre. */
  magnet: { d: 6, h: 2, fit: 0.2, skin: 1, every: 12 },
  /** Engraved text: depth, and the largest letters. */
  text: { depth: 0.8, size: 24 },
  /**
   * Screw covers: the cap's diameter (at least) and thickness; the hole's mouth (deep, round the head's
   * clearance), the groove under it (how much wider) and where the head's countersink starts; the cap's
   * legs (wall, slits, clearance in the mouth) and the largest screw they suit.
   */
  cover: { d: 14, t: 1.2, mouth: 1.5, groove: 0.5, sink: 4.5, wall: 0.9, slit: 1.2, fit: 0.15, maxScrew: 5 },
} as const;

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const pick = <T>(v: unknown, all: readonly T[], dflt: T): T => (all.includes(v as T) ? (v as T) : dflt);

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
    fit: r.fit === 'snug' || r.fit === 'loose' ? r.fit : 'normal',
    pattern: pick(r.pattern, ['skadis', 'square', 'dense'] as const, 'skadis'),
    pitch: Math.round(num(r.pitch, 14, 40, d.pitch) * 10) / 10,
    frame: pick(r.frame, ['none', 'rim', 'led'] as const, 'none'),
    rimHeight: num(r.rimHeight, 2, 12, d.rimHeight),
    ledWidth: pick(Number(r.ledWidth), [8, 10, 12], d.ledWidth),
    zones: (Array.isArray(r.zones) ? r.zones : [])
      .filter((z) => z && typeof z === 'object')
      .slice(0, 24)
      .map((z: Partial<SkadisZone>) => ({
        x: num(z.x, 0, 5000, 0),
        y: num(z.y, 0, 5000, 0),
        w: num(z.w, 5, 5000, 60),
        h: num(z.h, 5, 5000, 40),
        kind: pick(z.kind, ['blank', 'text', 'magnets'] as const, 'blank'),
        text: typeof z.text === 'string' ? z.text.slice(0, 40) : '',
      })),
    hang: pick(r.hang, ['screws', 'cleat', 'door', 'desk'] as const, 'screws'),
    doorThickness: num(r.doorThickness, 20, 70, d.doorThickness),
    deskMount: r.deskMount === 'clamp' ? 'clamp' : 'stand',
    deskThickness: num(r.deskThickness, 10, 80, d.deskThickness),
    covers: r.covers === undefined ? d.covers : !!r.covers,
    ...(r.layout === 'tiles' ? { layout: 'tiles' as const } : {}),
    tiles: cleanCells(r.tiles),
    tileSize: size(r.tileSize),
    tileHeight: size(r.tileHeight),
  };
}

/** A tile size: 60 to 1000 mm, or 0 (the largest). */
const size = (v: unknown) => (num(v, 0, 1000, 0) < 60 ? 0 : r1(num(v, 0, 1000, 0)));

/** Tiles' places: whole numbers, each once, 400 at most; one tile at least. */
function cleanCells(raw: unknown): SkadisCell[] {
  const seen = new Set<string>();
  const out: SkadisCell[] = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const cell: SkadisCell = [Math.round(num(c[0], -60, 60, 0)), Math.round(num(c[1], -60, 60, 0))];
    if (!seen.has(String(cell)) && out.length < 400) out.push(cell);
    seen.add(String(cell));
  }
  return out.length ? out : [[0, 0]];
}

/** Whether tiles fill the rectangle round them (so a frame or a cleat can go round or across it). */
export function cellsFull(cells: SkadisCell[]): boolean {
  const xs = cells.map((c) => c[0]);
  const ys = cells.map((c) => c[1]);
  return cells.length === (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1);
}

/** Width of the LED channel round the back edge. */
export const ledChannel = (o: Pick<SkadisOptions, 'ledWidth'>) => o.ledWidth + 0.4;
/** Width of the frame's rim: the border less the slots' chamfer and a little. */
export const rimWidth = (o: Pick<SkadisOptions, 'border' | 'chamfer'>) => r1(o.border - o.chamfer - 0.4);

/**
 * The options as planned (the same again when planned twice): a dense
 * pattern spaced for its slots (a step 4 mm longer than a slot at least), an
 * LED frame's border wide enough for its channel (and its walls), frames,
 * zones and other hanging for rectangle boards only (frames and hanging for
 * tiles that make a whole rectangle), and what a board that isn't screwed to
 * the wall rests on: posts with no screws (cleat, door hooks; a cleat as thick
 * as the gap, 12 mm at least, hooks 8) or nothing (desk).
 */
export function plannedSkadis(o: SkadisOptions): SkadisOptions {
  const rect = o.shape === 'rect';
  const whole = rect && (o.layout !== 'tiles' || cellsFull(o.tiles));
  const hang = whole ? o.hang : 'screws';
  const frame = whole ? o.frame : 'none';
  return {
    ...o,
    pitch: o.pattern === 'dense' ? Math.max(o.pitch, Math.ceil((o.slotL + 4) * 10) / 10) : o.pitch,
    border: frame === 'led' ? Math.max(o.border, r1(ledChannel(o) + o.chamfer + 1)) : o.border,
    frame,
    zones: rect ? o.zones : [],
    hang,
    standoff: hang === 'screws' ? o.standoff : hang === 'desk' || o.standoff === 'none' ? 'none' : 'posts',
    depth: hang === 'cleat' ? Math.max(o.depth, 12) : hang === 'door' ? Math.max(o.depth, 8) : o.depth,
  };
}

/** How far the board's back is off the wall (planned options): its standoffs or what holds it out (a cleat, door hooks); 0 flat on a wall or on a desk. */
export const skadisGap = (o: SkadisOptions) => (o.standoff !== 'none' || o.hang === 'cleat' || o.hang === 'door' ? o.depth : 0);
/** Room behind the board for attachments' clips: the gap, or plenty on a desk. */
export const skadisBehind = (o: SkadisOptions) => (o.hang === 'desk' ? 60 : skadisGap(o));

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const EPS = 1e-6;
const SQ3 = Math.sqrt(3);

/** Whether a pattern has a slot at lattice point (i, j) (either sign). */
export const patternSlot = (p: SkadisPattern, i: number, j: number) => p === 'dense' || (p === 'square' ? !(i & 1) && !(j & 1) : !((i + j) & 1));

/** Countersunk head diameter for a screw (90°). */
export const headDiameter = (screw: number) => 2 * screw + 0.5;

/** A screw hole made for a cover (planned options): the mouth's radius and depth, the groove's radius, where the countersink starts; null: no covers. */
export interface SkadisCoverHole {
  r: number;
  mouth: number;
  groove: number;
  sink: number;
}

/** The screw holes' recess for covers, when the board has them: screws through posts (the head sits in the post), up to 5 mm. */
export function coverHole(o: SkadisOptions): SkadisCoverHole | null {
  const C = SKADIS.cover;
  if (!o.covers || o.standoff !== 'posts' || o.screw > C.maxScrew + 1e-9) return null;
  const r = r3(headDiameter(o.screw) / 2 + 0.3);
  return { r, mouth: C.mouth, groove: r3(r + C.groove), sink: C.sink };
}

/** A screw cover: a round cap, slit legs below it with a barb round their middle that springs out into the hole's groove. */
export interface SkadisCapPart {
  d: number;
  t: number;
  /** The legs: outside radius, wall, how long below the cap, slit width; the barb's radius and where it starts below the cap. */
  r: number;
  wall: number;
  legs: number;
  slit: number;
  barb: number;
  catchAt: number;
}

export function skadisCapPart(h: SkadisCoverHole): SkadisCapPart {
  const C = SKADIS.cover;
  return {
    d: r3(Math.max(C.d, 2 * h.r + 4)),
    t: C.t,
    r: r3(h.r - C.fit),
    wall: C.wall,
    legs: r3(h.sink + 0.2),
    slit: C.slit,
    barb: r3(h.groove - C.fit),
    catchAt: r3(h.mouth + 0.1),
  };
}

export const capSize = (p: SkadisCapPart) => ({ w: p.d, d: p.d, h: r3(p.t + p.legs) });
/** Joint plates need room for their pocket and pin holes (1.5 mm at least) in the board. */
export const platesFit = (thickness: number) => thickness - SKADIS.plate.pocket - SKADIS.plate.minFloor >= 1.5 - 1e-9;
/** How deep the pin holes go (and so how long the pins are) in a board this thick. */
export const pinHoleDepth = (thickness: number) => Math.min(SKADIS.plate.holeDepth, thickness - SKADIS.plate.pocket - SKADIS.plate.minFloor);

// ---------------------------------------------------------------------------
// Planning (no kernel)
// ---------------------------------------------------------------------------

/** The slot lattice of a rectangle board: point (i, j) is at (ox + p i, oy + p j); the pattern says which have slots (the standard one: i + j even). */
export interface SkadisLattice {
  ox: number;
  oy: number;
  nx: number;
  ny: number;
  /** The step, mm. */
  p: number;
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

/** A mounting point: a standoff, and (`screw`) a countersunk hole through it; `hang`: just the hole, for a screw into a part the board hangs from. */
export interface SkadisMount {
  x: number;
  y: number;
  screw: boolean;
  tile: number;
  hang?: true;
}

/** A zone as planned: its edges snapped halfway between lattice columns (rows), so it takes whole ones. */
export interface SkadisZoneRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kind: SkadisZone['kind'];
  text: string;
}

/** A frame strip on the front border (wall coordinates), and its pins (into holes in the tiles). */
export interface SkadisRimStrip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pins: Vec2[];
}

/**
 * A part the board hangs from: a French cleat (the board's and the wall's), a
 * door hook, a desk foot or clamp. It is a profile in (z, y), z out from the
 * wall (the door, or the foot's back) and y up the wall as the board's, run
 * `len` along x from `x`; the board's back is at z = `board`.
 */
export interface SkadisHangPart {
  kind: 'boardCleat' | 'wallCleat' | 'hook' | 'foot' | 'clamp';
  x: number;
  len: number;
  profile: Vec2[];
  board: number;
  /** Holes along z at (x along the part, y): pilot holes for the board's screws, or (`sink`: head ⌀) countersunk ones for screws into the wall. */
  holes: { x: number; y: number; d: number; z0: number; z1: number; sink?: number }[];
  /** A clamp's bolt hole up through its lower jaw at (x, z), from y0 to y1, with a pocket for its nut at the top. */
  bolt?: { x: number; z: number; y0: number; y1: number };
  /** A foot's window (a triangle in (z, y), its walls left when built). */
  window?: Vec2[];
  /** Printed with its back on the bed ('back': as it hangs), face down ('front'), or on its side ('side': the profile on the bed). */
  pose: 'back' | 'front' | 'side';
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
  /**
   * Hexagons: their size and centres; built from tiles, the hexagon's corners (CCW from the top one, its box's
   * bottom-left at 0, 0) and the pockets for joint plates on its back (by centre, tile coordinates).
   */
  hex?: { w: number; h: number; centres: Vec2[]; poly?: Vec2[]; pockets?: Vec2[] };
  /**
   * Built from tiles: tile (q, r)'s place is origin + q·`q` + r·`r` (a hexagon's centre, a rectangle's
   * bottom-left corner), `at` each tile's (q, r) in tile order.
   */
  grid?: { origin: Vec2; q: Vec2; r: Vec2; at: SkadisCell[] };
  /** Slots on the whole board (rectangle: whole slots, a cut one counted once). */
  slots: number;
  /** Rectangle boards: zones, frame strips, magnet pockets (wall coordinates), the parts it hangs from and the screws into them (length, mm). */
  zones: SkadisZoneRect[];
  rim: SkadisRimStrip[];
  magnets: Vec2[];
  hang: SkadisHangPart[];
  hangScrew?: number;
  error?: string;
  warnings: string[];
}

/** A usable bed area, mm (pack.ts clearAreas). */
export interface BedArea {
  w: number;
  d: number;
}

export function skadisLattice(
  W: number,
  H: number,
  o: Pick<SkadisOptions, 'border' | 'slotW' | 'slotL'> & Partial<Pick<SkadisOptions, 'pitch' | 'pattern'>>,
): SkadisLattice {
  const P = o.pitch ?? SKADIS.pitch;
  const ex = o.border + o.slotW / 2;
  const ey = o.border + o.slotL / 2;
  // A square grid's slots are in the even columns and rows: an odd count puts slots at both edges.
  const odd = (n: number) => (o.pattern === 'square' ? n - 1 + (n & 1) : n);
  const nx = Math.max(0, odd(Math.floor((W - 2 * ex) / P + EPS) + 1));
  const ny = Math.max(0, odd(Math.floor((H - 2 * ey) / P + EPS) + 1));
  return { ox: r3((W - P * Math.max(nx - 1, 0)) / 2), oy: r3((H - P * Math.max(ny - 1, 0)) / 2), nx, ny, p: P };
}

/**
 * A rectangle board's slots (the pattern's, less the seams' columns, the rows
 * a dense board's level seams take, and the zones), its solid points (lattice
 * points without a slot, off the seams; on a dense board the middles between
 * four slots), and how much plastic a box leaves to the nearest slot. Built
 * from tiles (`grid`), only what is on the tiles: a slot with the border round
 * it, a solid point.
 */
function boardGrid(o: SkadisOptions, L: SkadisLattice, seamsX: number[], seamsY: number[], zones: SkadisZoneRect[], grid?: SkadisPlan['grid']) {
  const P = L.p;
  const dense = o.pattern === 'dense';
  const cols = new Set(seamsX.map((x) => Math.round((x - L.ox) / P)));
  const rows = new Set(dense ? seamsY.map((y) => Math.round((y - L.oy) / P)) : []);
  const at = (i: number, j: number): Vec2 => [r3(L.ox + P * i), r3(L.oy + P * j)];
  const tiles = grid && new Set(grid.at.map(String));
  // Every tile a box reaches is there (one on the line between two: both).
  const on = (x0: number, y0: number, x1: number, y1: number) => {
    if (!grid || !tiles) return true;
    const [cw, ch] = [grid.q[0], grid.r[1]];
    const [ox, oy] = grid.origin;
    for (let c = Math.floor((x0 - ox) / cw - EPS); c <= Math.floor((x1 - ox) / cw + EPS); c++)
      for (let r = Math.floor((y0 - oy) / ch - EPS); r <= Math.floor((y1 - oy) / ch + EPS); r++) if (!tiles.has(`${c},${r}`)) return false;
    return true;
  };
  const bw = o.slotW / 2 + o.border;
  const bl = o.slotL / 2 + o.border;
  const has = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= L.nx || j >= L.ny || cols.has(i) || rows.has(j) || !patternSlot(o.pattern, i, j)) return false;
    const [x, y] = at(i, j);
    return !zones.some((z) => x > z.x0 && x < z.x1 && y > z.y0 && y < z.y1) && on(x - bw, y - bl, x + bw, y + bl);
  };
  const a = (o.slotL - o.slotW) / 2;
  const clear = (x0: number, y0: number, x1 = x0, y1 = y0) => {
    let d = Infinity;
    for (let i = Math.floor((x0 - L.ox) / P) - 1; i <= Math.ceil((x1 - L.ox) / P) + 1; i++) {
      for (let j = Math.floor((y0 - L.oy) / P) - 2; j <= Math.ceil((y1 - L.oy) / P) + 2; j++) {
        if (!has(i, j)) continue;
        const [sx, sy] = at(i, j);
        d = Math.min(d, Math.hypot(Math.max(0, x0 - sx, sx - x1), Math.max(0, y0 - sy - a, sy - a - y1)) - o.slotW / 2);
      }
    }
    return d;
  };
  const solid: Vec2[] = [];
  for (let i = 0; i < L.nx; i++) {
    for (let j = 0; j < L.ny; j++) {
      if (dense) {
        if (i + 1 < L.nx && j + 1 < L.ny) solid.push(at(i + 0.5, j + 0.5));
      } else if (!cols.has(i) && !patternSlot(o.pattern, i, j)) solid.push(at(i, j));
    }
  }
  return { has, at, clear, solid: grid ? solid.filter(([x, y]) => on(x, y, x, y)) : solid, p: P };
}
type BoardGrid = ReturnType<typeof boardGrid>;

/** Zones snapped to the lattice: each edge halfway between two columns (rows), a column (row) wide at least, on the board. */
function zoneRects(o: SkadisOptions, L: SkadisLattice): SkadisZoneRect[] {
  const P = L.p;
  const snap = (v: number, o0: number) => r3(o0 + P * (Math.round((v - o0) / P - 0.5) + 0.5));
  return o.zones
    .map((z) => {
      const x0 = snap(z.x, L.ox);
      const y0 = snap(z.y, L.oy);
      const x1 = Math.min(o.width, Math.max(r3(x0 + P), snap(z.x + z.w, L.ox)));
      const y1 = Math.min(o.height, Math.max(r3(y0 + P), snap(z.y + z.h, L.oy)));
      return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1, y1, kind: z.kind, text: z.text };
    })
    .filter((z) => z.x1 > z.x0 && z.y1 > z.y0);
}

/** Where a zone's text or magnets go: inside it, clear of the slots next to it, inside the border. */
function zoneArea(o: SkadisOptions, z: SkadisZoneRect, P: number): [number, number, number, number] {
  const mx = Math.max(1.5, (o.slotW - P) / 2 + 1.5);
  const my = Math.max(1.5, (o.slotL - P) / 2 + 1.5);
  return [Math.max(z.x0 + mx, o.border), Math.max(z.y0 + my, o.border), Math.min(z.x1 - mx, o.width - o.border), Math.min(z.y1 - my, o.height - o.border)];
}

/** n points evenly from a to b (one: the middle). */
const spread = (a: number, b: number, n: number) => Array.from({ length: n }, (_, k) => r3(n === 1 ? (a + b) / 2 : a + ((b - a) * k) / (n - 1)));

/** A run from a to b in the fewest equal lengths up to `max`, each cut moved `keep` clear of `avoid`. */
function cutRun(a: number, b: number, max: number, avoid: number[], keep: number): [number, number][] {
  const n = b - a <= max ? 1 : Math.ceil((b - a) / (max - keep));
  const at = [a];
  for (let k = 1; k < n; k++) {
    const c = a + ((b - a) * k) / n;
    const near = avoid.find((v) => Math.abs(v - c) < keep);
    at.push(r3(near === undefined ? c : near + (c < near ? -keep : keep)));
  }
  at.push(b);
  return at.slice(1).map((v, k) => [at[k], v]);
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

export const fitsArea = (w: number, d: number, areas: BedArea[]) => areas.some((a) => (w <= a.w + EPS && d <= a.d + EPS) || (d <= a.w + EPS && w <= a.d + EPS));

/**
 * Planning a board built from tiles (skadisTiles.ts: the tiles' size, where
 * they go): not on the first screen, it loads with the first board, as the
 * attachments' kinds do (lib/wall/kinds/all.ts imports it). Until then such a
 * board plans empty.
 */
let tilesPlanner: ((o: SkadisOptions, areas: BedArea[]) => SkadisPlan) | undefined;
export const setTilesPlanner = (f: typeof tilesPlanner) => (tilesPlanner = f);

/** Plan a board for the space (or from the tiles) on the bed areas it prints on. */
export function planSkadis(raw: SkadisOptions, areas: BedArea[]): SkadisPlan {
  const o = plannedSkadis(raw);
  const plan = o.layout === 'tiles' ? (tilesPlanner?.(o, areas) ?? emptyPlan(o, '')) : o.shape === 'hex' ? planHex(o, areas) : planRect(o, areas);
  if (o.pitch > raw.pitch) plan.warnings.unshift(`Dense slots need a step of ${o.pitch} mm or more (4 mm more than a slot): the lattice is ${o.pitch} mm.`);
  return plan;
}

export function emptyPlan(o: SkadisOptions, error: string): SkadisPlan {
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
    zones: [],
    rim: [],
    magnets: [],
    hang: [],
    error,
    warnings: [],
  };
}

/**
 * A rectangle board built from tiles, laid out (skadisTiles.ts): the options with its size, its lattice (a point off
 * the board each side, so the edges are on lattice lines as the seams are), where the tiles' edges are across and up,
 * where they are on the grid, and whether there is one in column c, row r.
 */
export interface RectTiles {
  o: SkadisOptions;
  L: SkadisLattice;
  xs: number[];
  ys: number[];
  grid: NonNullable<SkadisPlan['grid']>;
  has: (c: number, r: number) => boolean;
}

/**
 * A rectangle board: filling the space, split into the fewest tiles that fit
 * the bed; or built from tiles (`cells`), each n × m steps, their edges on
 * lattice columns and rows (seams where two tiles meet, the edge where none
 * does: a slot the edge would cut isn't there).
 */
export function planRect(o: SkadisOptions, areas: BedArea[], cells?: RectTiles): SkadisPlan {
  const warnings: string[] = [];
  const plates = (o.join === 'both' || o.join === 'plates') && platesFit(o.thickness);
  const join: SkadisJoin = plates ? o.join : o.join === 'none' ? 'none' : 'tabs';
  const tabs = join === 'both' || join === 'tabs';
  // Tabs reach into the tile to the right and the one above.
  const reach = tabs ? SKADIS.tab.depth + SKADIS.tab.gap : 0;
  let L: SkadisLattice;
  let xs: number[];
  let ys: number[];
  let grid: SkadisPlan['grid'];
  let has = (_c: number, _r: number) => true;
  if (cells) ({ o, L, xs, ys, grid, has } = cells);
  else {
    L = skadisLattice(o.width, o.height, o);
    if (!L.nx || !L.ny) return emptyPlan(o, `The space is too small for a slot inside a ${o.border} mm border.`);
    const split = splitRect(o, areas, L, reach);
    if (!split) return emptyPlan(o, 'Could not split the board into tiles that fit this bed: make the border smaller, or pick a bigger printer.');
    [xs, ys] = split;
  }
  if ((o.join === 'both' || o.join === 'plates') && !plates)
    warnings.push(`A ${o.thickness} mm board is too thin for joint plates: the tiles only join with tabs.`);
  const W = o.width;
  const H = o.height;
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  const on = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && has(c, r);
  const seamsX = xs.slice(1, -1);
  const seamsY = ys.slice(1, -1);
  const tiles: SkadisTile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!on(c, r)) continue;
      tiles.push({
        id: tiles.length + 1,
        col: c,
        row: r,
        x0: xs[c],
        y0: ys[r],
        x1: xs[c + 1],
        y1: ys[r + 1],
        outer: { left: !on(c - 1, r), right: !on(c + 1, r), bottom: !on(c, r - 1), top: !on(c, r + 1) },
      });
      if (grid) grid.at.push([c - Math.round(grid.origin[0] / grid.q[0]), r - Math.round(grid.origin[1] / grid.r[1])]);
    }
  }
  const zones = zoneRects(o, L);
  const g = boardGrid(o, L, seamsX, seamsY, zones, grid);
  // Joints and mounts keep off the frame's rim and LED channel round the outer edge.
  const edge = o.frame === 'led' ? ledChannel(o) : o.frame === 'rim' ? rimWidth(o) : 0;
  const joints = planJoints(join, xs, ys, L, g, edge, warnings, on);
  const maxLen = Math.max(...areas.map((a) => Math.max(a.w, a.d))) - 2;
  const hung = planHang(o, tiles, g, seamsY, joints, planMounts(o, tiles, g, seamsY, joints, zones, edge), zones, maxLen, warnings);
  const mounts = hung.mounts;
  let slots = 0;
  for (let i = 0; i < L.nx; i++) for (let j = 0; j < L.ny; j++) if (g.has(i, j)) slots++;
  return {
    shape: 'rect',
    W,
    H,
    tiles,
    cols,
    rows,
    lattice: L,
    seamsX,
    seamsY,
    joints,
    mounts,
    slots,
    zones,
    rim: o.frame === 'none' ? [] : planRim(o, seamsX, seamsY, maxLen),
    magnets: planMagnets(o, zones, g, seamsX, seamsY, joints, mounts, edge),
    hang: hung.parts,
    ...(hung.screw ? { hangScrew: hung.screw } : {}),
    ...(grid ? { grid } : {}),
    warnings,
  };
}

/** A space split into the fewest tiles that fit the bed, the most even way: where the tiles' edges are, across and up. */
function splitRect(o: SkadisOptions, areas: BedArea[], L: SkadisLattice, reach: number): [number[], number[]] | null {
  const P = L.p;
  const colX = (i: number) => r3(L.ox + P * i);
  const rowY = (j: number) => r3(L.oy + P * j);
  // Upright seams on a slot column (it loses its slots), level ones through a row of slots (a dense board's lose theirs); a
  // square grid's along its empty columns and rows. Never in the outermost ones.
  const inner = (n: number) => Array.from({ length: Math.max(0, n - 2) }, (_, k) => k + 1).filter((k) => o.pattern !== 'square' || k & 1);
  const cutsX = inner(L.nx).map(colX);
  const cutsY = inner(L.ny).map(rowY);
  let best: { xs: number[]; ys: number[]; score: number[] } | null = null;
  for (const a of areas) {
    for (const [mw, mh] of [
      [a.w, a.d],
      [a.d, a.w],
    ]) {
      const xs = partition(o.width, cutsX, mw - reach);
      const ys = partition(o.height, cutsY, mh - reach);
      if (!xs || !ys) continue;
      const score = [(xs.length - 1) * (ys.length - 1), balanceScore(xs) + balanceScore(ys)];
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1] - EPS)) best = { xs, ys, score };
    }
  }
  return best && [best.xs, best.ys];
}

/**
 * Joints along the seams: plates where seams cross, then evenly spaced sites along each stretch of seam, all clear of
 * the slots. `on`: whether there is a tile in column c, row r (a seam only where two are, a crossing's plate where four).
 */
function planJoints(
  join: SkadisJoin,
  xs: number[],
  ys: number[],
  L: SkadisLattice,
  g: BoardGrid,
  edge: number,
  warnings: string[],
  on: (c: number, r: number) => boolean,
): SkadisJoint[] {
  if (join === 'none') return [];
  const P = L.p;
  const plates = join === 'both' || join === 'plates';
  const out: SkadisJoint[] = [];
  const seamsX = xs.slice(1, -1);
  const seamsY = ys.slice(1, -1);
  // A joint's room (its plate's pocket, or its tab and socket) leaves 1.2 mm of plastic to the slots.
  const half = SKADIS.plate.size / 2 + SKADIS.plate.gap;
  const { depth, head, gap } = SKADIS.tab;
  const hw = head / 2 + gap;
  const fits = (x: number, y: number, seam: SkadisJoint['seam']) =>
    (plates || seam === 'xy'
      ? g.clear(x - half, y - half, x + half, y + half)
      : seam === 'x'
        ? g.clear(x - 0.5, y - hw, x + depth + gap, y + hw)
        : g.clear(x - hw, y - 0.5, x + hw, y + depth + gap)) >= 1.2;
  const four = (c: number, r: number) => on(c, r) && on(c + 1, r) && on(c, r + 1) && on(c + 1, r + 1);
  if (plates) seamsX.forEach((x, c) => seamsY.forEach((y, r) => four(c, r) && fits(x, y, 'xy') && out.push({ kind: 'plate', x, y, seam: 'xy' })));
  // Room left for a crossing's plate (and a joint's own half), and from the outer edge (and its LED channel).
  const fromCross = SKADIS.plate.size / 2 + SKADIS.plate.gap + 12;
  const fromEdge = Math.max(half + 3, edge + half + 1);
  let bare = false;
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
  // Joints at the sites that clear the slots; a stretch with sites but none clear (a short step) goes without.
  const place = (a: number, b: number, sites: number[], ok: (v: number) => boolean, add: (v: number, k: number) => void) => {
    const at = pick(a, b, sites.filter(ok));
    if (!at.length && pick(a, b, sites).length) bare = true;
    at.forEach(add);
  };
  const rowsY = Array.from({ length: L.ny }, (_, j) => r3(L.oy + P * j));
  // Each stretch between two tiles, its ends at a crossing where a tile is past either.
  seamsX.forEach((x, c) => {
    for (let r = 0; r + 1 < ys.length; r++) {
      if (!on(c, r) || !on(c + 1, r)) continue;
      const a = ys[r] + (on(c, r - 1) || on(c + 1, r - 1) ? fromCross : fromEdge);
      const b = ys[r + 1] - (on(c, r + 1) || on(c + 1, r + 1) ? fromCross : fromEdge);
      place(
        a,
        b,
        rowsY,
        (y) => fits(x, y, 'x'),
        (y, k) => out.push({ kind: kindAt(k), x, y, seam: 'x' }),
      );
    }
  });
  seamsY.forEach((y, r) => {
    const j = Math.round((y - L.oy) / P);
    // Along a level seam, only where no slot is (cut): the solid lattice points of its row.
    const empty = Array.from({ length: L.nx }, (_, i) => i)
      .filter((i) => !g.has(i, j))
      .map((i) => r3(L.ox + P * i));
    for (let c = 0; c + 1 < xs.length; c++) {
      if (!on(c, r) || !on(c, r + 1)) continue;
      const a = xs[c] + (on(c - 1, r) || on(c - 1, r + 1) ? fromCross : fromEdge);
      const b = xs[c + 1] - (on(c + 1, r) || on(c + 1, r + 1) ? fromCross : fromEdge);
      place(
        a,
        b,
        empty,
        (x) => fits(x, y, 'y'),
        (x, k) => out.push({ kind: kindAt(k), x, y, seam: 'y' }),
      );
    }
  });
  if (bare) warnings.push('At this step some stretches of seam have no room for a joint clear of the slots: make the step longer, or the bed bigger.');
  return out;
}

/** Radius a mounting point keeps clear around itself on the board. */
const mountRadius = (o: Pick<SkadisOptions, 'standoff' | 'screw'>) =>
  o.standoff === 'posts' ? SKADIS.post.r0 : Math.max(headDiameter(o.screw) / 2, o.standoff === 'spacers' ? SKADIS.spacer.d / 2 : 0);

/** Whether (x, y) is under a zone's text or magnets, `m` round it. */
const underZone = (zones: SkadisZoneRect[], x: number, y: number, m: number) =>
  zones.some((z) => z.kind !== 'blank' && x > z.x0 - m && x < z.x1 + m && y > z.y0 - m && y < z.y1 + m);

/** Mounting points on each tile: near its corners and about every `mountEvery` between, on solid points clear of the slots. */
function planMounts(
  o: SkadisOptions,
  tiles: SkadisTile[],
  g: BoardGrid,
  seamsY: number[],
  joints: SkadisJoint[],
  zones: SkadisZoneRect[],
  edge: number,
): SkadisMount[] {
  if (o.hang === 'desk') return [];
  const rad = mountRadius(o);
  const ok = g.solid.filter(([x, y]) => g.clear(x, y) >= rad + 1 && !underZone(zones, x, y, rad));
  const out: SkadisMount[] = [];
  for (const t of tiles) {
    const m = rad + 2;
    // Off the LED channel on the outer edges.
    const e = (outer: boolean) => (outer ? Math.max(m, edge + rad + 0.5) : m);
    const cands = ok.filter(
      ([x, y]) =>
        x >= t.x0 + e(t.outer.left) &&
        x <= t.x1 - e(t.outer.right) &&
        y >= t.y0 + e(t.outer.bottom) &&
        y <= t.y1 - e(t.outer.top) &&
        !seamsY.some((s) => Math.abs(s - y) < m) &&
        !joints.some((jt) => Math.hypot(jt.x - x, jt.y - y) < 20 - EPS),
    );
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

/**
 * The parts a board that isn't screwed to the wall hangs from, and its
 * mounts: the others become rests (posts with no screw; none without posts),
 * those in the parts' way go, and countersunk holes for the screws into the
 * parts are added on solid points (two steps apart in a column for a hook or
 * a foot, so they line up on every pattern).
 * - French cleat (as thick as the gap): the board's strip screwed on across
 *   the top, its 45° edge down and toward the wall, over the wall's strip,
 *   whose 45° edge is up; both in lengths that fit the bed.
 * - Door hooks (2, 3 over 700 mm): over the top of the door, 2.5 mm thick there;
 *   the board's top 2 mm under the door's.
 * - Desk feet or clamps (as many): the bottom edge in a groove, a 12 mm brace
 *   behind it; a foot reaches back and forward on the desk, a clamp takes the
 *   desk's edge with an M6 bolt up through its lower jaw.
 */
function planHang(
  o: SkadisOptions,
  tiles: SkadisTile[],
  g: BoardGrid,
  seamsY: number[],
  joints: SkadisJoint[],
  mounts: SkadisMount[],
  zones: SkadisZoneRect[],
  maxLen: number,
  warnings: string[],
): { mounts: SkadisMount[]; parts: SkadisHangPart[]; screw?: number } {
  if (o.hang === 'screws') return { mounts, parts: [] };
  const P = g.p;
  const W = o.width;
  const H = o.height;
  const headR = headDiameter(o.screw) / 2;
  const cleat = o.hang === 'cleat';
  const door = o.hang === 'door';
  // Where the board's back is in the parts' profiles (a foot's brace is 12 mm), and how deep the screws go into them.
  const gap = cleat || door ? o.depth : 12;
  const dp = Math.min(gap - 2, cleat ? 16 : 14);
  if (tiles.length > 1 && o.join === 'none') warnings.push('Tiles that aren’t joined can’t hang from one another: join them.');
  // Solid points a screw into a part can go through: clear of the slots, seams, joints, text and magnets.
  const pts = g.solid.filter(
    ([x, y]) =>
      g.clear(x, y) >= headR + 1 &&
      !seamsY.some((s) => Math.abs(s - y) < headR + 1.5) &&
      !joints.some((j) => Math.max(Math.abs(j.x - x), Math.abs(j.y - y)) < 13) &&
      !underZone(zones, x, y, headR),
  );
  const keys = new Set(pts.map(String));
  const r0 = o.standoff === 'posts' ? SKADIS.post.r0 : 0;
  let rests = o.standoff === 'none' ? [] : mounts.map((m) => ({ ...m, screw: false }));
  const parts: SkadisHangPart[] = [];
  const holes: Vec2[] = [];
  const pilot = (x: number, y: number) => ({ x, y, d: r1(o.screw * 0.75), z0: gap - dp, z1: gap + 1 });
  let bare = false;
  if (cleat) {
    const hw = Math.max(40, r1(gap + 2 * headR + 10));
    // The highest row the board's cleat (40 mm high at the board) can screw on, under the board's top.
    const row = (y: number) => pts.filter((p) => p[1] === y && p[0] > 20 && p[0] < W - 20);
    const yr = pts
      .map((p) => p[1])
      .sort((a, b) => b - a)
      .find((y) => y + 22 <= H && row(y).length > 1);
    bare = yr === undefined;
    if (yr !== undefined) {
      const along = row(yr);
      const at = [
        ...new Set(
          spread(30, W - 30, Math.max(2, Math.round((W - 60) / 120) + 1)).map((tx) =>
            along.reduce((p, q) => (Math.abs(q[0] - tx) < Math.abs(p[0] - tx) ? q : p)),
          ),
        ),
      ];
      const y0 = yr - 20;
      for (const [a, b] of cutRun(
        10,
        W - 10,
        maxLen,
        at.map((p) => p[0]),
        12,
      )) {
        const len = r3(b - a);
        const n = Math.max(2, Math.round((len - 50) / 150) + 1);
        parts.push(
          {
            kind: 'boardCleat',
            x: a,
            len,
            board: gap,
            pose: 'back',
            profile: [
              [0, y0 - gap],
              [gap, y0],
              [gap, yr + 20],
              [0, yr + 20],
            ],
            holes: at.filter((p) => p[0] > a && p[0] < b).map((p) => pilot(r3(p[0] - a), yr)),
          },
          {
            kind: 'wallCleat',
            x: a,
            len,
            board: gap,
            pose: 'front',
            profile: [
              [0, y0 - hw],
              [gap, y0 - hw],
              [gap, y0],
              [0, y0 - gap],
            ],
            holes: spread(25, len - 25, n).map((u) => ({ x: u, y: r3(y0 - (hw + gap) / 2), d: o.screw + 0.5, z0: -1, z1: gap + 1, sink: 2 * headR })),
          },
        );
      }
      holes.push(...at);
      rests = rests.filter((m) => m.y + r0 < y0 - hw - 1);
    }
  } else {
    // Desk: the groove the bottom edge (and a frame's rim) sits in, the base under it.
    const front = r3(12 + o.thickness + 0.3 + (o.frame === 'none' ? 0 : o.rimHeight));
    const gv = Math.min(5, Math.max(2, o.border - 2));
    const yd = gv - 8;
    const T = o.doorThickness + 1;
    for (const f of W > 700 ? [0.15, 0.5, 0.85] : [0.2, 0.8]) {
      // Two points two steps apart in a column, near f W and the top (door) or the bottom (desk).
      let p: number[] | undefined;
      let score = Infinity;
      for (const [x, y] of pts) {
        const y2 = r3(y + (door ? -2 : 2) * P);
        const s = Math.abs(x - f * W) + 2 * (door ? H - y : y);
        if (s < score && keys.has(`${x},${y2}`)) [p, score] = [[x, y, y2], s];
      }
      if (!p) {
        bare = true;
        continue;
      }
      const [x, y1, y2] = p;
      const part: SkadisHangPart = { kind: 'hook', x: r3(x - 10), len: 20, board: gap, pose: 'side', profile: [], holes: [y1, y2].map((y) => pilot(10, y)) };
      const top = y2 + 14;
      if (door) {
        const [low, t] = [y2 - 12, H + 2];
        part.profile = [
          [-T - 3, t - 25],
          [-T, t - 25],
          [-T, t],
          [0, t],
          [0, low],
          [gap, low],
          [gap, t + 2.5],
          [-T - 3, t + 2.5],
        ];
        rests = rests.filter((m) => Math.abs(m.x - x) > 11 + r0 || m.y + r0 < low - 1);
      } else if (o.deskMount === 'stand') {
        // Back and forward on the desk about a quarter and an eighth of the board's height.
        const lb = r1(Math.min(100, Math.max(40, H / 4)));
        const lf = front + r1(Math.min(60, Math.max(25, H / 8)));
        part.kind = 'foot';
        part.profile = [
          [-lb, yd],
          [lf, yd],
          [lf, gv],
          [front, gv],
          [front, 0],
          [12, 0],
          [12, top],
          [0, top],
          [-lb, gv],
        ];
        part.window = [
          [0, gv],
          [0, top],
          [-lb, gv],
        ];
      } else {
        // A 6 mm spine down the desk's edge, a 9 mm lower jaw with the bolt.
        const yu = r3(yd - o.deskThickness - 0.5);
        const lj = Math.max(50, front + 20);
        part.kind = 'clamp';
        part.profile = [
          [-6, yu - 9],
          [lj, yu - 9],
          [lj, yu],
          [0, yu],
          [0, yd],
          [lj, yd],
          [lj, gv],
          [front, gv],
          [front, 0],
          [12, 0],
          [12, top],
          [-6, top],
        ];
        part.bolt = { x: 10, z: lj - 12, y0: yu - 9, y1: yu };
      }
      parts.push(part);
      holes.push([x, y1], [x, y2]);
    }
  }
  if (bare) warnings.push('No room on the board for the screws into what it hangs from.');
  const tile = (x: number, y: number) => tiles.find((t) => x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1)?.id ?? 0;
  return {
    mounts: [...rests, ...holes.map(([x, y]): SkadisMount => ({ x, y, screw: true, tile: tile(x, y), hang: true }))],
    parts,
    screw: r1(o.thickness + dp),
  };
}

/**
 * Frame strips on the front border: the top and bottom ones the board's width,
 * the sides between them, in lengths that fit the bed (cut 30 mm clear of the
 * seams, so they bridge them), with pins about every 60 mm, each on one tile.
 */
function planRim(o: SkadisOptions, seamsX: number[], seamsY: number[], maxLen: number): SkadisRimStrip[] {
  const W = o.width;
  const H = o.height;
  const rw = rimWidth(o);
  const out: SkadisRimStrip[] = [];
  const runs = [
    [0, 0, W, rw],
    [0, H - rw, W, H],
    [0, rw, rw, H - rw],
    [W - rw, rw, W, H - rw],
  ];
  runs.forEach(([x0, y0, x1, y1], k) => {
    const level = k < 2;
    const [a, b] = level ? [x0, x1] : [y0, y1];
    const seams = level ? seamsX : seamsY;
    const mid = r3(level ? (y0 + y1) / 2 : (x0 + x1) / 2);
    // Pins clear of the board's rounded corners, the strip's ends and the seams.
    const end = Math.max(15, o.corner + 4);
    for (const [s0, s1] of cutRun(a, b, maxLen, seams, 30)) {
      const pins = spread(s0 + end, s1 - end, Math.max(2, Math.round((s1 - s0 - 2 * end) / SKADIS.rim.every) + 1)).map((u) => {
        const s = seams.find((v) => Math.abs(v - u) < 4);
        const v = s === undefined ? u : r3(s + (u < s ? -4 : 4));
        return (level ? [v, mid] : [mid, v]) as Vec2;
      });
      out.push(level ? { x0: s0, y0, x1: s1, y1, pins } : { x0, y0: s0, x1, y1: s1, pins });
    }
  });
  return out;
}

/** Magnet pockets in the magnet zones: a grid 12 mm apart, each on one tile, clear of the slots, seams, joints, mounts and LED channel. */
function planMagnets(
  o: SkadisOptions,
  zones: SkadisZoneRect[],
  g: BoardGrid,
  seamsX: number[],
  seamsY: number[],
  joints: SkadisJoint[],
  mounts: SkadisMount[],
  edge: number,
): Vec2[] {
  const M = SKADIS.magnet;
  const r = (M.d + M.fit) / 2;
  const rad = mountRadius(o);
  const out: Vec2[] = [];
  for (const z of zones) {
    if (z.kind !== 'magnets') continue;
    const [x0, y0, x1, y1] = zoneArea(o, z, g.p);
    const nx = Math.floor((x1 - x0 - 2 * r) / M.every + EPS) + 1;
    const ny = Math.floor((y1 - y0 - 2 * r) / M.every + EPS) + 1;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const x = r3((x0 + x1) / 2 + (i - (nx - 1) / 2) * M.every);
        const y = r3((y0 + y1) / 2 + (j - (ny - 1) / 2) * M.every);
        if (
          g.clear(x - r, y - r, x + r, y + r) < 1.2 ||
          seamsX.some((s) => Math.abs(s - x) < r + 1) ||
          seamsY.some((s) => Math.abs(s - y) < r + 1) ||
          joints.some((jt) => Math.max(Math.abs(jt.x - x), Math.abs(jt.y - y)) < 10.2 + r + 1.2) ||
          mounts.some((m) => Math.hypot(m.x - x, m.y - y) < (m.hang ? headDiameter(o.screw) / 2 : rad) + r + 1) ||
          Math.min(x, y, o.width - x, o.height - y) < edge + r + 1
        )
          continue;
        out.push([x, y]);
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
  return hexPlan(o, W, H, hw, hh, tiles, placed, nc, Math.max(...Array.from({ length: nc }, (_, k) => colRows(k))));
}

/** A hexagon board from its tiles, every one alike: its mounting points and slot count (`poly`: built from tiles, the hexagon's corners). */
export function hexPlan(
  o: SkadisOptions,
  W: number,
  H: number,
  hw: number,
  hh: number,
  tiles: SkadisTile[],
  centres: Vec2[],
  cols: number,
  rows: number,
  poly?: Vec2[],
  grid?: SkadisPlan['grid'],
): SkadisPlan {
  const local = hexLocalMounts(o, hw, poly);
  return {
    shape: 'hex',
    W,
    H,
    tiles,
    cols,
    rows,
    seamsX: [],
    seamsY: [],
    joints: [],
    mounts: tiles.flatMap((t) => local.map((m) => ({ x: r3(t.x0 + m.x), y: r3(t.y0 + m.y), screw: m.screw, tile: t.id }))),
    hex: { w: r3(hw), h: r3(hh), centres, ...(poly ? { poly } : {}) },
    slots: hexSlots(o, hw, hh, local, poly, grid ? hexPar(o) : 0).length * tiles.length,
    zones: [],
    rim: [],
    magnets: [],
    hang: [],
    ...(grid ? { grid } : {}),
    warnings: [],
  };
}

/** Where a hexagon's centre is on the lattice, built from tiles: off the slots on a square grid (so the upright edges between them are too). */
export const hexPar = (o: Pick<SkadisOptions, 'pattern'>) => (o.pattern === 'square' ? 1 : 0);

/**
 * A hexagon's mounting points (tile coordinates): one in each corner, far
 * enough in for its standoff. Screws go in the left and right corners (the
 * top and bottom ones of a hexagon on a corner, built from tiles, `poly`); the
 * other four are posts the board rests on. Separate spacers need a screw
 * each to stay put, so with them every corner gets one.
 */
function hexLocalMounts(o: SkadisOptions, hw: number, poly?: Vec2[]): { x: number; y: number; screw: boolean }[] {
  const hh = (hw * SQ3) / 2;
  const rad = mountRadius(o);
  const pts = poly ?? hexCorners(hw / 2, hh / 2, hw);
  return pts.flatMap(([x, y], k) => {
    const side = k === 0 || k === 3;
    if (o.standoff !== 'posts' && o.standoff !== 'spacers' && !side) return [];
    // In along the corner's bisector (a regular hexagon's: toward its middle), far enough from both edges, the rounding and the border.
    let [ux, uy, sin] = [(hw / 2 - x) / (hw / 2), (hh / 2 - y) / (hw / 2), Math.sin(Math.PI / 3)];
    if (poly) {
      const p = norm([pts[(k + 5) % 6][0] - x, pts[(k + 5) % 6][1] - y]);
      const q = norm([pts[(k + 1) % 6][0] - x, pts[(k + 1) % 6][1] - y]);
      [ux, uy] = norm([p[0] + q[0], p[1] + q[1]]);
      sin = Math.sqrt((1 - p[0] * q[0] - p[1] * q[1]) / 2);
    }
    const inset = (rad + 2.5) / sin + o.corner * 0.3;
    return [{ x: r3(x + ux * inset), y: r3(y + uy * inset), screw: o.standoff === 'spacers' || side }];
  });
}

/** Slots of one hexagon (tile coordinates): the pattern on a lattice centred on it, inside its border, clear of its mounts. */
function hexSlots(o: SkadisOptions, hw: number, hh: number, mounts: { x: number; y: number }[], poly?: Vec2[], par = 0): Vec2[] {
  const P = o.pitch;
  const cx = hw / 2;
  const cy = hh / 2;
  const corners = poly ?? hexCorners(cx, cy, hw);
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
  const n = Math.ceil(Math.max(hw, hh) / P) + 1;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (!patternSlot(o.pattern, i + par, j + par)) continue;
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

/**
 * Every slot an attachment can use, wall coordinates (slot centres): on a
 * rectangle board the pattern less the seams it loses and the zones (a slot a
 * level seam cuts is whole once the tiles are together), on hexagons each
 * one's own (on one lattice when built from tiles).
 */
export function boardSlots(plan: SkadisPlan, raw: SkadisOptions): Vec2[] {
  const o = plannedSkadis(raw);
  if (plan.shape === 'hex' && plan.hex) {
    const { w: hw, poly } = plan.hex;
    const local = hexSlots(o, hw, poly ? plan.hex.h : (hw * SQ3) / 2, hexLocalMounts(o, hw, poly), poly, plan.grid ? hexPar(o) : 0);
    // Built from tiles, exactly on the board's one lattice.
    const g = plan.grid;
    const at = (v: number, k: 0 | 1) => (g ? r3(g.origin[k] + o.pitch * Math.round((v - g.origin[k]) / o.pitch)) : r3(v));
    return plan.tiles.flatMap((t) => local.map(([x, y]) => [at(t.x0 + x, 0), at(t.y0 + y, 1)] as Vec2));
  }
  const L = plan.lattice;
  if (!L || !plan.tiles.length) return [];
  const g = boardGrid(o, L, plan.seamsX, plan.seamsY, plan.zones, plan.grid);
  const out: Vec2[] = [];
  for (let i = 0; i < L.nx; i++) for (let j = 0; j < L.ny; j++) if (g.has(i, j)) out.push(g.at(i, j));
  return out;
}

/** Outline of each tile on the wall (CCW), for drawing the board. */
export function tileOutlines(plan: SkadisPlan, o: SkadisOptions): Vec2[][] {
  if (plan.shape === 'hex' && plan.hex) {
    const { w: hw, poly } = plan.hex;
    return plan.tiles.map((t) =>
      roundedPolygon(poly ? poly.map(([x, y]) => [r3(t.x0 + x), r3(t.y0 + y)] as Vec2) : hexCorners((t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2, hw), o.corner),
    );
  }
  return plan.tiles.map((t) => [
    [t.x0, t.y0],
    [t.x1, t.y0],
    [t.x1, t.y1],
    [t.x0, t.y1],
  ]);
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
  /** `hang`: a countersunk hole without a post, for a screw into a part the board hangs from. */
  mounts: { x: number; y: number; screw: boolean; hang?: true }[];
  /** Posts on the back this tall, or 0. */
  posts: number;
  screw: number;
  number?: { text: string; x: number; y: number };
  /** Holes in the front for the frame strips' pins: their diameter and depth. */
  pins?: { at: Vec2[]; d: number; depth: number };
  /** The screw holes through posts are made for covers. */
  cover?: SkadisCoverHole;
  /** The LED channel round the back of its outer edges (left, right, bottom, top): width and depth; deeper where two meet. */
  led?: { w: number; d: number; sides: [boolean, boolean, boolean, boolean] };
  /** Text engraved in the front, fitted to a box (its centre and size). */
  text?: { text: string; x: number; y: number; w: number; h: number }[];
  /** Magnet pockets from the back, by centre. */
  magnets?: Vec2[];
}

/** The frame strips' pins: hole depth in the front (leaving 0.8 mm under an LED channel), and pin length. */
export function rimPins(o: Pick<SkadisOptions, 'thickness' | 'frame'>): { depth: number; pin: number } {
  const depth = r3(Math.min(SKADIS.rim.pinH + 0.4, o.thickness - (o.frame === 'led' ? ledDepth(o) : 0) - 0.8));
  return { depth, pin: r3(depth - 0.4) };
}
/** How deep the LED channel goes into the back. */
export const ledDepth = (o: Pick<SkadisOptions, 'thickness'>) => r3(Math.min(SKADIS.rim.led, o.thickness - 2.3));

/** The spec for each tile of a plan, in tile order. */
export function skadisTileSpecs(plan: SkadisPlan, raw: SkadisOptions): SkadisTileSpec[] {
  // Built from tiles, the board is as big as they make it.
  const o = { ...plannedSkadis(raw), width: plan.W, height: plan.H };
  const posts = o.standoff === 'posts' ? r3(o.depth) : 0;
  const cover = coverHole(o);
  const common = {
    t: o.thickness,
    chamfer: o.chamfer,
    slotW: o.slotW,
    slotL: o.slotL,
    pinHole: r3(pinHoleDepth(o.thickness)),
    posts,
    screw: o.screw,
    ...(cover ? { cover } : {}),
  };
  if (plan.shape === 'hex' && plan.hex) {
    const { w: hw, h: hh, poly } = plan.hex;
    const local = hexLocalMounts(o, hw, poly);
    const slots = hexSlots(o, hw, poly ? hh : (hw * SQ3) / 2, local, poly, plan.grid ? hexPar(o) : 0);
    const outline = roundedPolygon(poly ?? hexCorners(hw / 2, hh / 2, hw), o.corner);
    // Hexagons go up in any order: no numbers, so they are all one part.
    return plan.tiles.map(() => ({ outline, ...common, slots, tabs: [], sockets: [], pockets: plan.hex?.pockets ?? [], mounts: local }));
  }
  const L = plan.lattice;
  if (!L) return [];
  const P = L.p;
  const g = boardGrid(o, L, plan.seamsX, plan.seamsY, plan.zones, plan.grid);
  const sl = o.slotL / 2;
  const sw = o.slotW / 2;
  const pinAt = plan.rim.flatMap((s) => s.pins);
  const pinD = SKADIS.rim.pinD + 0.3;
  return plan.tiles.map((t) => {
    const at = (x: number, y: number): Vec2 => [r3(x - t.x0), r3(y - t.y0)];
    const inTile = ([x, y]: Vec2) => x > t.x0 && x < t.x1 && y > t.y0 && y < t.y1;
    const slots: Vec2[] = [];
    for (let i = 0; i < L.nx; i++) {
      const x = L.ox + P * i;
      if (x + sw < t.x0 - EPS || x - sw > t.x1 + EPS) continue;
      for (let j = 0; j < L.ny; j++) {
        if (!g.has(i, j)) continue;
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
    const mounts = plan.mounts.filter((m) => m.tile === t.id).map((m) => ({ ...pt(at(m.x, m.y)), screw: m.screw, ...(m.hang ? { hang: m.hang } : {}) }));
    const magnets = plan.magnets.filter(inTile).map(([x, y]) => at(x, y));
    let number: SkadisTileSpec['number'];
    if (o.numbers) {
      // A solid point near the middle, clear of the mounts, the joints and the magnets.
      const busy = [
        ...mounts.map((m) => [m.x, m.y] as Vec2),
        ...pockets,
        ...tabs.map((b) => [b.x, b.y] as Vec2),
        ...sockets.map((b) => [b.x, b.y] as Vec2),
        ...magnets,
      ];
      const tw = t.x1 - t.x0;
      const th = t.y1 - t.y0;
      let best: Vec2 | null = null;
      for (const s of g.solid) {
        const [x, y] = at(s[0], s[1]);
        if (x < 15 || x > tw - 15 || y < 12 || y > th - 12) continue;
        if (busy.some((b) => Math.hypot(b[0] - x, b[1] - y) < 19)) continue;
        if (!best || Math.hypot(x - tw / 2, y - th / 2) < Math.hypot(best[0] - tw / 2, best[1] - th / 2)) best = [x, y];
      }
      if (best) number = { text: String(t.id), x: best[0], y: best[1] };
    }
    const pins = pinAt.filter(inTile).map(([x, y]) => at(x, y));
    const sides: [boolean, boolean, boolean, boolean] = [t.outer.left, t.outer.right, t.outer.bottom, t.outer.top];
    const text = plan.zones.flatMap((z) => {
      const [x0, y0, x1, y1] = zoneArea(o, z, P);
      return z.kind === 'text' && z.text.trim() && x1 > t.x0 && x0 < t.x1 && y1 > t.y0 && y0 < t.y1 && x1 > x0 && y1 > y0
        ? [{ text: z.text.trim(), ...pt(at((x0 + x1) / 2, (y0 + y1) / 2)), w: r3(x1 - x0), h: r3(y1 - y0) }]
        : [];
    });
    return {
      outline,
      ...common,
      slots,
      tabs,
      sockets,
      pockets,
      mounts,
      ...(number ? { number } : {}),
      ...(pins.length ? { pins: { at: pins, d: pinD, depth: rimPins(o).depth } } : {}),
      ...(o.frame === 'led' && sides.some(Boolean) ? { led: { w: r3(ledChannel(o)), d: ledDepth(o), sides } } : {}),
      ...(text.length ? { text } : {}),
      ...(magnets.length ? { magnets } : {}),
    };
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

export function norm(v: Vec2): Vec2 {
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

/** A frame strip as built: its place on the board (W × H, corner radius R: it follows the rounded corners), how proud it stands, its pins. */
export interface SkadisRimPart extends SkadisRimStrip {
  W: number;
  H: number;
  R: number;
  height: number;
  pinD: number;
  pinH: number;
}

/** A hanging part's size as printed, and where its profile's box starts (z, y). */
export function hangPartSize(p: SkadisHangPart): { w: number; d: number; h: number; z0: number; y0: number } {
  const zs = p.profile.map((q) => q[0]);
  const ys = p.profile.map((q) => q[1]);
  const z0 = Math.min(...zs);
  const y0 = Math.min(...ys);
  const dz = r3(Math.max(...zs) - z0);
  const dy = r3(Math.max(...ys) - y0);
  return p.pose === 'side' ? { w: dz, d: dy, h: p.len, z0, y0 } : { w: p.len, d: dy, h: dz, z0, y0 };
}

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
      if (spec.posts > 0 && !m.hang) adds.push(s.t(cylinderAt(w, m.x, m.y, t - 0.01, t + spec.posts, SKADIS.post.r0, SKADIS.post.r1, 48)));
      if (!m.screw) continue;
      cuts.push(s.t(cylinderAt(w, m.x, m.y, -1, t + spec.posts + 1, holeR, holeR, HOLE_SEGMENTS)));
      const c = spec.posts > 0 && !m.hang ? spec.cover : undefined;
      if (c) {
        // For a cover: the mouth, the groove under it (it widens away from the bed, so it prints), then the countersink, 45°, in the post.
        cuts.push(s.t(cylinderAt(w, m.x, m.y, -1, c.mouth + 0.01, c.r, c.r, 48)));
        cuts.push(s.t(cylinderAt(w, m.x, m.y, c.mouth, c.sink + 0.01, c.groove, c.groove, 48)));
        cuts.push(s.t(cylinderAt(w, m.x, m.y, c.sink, c.sink + c.groove - holeR, c.groove, holeR, 48)));
        continue;
      }
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
    // Frame strips' pin holes in the front (on the bed), magnet pockets from the back.
    for (const [x, y] of spec.pins?.at ?? []) cuts.push(s.t(cylinderAt(w, x, y, -1, spec.pins!.depth, spec.pins!.d / 2, spec.pins!.d / 2, 24)));
    const mr = (SKADIS.magnet.d + SKADIS.magnet.fit) / 2;
    for (const [x, y] of spec.magnets ?? []) cuts.push(s.t(cylinderAt(w, x, y, SKADIS.magnet.skin, t + 1, mr, mr, 32)));
    if (spec.led) {
      // The LED channel along the outer edges, deeper where two meet (room for the wire joints).
      const { w: cw, d, sides } = spec.led;
      const xs = spec.outline.map((p) => p[0]);
      const ys = spec.outline.map((p) => p[1]);
      const [X, Y] = [Math.max(...xs), Math.max(...ys)];
      const box = (x0: number, y0: number, x1: number, y1: number, depth: number) =>
        s.t(w.Manifold.cube([x1 - x0, y1 - y0, depth + 1]).translate([x0, y0, t - depth]));
      const [l, r, b, tp] = sides;
      if (l) cuts.push(box(-1, -1, cw, Y + 1, d));
      if (r) cuts.push(box(X - cw, -1, X + 1, Y + 1, d));
      if (b) cuts.push(box(-1, -1, X + 1, cw, d));
      if (tp) cuts.push(box(-1, Y - cw, X + 1, Y + 1, d));
      const deep = Math.min(d + 1.5, t - 1);
      for (const [on, x0, y0] of [
        [l && b, -1, -1],
        [r && b, X - cw, -1],
        [r && tp, X - cw, Y - cw],
        [l && tp, -1, Y - cw],
      ] as [boolean, number, number][])
        if (on) cuts.push(box(x0, y0, x0 + cw + 1, y0 + cw + 1, deep));
    }
    // Text engraved in the front (reading from the front: the tile is mirrored as it's turned face down).
    if (spec.text && hasFont()) {
      for (const tx of spec.text) {
        const out = textOutline(tx.text, { size: Math.min(SKADIS.text.size, tx.h * 0.7), maxWidth: tx.w, maxHeight: tx.h });
        const solid = textSolid(w, out, tx.x, tx.y, -1, SKADIS.text.depth + 1);
        if (solid) cuts.push(s.t(solid));
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
