/**
 * Free-form divider layouts for a bin's interior.
 *
 * Coordinates are "cavity mm": the inner cavity of the bin (bin size − 2·WALL),
 * origin at its front-left corner, x to the right, y to the back. A wall's
 * position is the coordinate of its CENTERLINE across its axis.
 *
 * Positions are measured between centerlines, with each cavity edge acting as a
 * virtual divider centered DIVIDER/2 outside the cavity (at −T/2 and inner + T/2).
 * With that convention ratios compose: a wall at 1/3 of edge–edge plus one at 1/2
 * of wall–edge gives exactly the uniform 3-way split (`(inner − 2T) / 3` clear each),
 * the same compartments the old `divX × divY` code produced.
 */
import type { LabelStyle } from '../geometry/bin';
import type { BinVariantOptions } from '../geometry/variants';
import { DIVIDER } from '../geometry/spec';

/** 'v' walls run front→back and sit at an x position; 'h' walls run left→right at a y position. */
export type Orient = 'v' | 'h';

/** Reference to the cavity edge (instead of a wall id). */
export const EDGE = 'edge';
/** A wall id or EDGE. */
export type Ref = string;

export type WallPos =
  /** Fraction (0..1) of the centerline span between the `lo` and `hi` references. */
  | { kind: 'ratio'; t: number }
  /** Clear gap in mm between this wall's face and the face of the `from` side's reference. */
  | { kind: 'exact'; mm: number; from: 'lo' | 'hi' };

export interface DividerWall {
  id: string;
  orient: Orient;
  /** Parallel neighbor (or edge) on the low side (left / front) the position is measured from. */
  lo: Ref;
  /** Parallel neighbor (or edge) on the high side (right / back). */
  hi: Ref;
  pos: WallPos;
  /** Perpendicular wall (or edge) the low end (front / left) attaches to. */
  start: Ref;
  /** Perpendicular wall (or edge) the high end (back / right) attaches to. */
  end: Ref;
  /** Top of the wall this many mm below the top of the bin's infill (0 / undefined = full height). */
  lower?: number;
  /** Printed as a separate slide-in plate; the bin gets slots instead of a fixed wall. */
  removable?: boolean;
}

/**
 * What fills a compartment:
 * - open: an empty compartment (scoop, label tab, floor shape).
 * - pockets: filled solid to the pocket depth, with its own pocket grid.
 * - tools: filled solid, with the bin's tool cutouts cut only inside it.
 * - solid: filled flat to the top (a blank / spacer).
 */
export type CompartmentInside = 'open' | 'pockets' | 'tools' | 'solid';
/** Floor of an open compartment: flat, a ramp, or steps like stadium seating. */
export type FloorShape = 'flat' | 'ramp' | 'tiers';
/** The side a ramp or the steps rise toward. */
export type FloorHigh = 'back' | 'front' | 'left' | 'right';
/** Every pocket-grid field of the bin options (`pocketShape`, `pocketW`, …). */
export type PocketField = Extract<keyof BinVariantOptions, `pocket${string}`>;
/** A compartment's pocket settings, over the bin's own pocket fields. */
export type CompartmentPockets = Partial<Pick<BinVariantOptions, PocketField>>;

/** Per-compartment overrides. Undefined fields use the bin-level setting. */
export interface CompartmentOptions {
  /** 0..1, like BinOptions.scoop. */
  scoop?: number;
  label?: LabelStyle;
  /** Raise this compartment's floor by this many mm (shallower compartment). */
  floor?: number;
  /** Text on this compartment's label tab (else the bin's `labelText`). */
  labelText?: string;
  /** Undefined = 'open'. Filled insides get no scoop, label tab or floor shape. */
  inside?: CompartmentInside;
  /** 'pockets': settings over the bin's pocket fields. */
  pockets?: CompartmentPockets;
  /** Undefined = 'flat'. */
  floorShape?: FloorShape;
  /** How far the high side of a ramp / the top step rises above the floor (mm). */
  floorRise?: number;
  /** Undefined = 'back' (parts slide toward the front scoop). */
  floorHigh?: FloorHigh;
  /** Number of steps (2–6), for 'tiers'. */
  tiers?: number;
}

export interface DividerLayout {
  walls: DividerWall[];
  /**
   * Per-compartment options keyed by compartment key (see `compartmentKey` in
   * resolve.ts: the sorted list of walls/edges bounding it, with the side of each
   * wall it lies on). Keys survive moving walls and resizing the bin.
   */
  comps?: Record<string, CompartmentOptions>;
}

/** Divider thickness (mm). */
export const T = DIVIDER;
/** Smallest clear compartment size the resolver and the editor allow (mm). */
export const MIN_GAP = 2;
/** Shortest wall kept by the resolver (mm). */
export const MIN_WALL = 2;
export const MAX_WALLS = 64;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ResolvedWall {
  id: string;
  orient: Orient;
  /** Centerline across the wall's axis. */
  pos: number;
  /** Extent along the wall's run (centerline of an attached wall, or the cavity edge). */
  start: number;
  end: number;
  /** Centerlines of the position references (edges at −T/2 / inner + T/2). */
  loPos: number;
  hiPos: number;
  lower: number;
  removable: boolean;
  wall: DividerWall;
}

/** One rectangle of a compartment (clear space, between wall faces). */
export interface CompRect extends Rect {
  /** Sides that are the compartment's boundary along their whole length (not shared with another rect of it). */
  open: { front: boolean; back: boolean; left: boolean; right: boolean };
  /** Convex corners of the compartment outline, CCW from bottom-left: [BL, BR, TR, TL]. */
  convex: [boolean, boolean, boolean, boolean];
  /** Largest `lower` among the walls bounding the back side (0 = full height / edge). */
  backLower: number;
}

export interface Compartment {
  /** Stable identity: sorted boundary tags (see resolve.ts). */
  key: string;
  /** Disjoint rectangles covering the compartment: maximal horizontal strips, merged vertically. */
  rects: CompRect[];
  bounds: Rect;
  area: number;
  isRect: boolean;
  /** A point well inside the compartment (center of its largest rect). */
  point: [number, number];
}

export interface ResolvedLayout {
  innerW: number;
  innerD: number;
  /** Valid walls, in layout order. */
  walls: ResolvedWall[];
  byId: Map<string, ResolvedWall>;
  compartments: Compartment[];
  /** Ids of walls that could not be resolved (degenerate) and were left out. */
  dropped: string[];
}
