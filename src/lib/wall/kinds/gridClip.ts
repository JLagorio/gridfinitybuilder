/**
 * Bin lip clip: hangs one standard Gridfinity bin (from this app or anywhere)
 * on the board by its stacking lip. A bin's outside is flush from its feet up,
 * so the only thing to hold it by is inside the lip: the 45° taper under the
 * lip's inner edge. Over the top of the bin's back wall goes an arm, down
 * inside it a tongue:
 * - 'lip': the tongue ends in a catch per cell that springs under the taper
 *   (push the bin up until it clicks); the bin hangs on it, its back on the
 *   clip's plate down to its base so it hangs straight.
 * - 'cradle': a ledge with the baseplate's receptacle profile carries the
 *   bin's base, and the tongue (no catch) keeps its top from tipping out: lift
 *   the top in behind the tongue, swing the base in and let it down.
 *
 * Printed on its side, so the arm, tongue and catches lie flat on the bed and
 * flex along their layers: a pegboard hook at the left of the top row holds
 * it on, studs in the other slots keep it straight.
 */
import { backMounts } from '../mount';
import { addStuds } from './grid';
import { int, obj, pick, registerAttachment } from '../registry';
import { GRID, HEIGHT_UNIT, LIP_HEIGHT, LIP_TOP_FLAT } from '../../geometry/spec';

export interface GridClipOptions {
  /** The bin's width in cells, and its height in units (without the lip). */
  cells: number;
  units: number;
  style: 'lip' | 'cradle';
}

export const GRID_CLIP_DEFAULTS: GridClipOptions = { cells: 1, units: 6, style: 'lip' };

/** Thicknesses: plate, arm over the bin's wall, tongue; `room` above the lip to push the bin up into the clip, mm. */
export const CLIP = { plate: 3, arm: 3, tongue: 1.6, room: 8 };

/**
 * The clip's side view: `yb` where the bin's bottom sits, `wall` the top of
 * its walls (where the lip starts), `gap` between plate and tongue (the lip is
 * 2.6 mm thick; the cradle's tilts in), `h` and `depth` the clip's.
 */
export function clipSide(o: GridClipOptions) {
  const yb = o.style === 'cradle' ? 1 : 0;
  const wall = yb + o.units * HEIGHT_UNIT;
  const gap = o.style === 'cradle' ? 4 : 3.1;
  const h = wall + LIP_HEIGHT - LIP_TOP_FLAT + CLIP.room + CLIP.arm;
  return { yb, wall, gap, h, depth: CLIP.plate + gap + CLIP.tongue };
}

registerAttachment<GridClipOptions>({
  type: 'gridClip',
  defaults: GRID_CLIP_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = GRID_CLIP_DEFAULTS;
    return { cells: int(r.cells, 1, 6, d.cells), units: int(r.units, 2, 20, d.units), style: pick(r.style, ['lip', 'cradle'] as const, d.style) };
  },
  layout(o, ctx) {
    // Inside the bin's corners: 3.75 mm in from each side of a bin 0.5 mm narrower than its cells.
    const w = o.cells * GRID - 8;
    const { h, depth } = clipSide(o);
    // Only the hook at the left prints on the bed; studs further along, one and two rows down.
    const m = backMounts(w, h, ctx, { kind: 'hook', rows: 3, columns: 1, left: true });
    addStuds(m, w, ctx, 2);
    return { w, h, depth, anchor: m.anchor, mounts: m.mounts, pose: 'side' };
  },
  summary: (o) => `Bin ${o.style === 'lip' ? 'lip clip' : 'cradle'}, ${o.cells} wide ${o.units}u`,
  notes: (o) => (o.style === 'lip' && o.units > 12 ? ['A bin this tall is heavy for its lip when full: the cradle carries it from below.'] : []),
});
