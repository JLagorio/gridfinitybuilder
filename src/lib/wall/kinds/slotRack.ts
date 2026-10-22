/**
 * Slot rack: a vertical file, slots one behind the other for flat things that
 * stand on edge: printer build plates, laptops, tablets, keyboards, cutting
 * boards, pot lids, mail, quilting rulers, baseplates, saw blades, sandpaper.
 * The dividers stand parallel to the board and lean back a little, so a thing
 * rests against the divider behind it; each slot's floor is square to its
 * dividers. It can be narrower than what it holds: things stand in it and
 * stick out either side. A lower front wall shows off the front slot, a U
 * notch in the dividers lets you pinch a thin plate, drain holes let a wet
 * board or lid dry.
 *
 * Printed upright as it hangs: the floor on the bed, the dividers leaning back
 * at most 25° (well inside 45°), the notch and the drain holes cut straight
 * down. Clips across the top of the back, studs low on it: a rack of laptops
 * is heavy.
 */
import { backMounts, minHeight } from '../mount';
import { bool, int, num, obj, pick, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface SlotRackOptions {
  /** Slots, back to front. */
  count: number;
  /** Each slot's width, square to the dividers, mm. */
  slot: number;
  /** Dividers' height above the floor, mm. */
  height: number;
  /** Across the board, mm. */
  width: number;
  /** How far the dividers lean back, degrees. */
  tilt: number;
  /** The front wall's height above the front slot's floor, mm (at most the dividers'). */
  lip: number;
  floor: 'solid' | 'drain';
  /** A U notch down the middle of the dividers. */
  notch: boolean;
}

export const SLOT_RACK_DEFAULTS: SlotRackOptions = { count: 4, slot: 12, height: 60, width: 120, tilt: 10, lip: 40, floor: 'solid', notch: true };

/** Back plate thickness, mm. */
export const RACK_BACK = 3;

/**
 * The rack's side view, mm: divider thickness `t`, floor under the slots `f`,
 * the tilt `a` (radians), the slots' run `u` square to the dividers (from the
 * back of the first slot to the front of the front wall), where the first
 * slot's back is at its floor `z0` (the rack meets the back plate at the
 * dividers' tops), the dividers' tops `top`, the front wall's `front`, and how
 * far out it reaches `depth` (the front wall's foot).
 */
export function rackPlan(o: SlotRackOptions) {
  const t = o.slot >= 10 ? 3.2 : 2.4;
  const f = Math.min(6, 3 + o.slot / 12);
  const a = (o.tilt * Math.PI) / 180;
  const u = o.count * (o.slot + t);
  const z0 = RACK_BACK + o.height * Math.tan(a);
  const top = f + o.height;
  return { t, f, a, u, z0, top, front: Math.min(top, f + o.slot * Math.sin(a) + o.lip), depth: z0 + f * Math.tan(a) + u / Math.cos(a) };
}

const rackHeight = (o: SlotRackOptions, ctx: MountCtx) => Math.max(rackPlan(o).top, minHeight(ctx));

registerAttachment<SlotRackOptions>({
  type: 'slotRack',
  defaults: SLOT_RACK_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = SLOT_RACK_DEFAULTS;
    return {
      count: int(r.count, 1, 12, d.count),
      slot: num(r.slot, 2, 60, d.slot),
      height: num(r.height, 15, 150, d.height),
      width: num(r.width, 30, 240, d.width),
      tilt: num(r.tilt, 0, 25, d.tilt),
      lip: num(r.lip, 5, 150, d.lip),
      floor: pick(r.floor, ['solid', 'drain'] as const, d.floor),
      notch: bool(r.notch, d.notch),
    };
  },
  layout(o, ctx) {
    const h = rackHeight(o, ctx);
    const m = backMounts(o.width, h, ctx, { rows: 3 });
    return { w: o.width, h, depth: rackPlan(o).depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Slot rack ${o.count} × ${+o.slot.toFixed(1)} mm`,
  labelFace(o) {
    // Low on the front wall, under the finger notch: it leans back with the dividers, so the text goes in deeper at
    // its foot (where the face stands furthest out) to reach the face all the way up, the wall staying 1.2 mm thick.
    const p = rackPlan(o);
    const tan = Math.tan(p.a);
    const top = Math.min(p.front, o.notch && o.height >= 25 ? p.top - 0.45 * o.height : Infinity) - 1;
    const h = Math.min(10, top - 1, tan > 0 ? (p.t / Math.cos(p.a) - 1.8) / tan : Infinity);
    return h >= 5
      ? { x: 2, y: 1, w: o.width - 4, h, z: p.depth - tan, normal: 'front', depth: 0.6 + h * tan, ...(tan > 0 ? { flat: false as const } : {}) }
      : null;
  },
  // Its first divider leans in front of the whole back (the finger notch stops at it).
  backPlate: () => null,
  notes: (o, ctx) => leverNotes(rackPlan(o).depth, rackHeight(o, ctx)),
});
