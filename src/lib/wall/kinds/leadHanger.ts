/**
 * Lead hanger: a keyhole comb for leads that hang by their plugs. A cable
 * slides into a slot from the front, down to a hole at its end, and the
 * plug or head above it drops into a round pocket round the hole: it can't
 * slide back out of the slot, and the cable hangs below, over the board.
 * For test leads (banana plugs), scope probes, USB cables, XLR and jack
 * leads, dog leads by their clips. Like the cable comb, but for cables that
 * end in something bigger.
 *
 * Printed upright as it hangs: the comb is a ledge on the bed, the slots and
 * pockets go straight down through it, and 45° gussets at the ends brace it
 * against the back plate. Clips across the top of the back, studs low on it.
 */
import { backMounts, minHeight } from '../mount';
import { int, num, obj, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface LeadHangerOptions {
  /** The slot the cable slides in, mm (the cable and a little). */
  slot: number;
  /** The pocket the plug sits in: diameter and depth, mm. */
  pocket: number;
  depth: number;
  count: number;
  /** Centre to centre, mm (at least the pocket and a wall). */
  pitch: number;
  /** Back plate height, mm. */
  height: number;
}

export const LEAD_DEFAULTS: LeadHangerOptions = { slot: 4.5, pocket: 13, depth: 8, count: 6, pitch: 18, height: 60 };

/** Back plate, plastic under the pockets, round them, the fillet behind them, end gussets, least wall between pockets; mm. */
export const LEAD = { back: 3, floor: 3, edge: 3, fillet: 3, end: 3, wall: 2.4 } as const;

/** The comb, mm: pitch, ledge thickness, the pockets' centres (x, and z out from the board), width and depth. */
export function leadPlan(o: LeadHangerOptions) {
  const pitch = Math.max(o.pitch, o.pocket + LEAD.wall);
  const zc = LEAD.back + LEAD.fillet + 1 + o.pocket / 2;
  const x0 = LEAD.end + LEAD.edge + o.pocket / 2;
  const xs = Array.from({ length: o.count }, (_, k) => x0 + k * pitch);
  return { pitch, t: o.depth + LEAD.floor, xs, zc, W: 2 * x0 + (o.count - 1) * pitch, D: zc + o.pocket / 2 + LEAD.edge };
}

const leadHeight = (o: LeadHangerOptions, ctx: MountCtx) => Math.max(o.height, minHeight(ctx), leadPlan(o).t + 10);

registerAttachment<LeadHangerOptions>({
  type: 'leadHanger',
  defaults: LEAD_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = LEAD_DEFAULTS;
    const pocket = num(r.pocket, 5, 60, d.pocket);
    return {
      slot: num(r.slot, 1.5, pocket - 2, d.slot),
      pocket,
      depth: num(r.depth, 2, 40, d.depth),
      count: int(r.count, 1, 16, d.count),
      pitch: num(r.pitch, 6, 100, d.pitch),
      height: num(r.height, 20, 150, d.height),
    };
  },
  layout(o, ctx) {
    const p = leadPlan(o);
    const h = leadHeight(o, ctx);
    const m = backMounts(p.W, h, ctx, { rows: 2 });
    return { w: p.W, h, depth: p.D, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Lead hanger, ${o.count} × ⌀${o.pocket}`,
  backPlate(o, l) {
    // Over the comb and its fillet, between the end gussets.
    const t = leadPlan(o).t;
    return { x0: LEAD.end, x1: l.w - LEAD.end, y0: t + Math.min(LEAD.fillet, l.h - t - 0.5), y1: l.h, z: LEAD.back };
  },
  notes(o, ctx) {
    const out = leverNotes(leadPlan(o).D, leadHeight(o, ctx));
    if (o.slot > o.pocket - 3) out.push('The slot is nearly as wide as the pocket: the plugs may slip through.');
    return out;
  },
  // A lead and its plugs, about 100 g.
  load: (o, l) => ({ kg: 0.1 * o.count, at: l.depth / 2 }),
});
