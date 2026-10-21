/**
 * What a bin's place in the drawer does to its geometry, beyond the size of
 * the cells under it:
 *
 * - Half-grid drawers (Gridfinity Extended's half pitch): every cell is 21 mm,
 *   so every foot is 21 mm. Magnet / screw holes go where Gridfinity Extended
 *   puts them, at the corners of each 42 mm unit of the bin: one per 21 mm
 *   foot, 8 mm in from the unit's edges. A 1 × 1 u half-grid bin has the same
 *   four holes as a classic 1 × 1, so it also fits magnet baseplates.
 * - Stretch: the body above the feet reaches out over the solid margin next
 *   to the drawer wall. The feet stay on the grid; the overhang starts at
 *   STRETCH_Z, above the top of the baseplate.
 *
 * Both arrive with the bin's cells (BinCells.half / .stretch), worked out from
 * the placement in project.ts (binCellsAt), so everything that already passes
 * a placed bin's cells gets them.
 */
import { BASE_PROFILE_HEIGHT, GRID, HOLE_OFFSET } from './spec';
import { cellRects } from './variants';
import type { HoleSite } from './holes';

/** Cell pitch of a half-grid drawer. */
export const HALF_PITCH = GRID / 2;
/** Widest / deepest bin in cells: 12 u, which is 24 cells on a half grid. */
export const MAX_CELLS = 24;

/** How far the body reaches past the feet on each side, mm (X: left/right, Y: front/back). */
export interface BinStretch {
  left: number;
  right: number;
  front: number;
  back: number;
}

export const STRETCH_SIDES = ['left', 'right', 'front', 'back'] as const;
export type StretchSide = (typeof STRETCH_SIDES)[number];

/** Longest stretch kept, mm (a margin is always narrower than one 42 mm cell). */
export const MAX_STRETCH = 60;
/**
 * Bottom of the overhang, from the bin's bottom: where the outer wall starts.
 * A seated bin's bottom is 5 − topTrim (≤ 5) mm below the top of the
 * baseplate, so the overhang clears a solid margin by at least 0.5 mm.
 */
export const STRETCH_Z = BASE_PROFILE_HEIGHT + 0.75;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** A clean stretch (each side 0 … MAX_STRETCH, 0.01 mm), or undefined when it is all zero. */
export function cleanStretch(v: unknown): BinStretch | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const side = (k: StretchSide) => {
    const n = Number(r[k]);
    return Number.isFinite(n) && n > 0 ? round2(Math.min(MAX_STRETCH, n)) : 0;
  };
  const out = { left: side('left'), right: side('right'), front: side('front'), back: side('back') };
  return STRETCH_SIDES.some((k) => out[k] > 0) ? out : undefined;
}

/** Every side, zeros filled in. */
export function stretchOf(v: Partial<BinStretch> | null | undefined): BinStretch {
  return { left: v?.left ?? 0, right: v?.right ?? 0, front: v?.front ?? 0, back: v?.back ?? 0 };
}

export function hasStretch(v: Partial<BinStretch> | null | undefined): boolean {
  return !!v && STRETCH_SIDES.some((k) => (v[k] ?? 0) > 0);
}

/** Where the feet's center sits relative to the (stretched) body's center. */
export function stretchOffset(v: Partial<BinStretch> | null | undefined): { fx: number; fy: number } {
  const s = stretchOf(v);
  return { fx: (s.left - s.right) / 2, fy: (s.front - s.back) / 2 };
}

/** Mesh-key part for a stretch ("" when there is none). */
export function stretchKey(v: Partial<BinStretch> | null | undefined): string {
  if (!hasStretch(v)) return '';
  const s = stretchOf(v);
  return `S${s.left}/${s.right}/${s.front}/${s.back}`;
}

/** Rotation that turns +X toward (dx, dy) (see HoleSite.a). */
const ANGLE: Record<string, number> = { '1,1': 0, '-1,1': 90, '-1,-1': 180, '1,-1': 270 };

/**
 * Hole positions on a half-grid bin, centered on the feet: one per 21 mm
 * foot, at the corner of the 42 mm unit it belongs to (units pair up the feet
 * from the bin's front-left corner, as in Gridfinity Extended). With
 * `cornersOnly`, only the feet at the bin's four corners. Partial cells get none.
 */
export function halfHoleSites(cells: { x: number[]; y: number[] }, cornersOnly: boolean): HoleSite[] {
  const nx = cells.x.length;
  const ny = cells.y.length;
  const off = HOLE_OFFSET - HALF_PITCH / 2; // 2.5 mm from the foot's center
  const out: HoleSite[] = [];
  for (const c of cellRects(cells)) {
    if (Math.min(c.cw, c.cd) < HALF_PITCH - 1e-6) continue;
    if (cornersOnly && !((c.i === 0 || c.i === nx - 1) && (c.j === 0 || c.j === ny - 1))) continue;
    const dx = c.i % 2 === 0 ? -1 : 1;
    const dy = c.j % 2 === 0 ? -1 : 1;
    out.push({ x: c.cx + dx * off, y: c.cy + dy * off, a: ANGLE[`${dx},${dy}`] });
  }
  return out;
}
