/**
 * Shelf: a flat shelf at the foot of a back plate, with a lip along the front,
 * side walls if you like, and drain slots through it. Printed upright as it
 * hangs: the shelf lies on the bed and the back rises from its back edge, so
 * the 45° gussets in the corner between them (or the side walls) build on the
 * shelf without support. Clips across the top of the back, studs low on it
 * against tilting.
 */
import { backMounts, minHeight } from '../mount';
import { bool, num, obj, pick, registerAttachment, type MountCtx } from '../registry';

export interface ShelfOptions {
  width: number;
  /** Out from the board, mm. */
  depth: number;
  /** Back plate height, mm. */
  height: number;
  /** Lip along the front, above the shelf, mm (0 = none). */
  lip: number;
  /** Side walls, sloping from the back's height down to the front. */
  sides: boolean;
  holes: 'none' | 'slots';
  /** Shelf thickness, mm. */
  floor: number;
}

export const SHELF_DEFAULTS: ShelfOptions = { width: 160, depth: 100, height: 60, lip: 8, sides: false, holes: 'none', floor: 3 };

/** Back plate thickness, mm. */
export const SHELF_BACK = 3;

/** Gusset and side wall thickness, lip thickness, the fillet along the shelf's back edge, drain slot width and pitch; mm. */
export const SHELF = { gusset: 3, side: 2.4, lip: 2, fillet: 4, slot: 3, slotPitch: 8, gussetEvery: 150 } as const;

/** Where the gussets between the ends stand on a shelf `w` wide (their middles), one every 150 mm or so. */
export function shelfRibs(w: number): number[] {
  const n = Math.max(0, Math.ceil(w / SHELF.gussetEvery) - 1);
  return Array.from({ length: n }, (_, k) => (w * (k + 1)) / (n + 1));
}

/** A part that reaches out more than three times as far as its back is tall pries its clips out under load. */
export const leverNotes = (depth: number, h: number) =>
  depth > 3 * h ? [`It reaches out over three times as far as its back is tall: a heavy load may pull the clips out. Make the back taller.`] : [];

export const shelfHeight = (o: ShelfOptions, ctx: MountCtx) => Math.max(o.height, minHeight(ctx), o.floor + o.lip);

registerAttachment<ShelfOptions>({
  type: 'shelf',
  defaults: SHELF_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = SHELF_DEFAULTS;
    return {
      width: num(r.width, 30, 400, d.width),
      depth: num(r.depth, 20, 250, d.depth),
      height: num(r.height, 25, 200, d.height),
      lip: num(r.lip, 0, 40, d.lip),
      sides: bool(r.sides, d.sides),
      holes: pick(r.holes, ['none', 'slots'] as const, d.holes),
      floor: num(r.floor, 2, 8, d.floor),
    };
  },
  layout(o, ctx) {
    const h = shelfHeight(o, ctx);
    const m = backMounts(o.width, h, ctx, { rows: 3 });
    return { w: o.width, h, depth: o.depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Shelf ${Math.round(o.width)} × ${Math.round(o.depth)}`,
  notes: (o, ctx) => leverNotes(o.depth, shelfHeight(o, ctx)),
  labelFace(o, l) {
    // The lip's front.
    const h = o.floor + o.lip;
    const x = (o.sides ? SHELF.side : 0) + 1;
    return h >= 5 ? { x, y: 0.6, w: l.w - 2 * x, h: h - 1.2, z: o.depth, normal: 'front' } : null;
  },
  backPlate(o, l) {
    // Above the fillet along the shelf and the lip (a screwdriver reaches in over it), between the ends and the gussets.
    const end = (o.sides ? SHELF.side : SHELF.gusset) + 0.5;
    const g = SHELF.gusset / 2 + 0.5;
    const xs = [end, ...shelfRibs(l.w).flatMap((x) => [x - g, x + g]), l.w - end];
    return Array.from({ length: xs.length / 2 }, (_, k) => ({
      x0: xs[2 * k],
      x1: xs[2 * k + 1],
      y0: o.floor + Math.max(SHELF.fillet, o.lip) + 0.5,
      y1: l.h,
      z: SHELF_BACK,
    }));
  },
});
