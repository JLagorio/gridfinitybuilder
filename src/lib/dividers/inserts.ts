/**
 * Removable dividers: instead of a fixed wall the bin gets a slot (the wall's
 * footprint widened by SLOT_CLEARANCE per side, sunk SLOT_DEPTH into the floor)
 * with a pair of guide ribs at each end, and the wall prints as a separate plate.
 *
 * A removable wall is split into segments at every perpendicular wall that
 * crosses it (a plate can't pass through a fixed wall): one plate per segment.
 * Where a segment ends at the outer wall of a bin with a stacking lip, the plate
 * is shortened by the lip's overhang so it can be dropped in from above.
 */
import { LIP_DEPTH, WALL } from '../geometry/spec';
import { other } from './resolve';
import { T, type Orient, type ResolvedLayout, type ResolvedWall } from './types';

/** Clearance between plate and slot, per side (mm). Slot width = DIVIDER + 2 × this. */
export const SLOT_CLEARANCE = 0.15;
/** Groove depth into the floor (mm). */
export const SLOT_DEPTH = 0.8;
/** Gap between a plate's end and the wall it stops at (mm). */
export const INSERT_END_CLEARANCE = 0.25;
/** Guide ribs either side of the slot at each end. */
export const RIB_THICKNESS = 0.8;
/** How far the ribs reach past the plate's end (mm). */
export const RIB_ENGAGE = 2;

export interface RemovableSegment {
  wallId: string;
  /** Segment number along the wall (0-based). */
  index: number;
  orient: Orient;
  /** Centerline across. */
  pos: number;
  /** Faces the slot runs between, along the run (cavity mm). */
  a: number;
  b: number;
  aEdge: boolean;
  bEdge: boolean;
  /** Space left between the plate's ends and the faces. */
  gapA: number;
  gapB: number;
  lower: number;
}

export function removableSegments(r: ResolvedLayout, lip: boolean): RemovableSegment[] {
  const out: RemovableSegment[] = [];
  const eps = 1e-6;
  for (const W of r.walls) {
    if (!W.removable) continue;
    const perp = other(W.orient);
    const attached = (ref: string) => {
      const p = r.byId.get(ref);
      return p && p.orient === perp ? p : null;
    };
    const crossing = r.walls
      .filter(
        (p) =>
          p.orient === perp &&
          p.start < W.pos - T / 2 - eps &&
          p.end > W.pos + T / 2 + eps &&
          p.pos > W.start + T / 2 + eps &&
          p.pos < W.end - T / 2 - eps,
      )
      .sort((a, b) => a.pos - b.pos);
    const s0 = attached(W.wall.start);
    const e0 = attached(W.wall.end);
    const stops: { pos: number; wall: ResolvedWall | null }[] = [
      { pos: s0 ? s0.pos : W.start, wall: s0 },
      ...crossing.map((p) => ({ pos: p.pos, wall: p })),
      { pos: e0 ? e0.pos : W.end, wall: e0 },
    ];
    const half = (p: ResolvedWall) => T / 2 + (p.removable ? SLOT_CLEARANCE : 0);
    const edgeGap = (lip ? LIP_DEPTH - WALL : 0) + INSERT_END_CLEARANCE;
    for (let k = 0; k + 1 < stops.length; k++) {
      const s = stops[k];
      const e = stops[k + 1];
      const a = s.wall ? s.pos + half(s.wall) : s.pos;
      const b = e.wall ? e.pos - half(e.wall) : e.pos;
      const gapA = s.wall ? INSERT_END_CLEARANCE : edgeGap;
      const gapB = e.wall ? INSERT_END_CLEARANCE : edgeGap;
      if (b - a - gapA - gapB < 3) continue;
      out.push({ wallId: W.id, index: k, orient: W.orient, pos: W.pos, a, b, aEdge: !s.wall, bEdge: !e.wall, gapA, gapB, lower: W.lower });
    }
  }
  return out;
}
