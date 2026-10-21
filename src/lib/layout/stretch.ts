/**
 * Stretching a bin into the gap: with a solid edge fill, the margin between
 * the grid and the drawer wall holds no cells. A bin that touches the edge of
 * the grid can reach out over it: its feet stay on the grid, and the body
 * above the baseplate grows toward the wall (geometry in geometry/placement.ts).
 *
 * A bin only stretches on sides where it touches the edge of the grid, and
 * at most to the edge of the baseplate, which is already the drawer's fit
 * clearance away from the wall. So stretched bins never run into each other
 * (no other bin is beside a bin on its outside) or past the drawer.
 */
import { BASE_TOP, GRID } from '../geometry/spec';
import { STRETCH_SIDES, cleanStretch, type BinStretch, type StretchSide } from '../geometry/placement';
import type { GridLayout } from './drawer';

/** What a placed bin needs here (PlacedBin has all of it). */
export interface StretchBin {
  x: number;
  y: number;
  opts: { unitsX: number; unitsY: number; container?: string };
  stretch?: Partial<BinStretch>;
}

/** The body's nominal edge is this far inside the cell boundary. */
const INSET = (GRID - BASE_TOP) / 2;
/** Thinner margins aren't worth stretching into, mm. */
export const MIN_STRETCH_MARGIN = 0.5;

const floor2 = (v: number) => Math.floor(v * 100 + 1e-6) / 100;

/** How far the bin's body can reach on each side: to the plate edge where it touches the grid edge, else 0. */
export function stretchRoom(layout: GridLayout, b: StretchBin): BinStretch {
  // A vase-mode bin's single wall can't print an overhang (geometry/containers/vase.ts).
  if (b.opts.container === 'vase') return { left: 0, right: 0, front: 0, back: 0 };
  const { nx, ny, margins: m } = layout;
  const side = (touches: boolean, margin: number) => (touches && margin >= MIN_STRETCH_MARGIN ? floor2(margin + INSET) : 0);
  return {
    left: side(b.x === 0, m.left),
    right: side(b.x + b.opts.unitsX === nx, m.right),
    front: side(b.y === 0, m.front),
    back: side(b.y + b.opts.unitsY === ny, m.back),
  };
}

/** True when the bin could stretch at all where it is. */
export function canStretch(layout: GridLayout, b: StretchBin): boolean {
  const r = stretchRoom(layout, b);
  return STRETCH_SIDES.some((k) => r[k] > 0);
}

/**
 * The stretch the bin gets where it is: what it asks for, cut to the room it
 * has (a bin moved away from the edge keeps its setting but doesn't stretch).
 * Undefined when there is none.
 */
export function effectiveStretch(layout: GridLayout, b: StretchBin): BinStretch | undefined {
  if (!b.stretch) return undefined;
  const room = stretchRoom(layout, b);
  const out = {} as BinStretch;
  for (const k of STRETCH_SIDES) out[k] = Math.min(Math.max(0, b.stretch[k] ?? 0), room[k]);
  return cleanStretch(out);
}

/** "Auto": reach the plate edge on every side that touches the grid edge. */
export function autoStretch(layout: GridLayout, b: StretchBin): BinStretch | undefined {
  return cleanStretch(stretchRoom(layout, b));
}

export const STRETCH_LABEL: Record<StretchSide, string> = { left: 'Left', right: 'Right', front: 'Front', back: 'Back' };
