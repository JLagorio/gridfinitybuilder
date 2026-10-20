/**
 * Bin variants: base style, lip style, height mode, hole details, wall
 * cutouts, finger slides, the pocket-grid interior and lids.
 *
 * Every default reproduces the classic bin exactly, so projects saved before
 * these options existed build the same meshes (and share the same mesh keys).
 *
 * This module must not import bin.ts at runtime (bin.ts imports it).
 */
import { BASE_HEIGHT, GRID, HEIGHT_UNIT, LIP_HEIGHT, LIP_TOP_FLAT } from './spec';

/**
 * - standard: solid Gridfinity feet, floor at 7 mm.
 * - lite: hollow feet (gridfinity-rebuilt "lite"): the inside reaches down into
 *   every foot, leaving 0.95 mm walls and a 1 mm bottom.
 * - efficient: Gridfinity Extended "efficient floor": a pocket per cell with
 *   ~1 mm walls, a 0.7 mm bottom and wide ridges between cells.
 * - flat: no feet; a flat-bottomed box (outside still 42n − 0.5).
 */
export type BaseStyle = 'standard' | 'lite' | 'efficient' | 'flat';
/** Lip shape when `lip` is on. 'reduced' is Gridfinity Extended's: no lower chamfer or support, so more room inside. */
export type LipStyle = 'normal' | 'reduced';
/**
 * How the height is given:
 * - units: 7 mm units, excluding the lip (classic).
 * - internal: usable depth in mm, from the floor to the top of the wall (excluding the lip).
 * - external: overall height in mm, including the lip.
 */
export type HeightMode = 'units' | 'internal' | 'external';
export type InteriorMode = 'compartments' | 'pockets';
export type PocketShape = 'round' | 'square' | 'hex';
/** Which outer walls: any of the letters f (front, −Y), b (back), l (left, −X), r (right). '' = none. */
export type WallMask = string;

export interface BinVariantOptions {
  base: BaseStyle;
  lipStyle: LipStyle;
  /** Notches in the lip at the cell lines, so smaller bins stacked on top can't slide around. */
  lipNotches: boolean;
  heightMode: HeightMode;
  /** Height in mm for the 'internal' and 'external' modes (ignored in 'units'). */
  heightMm: number;
  /** 45° chamfer on magnet / screw hole mouths. */
  holeChamfer: boolean;
  /** Crush ribs in magnet pockets for a press fit. */
  holeCrushRibs: boolean;
  /** Bridge the top of each hole with stacked layers so it prints without supports (rebuilt `printable_hole_top`). */
  holePrintable: boolean;
  /** Holes only in the four outer corners of the bin. */
  holeCorners: boolean;
  /** Rounded cutouts in these outer walls. */
  cutoutWalls: WallMask;
  /** Cutout width as a fraction of the wall's inside length. */
  cutoutWidth: number;
  /** Cutout depth in mm, from the top of the bin. */
  cutoutDepth: number;
  /** Finger slides (a rounded ramp where the floor meets the wall) along these outer walls. */
  slideWalls: WallMask;
  slideRadius: number;
  /** Hex holes through these outer walls (Gridfinity Extended wall pattern), to save plastic on tall bins. */
  patternWalls: WallMask;
  /** Hex hole size across flats, mm. */
  patternSize: number;
  /** Plastic left between holes, mm. */
  patternWeb: number;
  /** 'pockets' fills the bin and cuts a grid of item pockets instead of compartments. */
  interior: InteriorMode;
  /** Preset the pocket fields came from ('custom' when edited by hand). UI only; not part of the geometry. */
  pocketPreset: string;
  pocketShape: PocketShape;
  /** Diameter (round), width (square) or across-flats (hex), in mm. */
  pocketW: number;
  /** Depth along Y of a square pocket, in mm. */
  pocketD: number;
  /** How deep each pocket is, from the top of the fill down to the floor. */
  pocketDepth: number;
  /** Minimum wall between pockets (and between pockets and the bin walls). */
  pocketSpacing: number;
  /** 45° chamfer on pocket mouths. */
  pocketChamfer: number;
  /** Print a stacking lid with this bin. Only used when the bin has a lip. */
  lid: boolean;
}

