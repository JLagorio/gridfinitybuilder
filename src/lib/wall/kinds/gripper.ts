/**
 * Gripper: C-shaped clips that round things snap into from the front: broom,
 * mop and rake handles, flashlights, tubes, a bike pump. The C wraps 180–260°
 * round the item; past 180° its mouth is narrower than the item (about 87%
 * at 240°), so the arms spring apart to let it in and close round it. Grip
 * ribs inside keep a handle from sliding down. A short stem joins each C to
 * the back plate, so the arms are free to flex from there.
 *
 * The arms have to flex in the plane of the layers, or they snap along a layer
 * line, so the C's section lies flat on the bed either way it's held:
 * - upright (the item standing up): printed as it hangs, the C's axis is
 *   upright and the C a prism standing on the bed; clips across the top of
 *   the back, studs below. Several side by side.
 * - lying (the item across): printed on its side, the C's axis is the
 *   print's upright, like the cable clips; a pegboard hook and a stud hold it.
 *   Several one above the other.
 */
import { MOUNT, backMounts, minHeight, mountBox } from '../mount';
import { bool, int, num, obj, pick, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface GripperOptions {
  /** The item's diameter, mm. */
  diameter: number;
  /** How far round the item the C goes, degrees. */
  wrap: number;
  /** The C's thickness, mm. */
  arm: number;
  count: number;
  /** Centre to centre, mm. */
  pitch: number;
  axis: 'vertical' | 'horizontal';
  ribs: boolean;
  /** Along the item, mm. */
  length: number;
}

export const GRIPPER_DEFAULTS: GripperOptions = { diameter: 25, wrap: 240, arm: 3, count: 1, pitch: 45, axis: 'vertical', ribs: true, length: 25 };

/** Back plate, clearance round the item, the stem from the plate to the C, grip ribs (how far in, their radius); mm. */
export const GRIP = { back: 3, fit: 0.1, stem: 1.5, rib: 0.5, ribR: 0.9 } as const;

const RAD = Math.PI / 180;

/**
 * The C: its inside radius, centre out from the board, the mouth's width (between the tips' rounded ends), the
 * front of the tips, centre to centre, and the part's size (the C's run across, or up, and the rest).
 */
export function gripGeometry(o: GripperOptions, ctx: MountCtx) {
  const r = o.diameter / 2 + GRIP.fit;
  const R = r + o.arm;
  const zc = GRIP.back + GRIP.stem + R;
  const half = ((360 - o.wrap) / 2) * RAD;
  const tip = r + o.arm / 2;
  const mouth = 2 * tip * Math.sin(half) - o.arm;
  const depth = zc + tip * Math.cos(half) + o.arm / 2;
  const pitch = Math.max(o.pitch, 2 * R + 2);
  const run = (o.count - 1) * pitch + 2 * R;
  if (o.axis === 'vertical') {
    const w = Math.max(run, 2 * (mountBox('clip', [0, 0], ctx).x1 + MOUNT.margin));
    return { r, R, zc, half, mouth, pitch, run, depth, w, h: Math.max(o.length, minHeight(ctx) + 2 * ctx.pitch) };
  }
  // On its side: room for the hook and a stud below it.
  const hook = mountBox('hook', [0, 0], ctx);
  const stud = mountBox('stud', [0, -2 * ctx.pitch], ctx);
  const h = Math.max(run + 2 * MOUNT.margin, hook.y1 - stud.y0 + 2 * MOUNT.margin, minHeight(ctx, 'hook'));
  return { r, R, zc, half, mouth, pitch, run, depth, w: Math.max(o.length, hook.x1 * 2), h };
}

registerAttachment<GripperOptions>({
  type: 'gripper',
  defaults: GRIPPER_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = GRIPPER_DEFAULTS;
    return {
      diameter: num(r.diameter, 4, 100, d.diameter),
      wrap: num(r.wrap, 180, 260, d.wrap),
      arm: num(r.arm, 1.2, 8, d.arm),
      count: int(r.count, 1, 10, d.count),
      pitch: num(r.pitch, 10, 300, d.pitch),
      axis: pick(r.axis, ['vertical', 'horizontal'] as const, d.axis),
      ribs: bool(r.ribs, d.ribs),
      length: num(r.length, 6, 100, d.length),
    };
  },
  layout(o, ctx) {
    const g = gripGeometry(o, ctx);
    const side = o.axis === 'horizontal';
    const m = side ? backMounts(g.w, g.h, ctx, { kind: 'hook', rows: 2, columns: 1, left: true }) : backMounts(g.w, g.h, ctx, { rows: 3 });
    return { w: g.w, h: g.h, depth: g.depth, anchor: m.anchor, mounts: m.mounts, pose: side ? 'side' : 'upright' };
  },
  summary: (o) => `${o.count > 1 ? `${o.count} grippers` : 'Gripper'} ⌀${Math.round(o.diameter * 10) / 10}`,
  backPlate(o, l) {
    // Beside each C (and over them, upright; past their ends, on its side).
    const R = o.diameter / 2 + GRIP.fit + o.arm;
    const P = Math.max(o.pitch, 2 * R + 2);
    const side = o.axis === 'horizontal';
    const span = side ? l.h : l.w;
    const c0 = (span - ((o.count - 1) * P + 2 * R)) / 2 + R;
    const e = [0, ...Array.from({ length: o.count }, (_, k) => c0 + k * P).flatMap((c) => [c - R, c + R]), span];
    const gaps = Array.from({ length: e.length / 2 }, (_, k) => [e[2 * k], e[2 * k + 1]]);
    const z = GRIP.back;
    if (side) return [...gaps.map(([y0, y1]) => ({ x0: 0, x1: l.w, y0, y1, z })), { x0: o.length, x1: l.w, y0: 0, y1: l.h, z }];
    return [...gaps.map(([x0, x1]) => ({ x0, x1, y0: 0, y1: l.h, z })), { x0: 0, x1: l.w, y0: o.length, y1: l.h, z }];
  },
  notes(o, ctx) {
    const g = gripGeometry(o, ctx);
    const out = leverNotes(g.depth, g.h);
    if (o.wrap < 200) out.push('Under 200° round it hardly snaps shut: the item can fall out.');
    if (o.arm > 0.25 * o.diameter + 1) out.push('Arms that thick on so small an item may crack instead of springing open: make them thinner.');
    return out;
  },
});
