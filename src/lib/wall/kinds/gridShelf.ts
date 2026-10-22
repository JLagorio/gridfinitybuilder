/**
 * Gridfinity shelf: a shelf whose top is Gridfinity baseplate receptacles,
 * cells wide by cells deep, for bins from this app or anywhere.
 *
 * Printed upright, as it hangs, so it needs no supports: the shelf lies on the
 * bed with its receptacles opening up, like a baseplate, and the back plate
 * stands up from its back edge. What keeps it from sagging is above it, where
 * an upright print can build it: a cheek at each end (a triangle from the top
 * of the back plate down to the front lip), a front lip between them and a
 * 45° fillet along the root, so back plate, cheeks, lip and floor make one
 * stiff open box. Bracing under the shelf would need supports, and cheeks
 * between the cells would stop bins wider than one cell.
 *
 * Against tipping forward (the usual complaint about such shelves) it holds
 * on with clips all across the top row and studs below, in every slot
 * between them as well, down to the shelf: the taller the back plate, the
 * smaller the pull on the clips.
 *
 * Tilted, the receptacles lean out by 15° or 30° so you can see into the
 * bins; the shelf then sits on a solid wedge down to the bed (the slicer fills
 * it) and the front lip tilts with it, at most 30° off upright.
 */
import { backMounts, minHeight } from '../mount';
import { bool, int, num, obj, pick, registerAttachment, type AttachmentLayout, type MountCtx } from '../registry';
import { GRID } from '../../geometry/spec';
import { GRID_TOP, addStuds, gridMagnets } from './grid';

export interface GridShelfOptions {
  cellsX: number;
  cellsY: number;
  /** How far the receptacles lean out, degrees: 0, 15 or 30. */
  tilt: number;
  /** Front lip height above the receptacles, mm (0: flush). */
  lip: number;
  /** Back plate height, mm. */
  back: number;
  magnets: boolean;
}

export const GRID_SHELF_DEFAULTS: GridShelfOptions = { cellsX: 3, cellsY: 2, tilt: 0, lip: 6, back: 80, magnets: false };

/** Thicknesses, mm: back plate, cheeks, front lip; `root`: the fillet along the back plate (the receptacles start behind it). */
export const SHELF = { plate: 4, cheek: 3, front: 3, root: 3 };

/**
 * The shelf's side view: `run` its length along the slope (root, cells,
 * front lip), `y0` the height its back-bottom edge is lifted to by the tilt
 * (its front edge stays on the bed), `top` the height of its top at the back,
 * `depth` how far its lip reaches out.
 */
export function shelfSide(o: GridShelfOptions) {
  const a = (o.tilt * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const run = SHELF.root + o.cellsY * GRID + SHELF.front;
  const y0 = run * s;
  return { s, c, run, y0, top: y0 + GRID_TOP * c, depth: SHELF.plate + run * c + (GRID_TOP + o.lip) * s };
}

function shelfLayout(o: GridShelfOptions, ctx: MountCtx): AttachmentLayout {
  const w = o.cellsX * GRID + 2 * SHELF.cheek;
  const side = shelfSide(o);
  const h = Math.max(o.back, minHeight(ctx), Math.ceil(side.top + 10));
  const m = backMounts(w, h, ctx, { rows: 1 });
  addStuds(m, w, ctx, 20);
  return { w, h, depth: side.depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
}

registerAttachment<GridShelfOptions>({
  type: 'gridShelf',
  defaults: GRID_SHELF_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = GRID_SHELF_DEFAULTS;
    return {
      cellsX: int(r.cellsX, 1, 10, d.cellsX),
      cellsY: int(r.cellsY, 1, 4, d.cellsY),
      tilt: Number(pick(String(r.tilt), ['0', '15', '30'], '0')),
      lip: num(r.lip, 0, 40, d.lip),
      back: num(r.back, 20, 250, d.back),
      magnets: bool(r.magnets, d.magnets),
    };
  },
  layout: shelfLayout,
  summary: (o) => `Gridfinity shelf ${o.cellsX} × ${o.cellsY}${o.tilt ? `, ${o.tilt}°` : ''}`,
  notes(o, ctx) {
    const out: string[] = [];
    if (o.tilt && o.lip < 5) out.push('Tilted with a low front lip: bins can tip off.');
    const l = shelfLayout(o, ctx);
    if (l.h < l.depth / 2) out.push('Its back plate is short for its depth: a taller one tilts less.');
    return out;
  },
  hardware: (o) => gridMagnets(o.magnets, o.cellsX * o.cellsY, 'Gridfinity shelf'),
  labelFace: (o, l) => (o.tilt ? null : { x: SHELF.cheek + 1, y: 0.6, w: l.w - 2 * SHELF.cheek - 2, h: GRID_TOP + o.lip - 1.2, z: l.depth, normal: 'front' }),
  backPlate(o, l) {
    const sd = shelfSide(o);
    return { x0: SHELF.cheek + 0.5, x1: l.w - SHELF.cheek - 0.5, y0: Math.max(sd.top + SHELF.root, GRID_TOP + o.lip) + 0.5, y1: l.h, z: SHELF.plate };
  },
});