export const DEFAULT_VARIANTS: BinVariantOptions = {
  base: 'standard',
  lipStyle: 'normal',
  lipNotches: false,
  heightMode: 'units',
  heightMm: 21,
  holeChamfer: false,
  holeCrushRibs: false,
  holePrintable: false,
  holeCorners: false,
  cutoutWalls: '',
  cutoutWidth: 0.5,
  cutoutDepth: 12,
  slideWalls: '',
  slideRadius: 8,
  patternWalls: '',
  patternSize: 8,
  patternWeb: 2,
  interior: 'compartments',
  pocketPreset: 'aa',
  pocketShape: 'round',
  pocketW: 15,
  pocketD: 15,
  pocketDepth: 20,
  pocketSpacing: 2,
  pocketChamfer: 1,
  lid: false,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Floor thickness of a flat (footless) bin. */
export const FLAT_FLOOR = 1.2;
/** Bottom thickness of a lite base (gridfinity-rebuilt-lite `bottom_layer`). */
export const LITE_FLOOR = 1;
/** Bottom thickness of an efficient floor (Gridfinity Extended `gf_cup_floor_thickness`). */
export const EFFICIENT_FLOOR = 0.7;
/** Wall height limits in mm for the mm height modes. */
export const MIN_BODY_HEIGHT = 10;
export const MAX_BODY_HEIGHT = 210;

const BASE_STYLES: readonly BaseStyle[] = ['standard', 'lite', 'efficient', 'flat'];
const LIP_STYLES: readonly LipStyle[] = ['normal', 'reduced'];
const HEIGHT_MODES: readonly HeightMode[] = ['units', 'internal', 'external'];
const INTERIORS: readonly InteriorMode[] = ['compartments', 'pockets'];
const POCKET_SHAPES: readonly PocketShape[] = ['round', 'square', 'hex'];
export const WALLS = ['f', 'b', 'l', 'r'] as const;
export type Wall = (typeof WALLS)[number];

// ---------------------------------------------------------------------------
// Height
// ---------------------------------------------------------------------------

type HeightInput = { heightUnits: number; lip: boolean } & Partial<Pick<BinVariantOptions, 'heightMode' | 'heightMm' | 'base'>>;

/** Top of the floor that contents sit on, measured from the bin's bottom. */
export function binFloorZ(o: Partial<Pick<BinVariantOptions, 'base'>>): number {
  return o.base === 'flat' ? FLAT_FLOOR : BASE_HEIGHT;
}

/** How far the stacking lip rises above the wall. */
export function lipRise(o: { lip: boolean }): number {
  return o.lip ? LIP_HEIGHT - LIP_TOP_FLAT : 0;
}

/**
 * Height of the walls from the bin's bottom to where the lip starts: the
 * classic "7 mm × units" height. Every other height derives from it.
 */
export function binBodyHeight(o: HeightInput): number {
  const mode = o.heightMode ?? 'units';
  if (mode === 'units') return HEIGHT_UNIT * o.heightUnits;
  const mm = Number(o.heightMm) || 0;
  const h = mode === 'internal' ? mm + binFloorZ(o) : mm - lipRise(o);
  return Math.min(MAX_BODY_HEIGHT, Math.max(MIN_BODY_HEIGHT, h));
}

/** The `heightMm` value that gives this bin its current wall height in another mode. */
export function heightMmFor(o: HeightInput, mode: Exclude<HeightMode, 'units'>): number {
  const h = binBodyHeight(o);
  return round2(mode === 'internal' ? h - binFloorZ(o) : h + lipRise(o));
}

/** Allowed `heightMm` range for a mode. */
export function heightMmRange(o: HeightInput, mode: Exclude<HeightMode, 'units'>) {
  const off = mode === 'internal' ? -binFloorZ(o) : lipRise(o);
  return { min: MIN_BODY_HEIGHT + off, max: MAX_BODY_HEIGHT + off };
}

// ---------------------------------------------------------------------------
// Sanitizing and keys
// ---------------------------------------------------------------------------

const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Normalize a wall mask to the letters f, b, l, r in that order. */
export function wallMask(v: unknown): WallMask {
  return typeof v === 'string' ? WALLS.filter((c) => v.includes(c)).join('') : '';
}

/** Clamp every variant field; unknown values fall back to the defaults. */
export function sanitizeVariants(o: Partial<BinVariantOptions> & { heightUnits: number; lip: boolean }): BinVariantOptions {
  const d = DEFAULT_VARIANTS;
  const base = pick(o.base, BASE_STYLES, d.base);
  const heightMode = pick(o.heightMode, HEIGHT_MODES, d.heightMode);
  let heightMm = round2(num(o.heightMm, 0, 1000, d.heightMm));
  if (heightMode !== 'units') {
    const r = heightMmRange({ ...o, base }, heightMode);
    heightMm = Math.min(r.max, Math.max(r.min, heightMm));
  }
  return {
    base,
    lipStyle: pick(o.lipStyle, LIP_STYLES, d.lipStyle),
    lipNotches: !!(o.lipNotches ?? d.lipNotches),
    heightMode,
    heightMm,
    holeChamfer: !!(o.holeChamfer ?? d.holeChamfer),
    holeCrushRibs: !!(o.holeCrushRibs ?? d.holeCrushRibs),
    holePrintable: !!(o.holePrintable ?? d.holePrintable),
    holeCorners: !!(o.holeCorners ?? d.holeCorners),
    cutoutWalls: wallMask(o.cutoutWalls ?? d.cutoutWalls),
    cutoutWidth: round2(num(o.cutoutWidth, 0.1, 1, d.cutoutWidth)),
    cutoutDepth: round2(num(o.cutoutDepth, 1, 200, d.cutoutDepth)),
    slideWalls: wallMask(o.slideWalls ?? d.slideWalls),
    slideRadius: round2(num(o.slideRadius, 1, 40, d.slideRadius)),
    patternWalls: wallMask(o.patternWalls ?? d.patternWalls),
    patternSize: round2(num(o.patternSize, 3, 30, d.patternSize)),
    patternWeb: round2(num(o.patternWeb, 1.2, 10, d.patternWeb)),
    interior: pick(o.interior, INTERIORS, d.interior),
    pocketPreset: typeof o.pocketPreset === 'string' && o.pocketPreset ? o.pocketPreset.slice(0, 40) : d.pocketPreset,
    pocketShape: pick(o.pocketShape, POCKET_SHAPES, d.pocketShape),
    pocketW: round2(num(o.pocketW, 1, 200, d.pocketW)),
    pocketD: round2(num(o.pocketD, 1, 200, d.pocketD)),
    pocketDepth: round2(num(o.pocketDepth, 1, 200, d.pocketDepth)),
    pocketSpacing: round2(num(o.pocketSpacing, 0.8, 20, d.pocketSpacing)),
    pocketChamfer: round2(num(o.pocketChamfer, 0, 5, d.pocketChamfer)),
    lid: !!(o.lid ?? d.lid),
  };
}

/** Height part of a bin's mesh key: units when the wall height is a whole number of units, else mm. */
export function heightKey(o: HeightInput): string {
  const h = binBodyHeight(o);
  const u = h / HEIGHT_UNIT;
  return Math.abs(u - Math.round(u)) < 1e-6 ? String(Math.round(u)) : `${round2(h)}mm`;
}

type KeyInput = BinVariantOptions & { lip: boolean; holes: string };

/**
 * Extra mesh-key parts for the variant fields. Only non-default, geometry-relevant
 * values appear, so classic bins keep their keys and identical bins share meshes.
 */
export function variantKeyParts(o: KeyInput): string[] {
  const p: string[] = [];
  if (o.base !== 'standard') p.push(`B${o.base}`);
  if (o.lip && o.lipStyle !== 'normal') p.push(`L${o.lipStyle}`);
  if (o.lip && o.lipNotches) p.push('Ln');
  if (o.holes !== 'none' && o.base !== 'flat') {
    const magnets = o.holes === 'magnets' || o.holes === 'both';
    const flags = [
      o.holeChamfer && o.holes !== 'refined' ? 'c' : '',
      o.holeCrushRibs && magnets ? 'r' : '',
      o.holePrintable && o.holes !== 'refined' ? 'p' : '',
      o.holeCorners ? '4' : '',
    ].join('');
    if (flags) p.push(`H${flags}`);
  }
  if (o.cutoutWalls) p.push(`W${o.cutoutWalls}${o.cutoutWidth}x${o.cutoutDepth}`);
  if (o.slideWalls && o.interior !== 'pockets') p.push(`S${o.slideWalls}${o.slideRadius}`);
  if (o.patternWalls) p.push(`X${o.patternWalls}${o.patternSize}w${o.patternWeb}`);
  if (o.interior === 'pockets') {
    const size = o.pocketShape === 'square' ? `${o.pocketW}x${o.pocketD}` : String(o.pocketW);
    p.push(`P${o.pocketShape}${size}d${o.pocketDepth}s${o.pocketSpacing}c${o.pocketChamfer}`);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export interface CellRect {
  /** Column and row index. */
  i: number;
  j: number;
  /** Cell center, relative to the bin's center. */
  cx: number;
  cy: number;
  /** Cell pitch (42 for a full cell). */
  cw: number;
  cd: number;
  full: boolean;
}

/** Every grid cell under a bin, centered on the bin. */
export function cellRects(cells: { x: number[]; y: number[] }): CellRect[] {
  const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
  const out: CellRect[] = [];
  const totalX = sum(cells.x);
  const totalY = sum(cells.y);
  for (let i = 0, x0 = -totalX / 2; i < cells.x.length; x0 += cells.x[i], i++) {
    for (let j = 0, y0 = -totalY / 2; j < cells.y.length; y0 += cells.y[j], j++) {
      const cw = cells.x[i];
      const cd = cells.y[j];
      out.push({ i, j, cx: x0 + cw / 2, cy: y0 + cd / 2, cw, cd, full: Math.min(cw, cd) >= GRID - 1e-6 });
    }
  }
  return out;
}

/** Positions of the lines between cells, relative to the bin's center. */
export function cellLines(sizes: number[]): number[] {
  const total = sizes.reduce((t, v) => t + v, 0);
  const out: number[] = [];
  let x = -total / 2;
  for (let i = 0; i < sizes.length - 1; i++) out.push((x += sizes[i]));
  return out;
}
