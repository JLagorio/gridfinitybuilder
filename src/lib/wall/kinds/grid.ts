/**
 * Gridfinity on the wall: what the shelf, the wall plate and the lip clip
 * share. Shelf and plate tops are baseplate receptacles (geometry/baseplate.ts)
 * over a floor deep enough for 6 × 2 mm magnets, the ridge between cells
 * trimmed like a baseplate's. Planning side: sizes only (grid.geom.ts cuts them).
 */
import { MOUNT, mountBox, type MountPlan } from '../mount';
import type { AttachmentHardware, MountCtx } from '../registry';
import { BP_BOTTOM_CLEARANCE, BP_PROFILE_HEIGHT } from '../../geometry/spec';

/** Floor under the receptacles, mm (a magnet pocket leaves 0.8 mm under it). */
export const GRID_FLOOR = 3;
/** From the bottom of the floor to the top of the receptacles, mm: 3 + 0.35 + 4.65 − 0.4. */
export const GRID_TOP = GRID_FLOOR + BP_BOTTOM_CLEARANCE + BP_PROFILE_HEIGHT - 0.4;

/**
 * Whole cells for a bin's footprint of `n` cells (follow.ts HeldBin: a fraction for a half-grid bin or one on part
 * cells): up for what it stands in, `down` for what fits inside it.
 */
export const cellsFor = (n: number, down = false) => (down ? Math.floor(n + 1e-6) : Math.ceil(n - 1e-6));

/** Four magnets a cell, when the pockets are on. */
export const gridMagnets = (on: boolean, cells: number, what: string, note?: string): AttachmentHardware[] =>
  on ? [{ item: `Magnets 6 × 2 mm (${what})`, count: 4 * cells, ...(note ? { note } : {}) }] : [];

/**
 * A stud in every free slot of the `rows` rows under the top row of `m` (in
 * the columns between as well), on a part `w` wide: against tilting.
 */
export function addStuds(m: MountPlan, w: number, ctx: MountCtx, rows: number): void {
  const b = mountBox('stud', [0, 0], ctx);
  const [x, y] = m.anchor;
  const p = ctx.pitch;
  for (let dj = -1; dj >= -rows && y + dj * p + b.y0 >= MOUNT.margin; dj--)
    for (let di = -Math.floor(x / p); x + di * p + b.x1 <= w - MOUNT.margin; di++)
      if ((di + dj) % 2 === 0 && x + di * p + b.x0 >= MOUNT.margin && !m.mounts.some((s) => s.di === di && s.dj === dj))
        m.mounts.push({ di, dj, kind: 'stud' });
}
