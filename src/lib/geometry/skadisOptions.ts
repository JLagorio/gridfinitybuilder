/**
 * A Skådis board's options (drawer.skadis): what they are, their defaults and
 * cleaning them up. Only this much of the boards is on the first screen (the
 * store makes new boards and cleans saved ones); planning a board and its
 * solids (skadis.ts, which says what the options mean) load with the first
 * board (lib/skadisBoards.ts).
 */
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
  /** The text inlaid instead: engraved and filled flush, in the board text's colour (geometry/inlay.ts). */
  style?: 'inlaid';
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

const r1 = (v: number) => Math.round(v * 10) / 10;
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
        ...(z.style === 'inlaid' ? { style: 'inlaid' as const } : {}),
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
