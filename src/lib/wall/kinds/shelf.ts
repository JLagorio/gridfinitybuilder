/**
 * Shelf: a flat shelf at the foot of a back plate, with a lip along the front,
 * side walls if you like, and drain slots through it. Seen from above its
 * front is square, rounded at the corners, half a hexagon or half round (the
 * lip follows it round). Printed upright as it hangs: the shelf lies on the
 * bed and the back rises from its back edge, so the 45° gussets in the corner
 * between them (or the side walls) build on the shelf without support. Clips
 * across the top of the back, studs low on it against tilting.
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
  /** Its outline seen from above. */
  shape: (typeof SHELF_SHAPES)[number];
}

export const SHELF_SHAPES = ['rect', 'rounded', 'hexagon', 'halfRound'] as const;

export const SHELF_DEFAULTS: ShelfOptions = { width: 160, depth: 100, height: 60, lip: 8, sides: false, holes: 'none', floor: 3, shape: 'rect' };

/** Back plate thickness, mm. */
export const SHELF_BACK = 3;

/** A part that reaches out more than three times as far as its back is tall pries its clips out under load. */
export const leverNotes = (depth: number, h: number) =>
  depth > 3 * h ? [`It reaches out over three times as far as its back is tall: a heavy load may pull the clips out. Make the back taller.`] : [];

export const shelfHeight = (o: ShelfOptions, ctx: MountCtx) => Math.max(o.height, minHeight(ctx), o.floor + o.lip);

const SHAPE_NAMES = { rect: 'Shelf', rounded: 'Rounded shelf', hexagon: 'Hexagon shelf', halfRound: 'Half-round shelf' };

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
      shape: pick(r.shape, SHELF_SHAPES, d.shape),
    };
  },
  layout(o, ctx) {
    const h = shelfHeight(o, ctx);
    const m = backMounts(o.width, h, ctx, { rows: 3 });
    return { w: o.width, h, depth: o.depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `${SHAPE_NAMES[o.shape]} ${Math.round(o.width)} × ${Math.round(o.depth)}`,
  notes: (o, ctx) => leverNotes(o.depth, shelfHeight(o, ctx)),
});
