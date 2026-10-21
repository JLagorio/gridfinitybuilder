/**
 * Device holder: a pocket sized from the device it holds (a power strip, a
 * phone, a tablet, a USB hub, a router), 0.5 mm clear all round, its back the
 * back plate. The front is open but for the corners, a low lip, or full
 * height with a U cut-out for the screen, buttons or a cable; a cable hole in
 * the floor and notches in the sides if you like. Printed upright as it
 * hangs: the floor on the bed, every wall standing on it. Clips across the
 * top of the back, studs low on it.
 */
import { backMounts, minHeight } from '../mount';
import { bool, num, obj, pick, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface CradleOptions {
  /** The device: width (left to right), depth (out from the board) and how much of its height the pocket covers, mm. */
  width: number;
  depth: number;
  height: number;
  front: 'open' | 'lip' | 'u';
  /** A cable hole in the floor. */
  cable: boolean;
  /** Cable notches in the side walls. */
  notches: boolean;
  wall: number;
}

export const CRADLE_DEFAULTS: CradleOptions = { width: 80, depth: 16, height: 60, front: 'u', cable: true, notches: false, wall: 2 };

/** Back plate and floor thickness, clearance each side of the device, mm. */
export const CRADLE = { back: 3, floor: 2.4, fit: 0.5 } as const;

/** The pocket inside, mm: x0..x1 across, z0..z1 out from the board, from the floor's top up `h`. */
export function cradlePocket(o: CradleOptions) {
  const x0 = o.wall;
  const z0 = CRADLE.back;
  return { x0, x1: x0 + o.width + 2 * CRADLE.fit, z0, z1: z0 + o.depth + 2 * CRADLE.fit, y0: CRADLE.floor, h: o.height };
}

const cradleHeight = (o: CradleOptions, ctx: MountCtx) => Math.max(CRADLE.floor + o.height, minHeight(ctx));

registerAttachment<CradleOptions>({
  type: 'cradle',
  defaults: CRADLE_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = CRADLE_DEFAULTS;
    return {
      width: num(r.width, 10, 300, d.width),
      depth: num(r.depth, 4, 150, d.depth),
      height: num(r.height, 10, 200, d.height),
      front: pick(r.front, ['open', 'lip', 'u'] as const, d.front),
      cable: bool(r.cable, d.cable),
      notches: bool(r.notches, d.notches),
      wall: num(r.wall, 1.2, 5, d.wall),
    };
  },
  layout(o, ctx) {
    const p = cradlePocket(o);
    const h = cradleHeight(o, ctx);
    const w = p.x1 + o.wall;
    const m = backMounts(w, h, ctx, { rows: 3 });
    return { w, h, depth: p.z1 + o.wall, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Holder ${Math.round(o.width)} × ${Math.round(o.depth)} × ${Math.round(o.height)}`,
  notes: (o, ctx) => leverNotes(cradlePocket(o).z1 + o.wall, cradleHeight(o, ctx)),
});
