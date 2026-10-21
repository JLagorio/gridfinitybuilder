/**
 * Cable comb: a shelf of keyhole slots along the bottom of a back plate that
 * keeps cables running up and down the board apart. Each slot's mouth is
 * about 10% narrower than its cable, so the cable clicks into its seat.
 * Printed upright, the comb flat on the bed; clips across the back.
 */
import { backMounts, minHeight } from '../mount';
import { int, num, obj, registerAttachment } from '../registry';

export interface CableCombOptions {
  count: number;
  /** Cable diameter, mm. */
  diameter: number;
  /** Plastic between neighbouring cables, mm. */
  gap: number;
}

export const COMB_DEFAULTS: CableCombOptions = { count: 4, diameter: 6, gap: 6 };

/** Back plate, comb thickness (up), plastic behind the seats and in front of them, mm. */
export const COMB = { back: 3, plate: 6, behind: 1.5, front: 3 } as const;

/** Seat radius, centre out from the board, the comb's depth and its width. */
export function combSize(o: CableCombOptions) {
  const r = o.diameter / 2 + 0.15;
  const zc = COMB.back + COMB.behind + r;
  return { r, zc, Z: zc + r + COMB.front, W: Math.max(12, o.count * 2 * r + (o.count + 1) * o.gap) };
}

registerAttachment<CableCombOptions>({
  type: 'cableComb',
  defaults: COMB_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = COMB_DEFAULTS;
    return { count: int(r.count, 1, 16, d.count), diameter: num(r.diameter, 2, 25, d.diameter), gap: num(r.gap, 3, 30, d.gap) };
  },
  layout(o, ctx) {
    const { Z, W } = combSize(o);
    const h = minHeight(ctx) + 1;
    const m = backMounts(W, h, ctx, { rows: 1 });
    return { w: W, h, depth: Z, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Cable comb, ${o.count} × ⌀${o.diameter}`,
});
