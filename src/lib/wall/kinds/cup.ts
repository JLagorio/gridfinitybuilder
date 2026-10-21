/**
 * Cups and rings: round holders on a back strip, for pens, brushes, spray
 * cans, a drill. Open-bottomed rings hold things that go through. Printed
 * upright as they hang.
 */
import { backMounts, minHeight } from '../mount';
import { int, num, obj, pick, registerAttachment } from '../registry';

export interface CupOptions {
  /** Inside diameter, mm. */
  diameter: number;
  height: number;
  count: number;
  /** Gap between cups, mm. */
  gap: number;
  wall: number;
  bottom: 'closed' | 'open';
}

export const CUP_DEFAULTS: CupOptions = { diameter: 40, height: 60, count: 1, gap: 4, wall: 1.6, bottom: 'closed' };

/** Back strip thickness. */
export const CUP_BACK = 2.4;

export const cupWidth = (o: CupOptions) => o.count * (o.diameter + 2 * o.wall) + (o.count - 1) * o.gap;

registerAttachment<CupOptions>({
  type: 'cup',
  defaults: CUP_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = CUP_DEFAULTS;
    return {
      diameter: num(r.diameter, 6, 200, d.diameter),
      height: num(r.height, 10, 250, d.height),
      count: int(r.count, 1, 12, d.count),
      gap: num(r.gap, 0, 40, d.gap),
      wall: num(r.wall, 0.8, 5, d.wall),
      bottom: pick(r.bottom, ['closed', 'open'] as const, d.bottom),
    };
  },
  layout(o, ctx) {
    const w = cupWidth(o);
    const h = Math.max(o.height, minHeight(ctx));
    const m = backMounts(w, h, ctx, { rows: 2 });
    // Each cup sinks one wall into the strip.
    return { w, h, depth: CUP_BACK + o.diameter + o.wall, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `${o.count > 1 ? `${o.count} ` : ''}${o.bottom === 'open' ? 'ring' : 'cup'}${o.count > 1 ? 's' : ''} ⌀${Math.round(o.diameter)}`,
});
