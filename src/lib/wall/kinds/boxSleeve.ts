/**
 * Box sleeve: a holder sized from a box or a roll you take things from, the
 * box dropped in from the open top, 1 mm clear all round:
 * - front: a U frame across the front shows the box's face (gloves, zip
 *   bags, sticky notes) and holds it by its sides and foot;
 * - top: a low front with a thumb notch (index cards, anything you lift out);
 * - bottom: the U frame, and a slot through the floor that tissues, gloves or
 *   a roll's sheet come out of; teeth along the slot's front edge tear foil
 *   or film pulled down and forward over them.
 *
 * Printed upright as it hangs: the floor on the bed, every wall standing on
 * it, nothing over a gap (the frame is open at the top). Clips across the
 * top of the back, studs low on it.
 */
import { backMounts, minHeight } from '../mount';
import { bool, num, obj, pick, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface BoxSleeveOptions {
  /** The box: left to right, out from the board, and how much of its height the sleeve covers, mm. */
  width: number;
  depth: number;
  height: number;
  /** How you take from it. */
  open: 'front' | 'top' | 'bottom';
  /** The front frame's width round the opening, mm. */
  rim: number;
  /** Open top: the front's height, % of the sides. */
  front: number;
  /** Bottom: the floor slot, front to back, mm. */
  slot: number;
  /** Bottom: teeth along the slot's front edge. */
  cutter: boolean;
  wall: number;
}

export const BOX_DEFAULTS: BoxSleeveOptions = { width: 190, depth: 60, height: 100, open: 'front', rim: 10, front: 40, slot: 30, cutter: false, wall: 2 };

/** Back plate, floor, clearance each side of the box, mm. */
export const BOX = { back: 3, floor: 2, fit: 1 } as const;

/** The inside (x0..x1 across, z0..z1 out from the board, from the floor up) and the outside, mm. */
export function boxPlan(o: BoxSleeveOptions) {
  const x0 = o.wall;
  const x1 = x0 + o.width + 2 * BOX.fit;
  const z0 = BOX.back;
  const z1 = z0 + o.depth + 2 * BOX.fit;
  return { x0, x1, z0, z1, W: x1 + o.wall, D: z1 + o.wall, H: BOX.floor + o.height };
}

const boxHeight = (o: BoxSleeveOptions, ctx: MountCtx) => Math.max(boxPlan(o).H, minHeight(ctx));

/**
 * The front of a sleeve `H` tall: how high it is solid all the way across (`bar`: under the frame's opening, or under
 * the thumb notch), an open top's front height (`front`) and its notch's radius (0: none), mm.
 */
export function boxFront(o: BoxSleeveOptions, H: number) {
  if (o.open !== 'top') return { bar: BOX.floor + o.rim, front: H, notch: 0 };
  const hf = Math.min(H, Math.max(BOX.floor + 5, BOX.floor + (o.height * o.front) / 100));
  const r = Math.min(20, 0.2 * o.width);
  const yb = Math.max(BOX.floor + 3, hf - r - 10);
  return yb < hf - 1 ? { bar: yb, front: hf, notch: r } : { bar: hf, front: hf, notch: 0 };
}

registerAttachment<BoxSleeveOptions>({
  type: 'boxSleeve',
  defaults: BOX_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = BOX_DEFAULTS;
    const width = num(r.width, 20, 320, d.width);
    return {
      width,
      depth: num(r.depth, 5, 200, d.depth),
      height: num(r.height, 10, 250, d.height),
      open: pick(r.open, ['front', 'top', 'bottom'] as const, d.open),
      rim: num(r.rim, 3, 40, d.rim),
      front: num(r.front, 10, 100, d.front),
      slot: num(r.slot, 5, 100, d.slot),
      cutter: bool(r.cutter, d.cutter),
      wall: num(r.wall, 1.2, 5, d.wall),
    };
  },
  layout(o, ctx) {
    const p = boxPlan(o);
    const h = boxHeight(o, ctx);
    const m = backMounts(p.W, h, ctx, { rows: 3 });
    return { w: p.W, h, depth: p.D, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Box sleeve ${Math.round(o.width)} × ${Math.round(o.depth)} × ${Math.round(o.height)}`,
  labelFace(o, l) {
    // The front under the opening (the frame's foot, or the low front under its thumb notch).
    const t = boxFront(o, l.h);
    const h = Math.min(12, t.bar - 1.2);
    return h >= 5 ? { x: o.wall + 1, y: t.bar - 0.6 - h, w: l.w - 2 * o.wall - 2, h, z: l.depth, normal: 'front', depth: Math.min(0.6, o.wall / 2) } : null;
  },
  backPlate(o, l) {
    // Through the opening in the front (the box slides out of the top): over the low front and in its thumb notch, or
    // inside the frame.
    const p = boxPlan(o);
    const t = boxFront(o, l.h);
    const plate = (x0: number, x1: number, y0: number) => ({ x0, x1, y0, y1: l.h, z: BOX.back });
    if (o.open !== 'top') return plate(p.x0 + o.rim, p.x1 - o.rim, BOX.floor + o.rim);
    return t.notch
      ? [plate(o.wall, l.w - o.wall, t.front), plate(l.w / 2 - t.notch, l.w / 2 + t.notch, t.bar + t.notch)]
      : plate(o.wall, l.w - o.wall, t.front);
  },
  notes(o, ctx) {
    const p = boxPlan(o);
    const out = leverNotes(p.D, boxHeight(o, ctx));
    if (o.open !== 'top' && 2 * o.rim > Math.min(o.width, o.height) - 10) out.push('The front frame covers most of the box: make the rim narrower.');
    if (o.open === 'bottom' && o.slot > o.depth - 4) out.push('The floor slot is as deep as the box: it may drop through. Make the slot narrower.');
    return out;
  },
});
