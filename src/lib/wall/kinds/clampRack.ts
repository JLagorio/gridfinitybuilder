/**
 * Clamp rack: a deep ledge with a comb of slots open at the front for F-clamp
 * and bar-clamp bars. A bar slides in from the front and hangs down through
 * its slot, the fixed jaw resting on the ledge behind it, pointing at the
 * board, so the clamp's weight sits over the ledge. Beside the comb, a rail
 * spring clamps grip by its top edge. Clamps are heavy: clips across the top
 * of a tall back, two rows of studs low on it, 45° gussets between the slots
 * and at the ends, and a fillet along the back edge. Printed upright as it
 * hangs: the ledge on the bed, the gussets and the rail standing on it.
 */
import { backMounts, minHeight } from '../mount';
import { int, num, obj, registerAttachment, type MountCtx } from '../registry';
import { leverNotes } from './shelf';

export interface ClampRackOptions {
  /** Slots for bar clamps. */
  count: number;
  /** A bar's width (out from the board as it hangs) and thickness (across), mm. */
  barW: number;
  barT: number;
  /** Slot centre to centre, mm. */
  pitch: number;
  /** Out from the board, mm: deep enough for the fixed jaw to rest on. */
  depth: number;
  /** The spring-clamp rail's length (0 = none) and thickness, mm. */
  springs: number;
  edge: number;
  /** Added each side of the bar, mm. */
  clearance: number;
  /** Back height, mm. */
  height: number;
}

export const CLAMP_RACK_DEFAULTS: ClampRackOptions = { count: 3, barW: 20, barT: 6, pitch: 45, depth: 90, springs: 60, edge: 12, clearance: 1, height: 100 };

/** Back plate and ledge thickness, gusset thickness, the slots' 45° mouth, the spring rail's height above the ledge, the fillet along the back; mm. */
export const CLAMP = { back: 4, ledge: 8, gusset: 4, mouth: 3, rail: 25, fillet: 4 } as const;

/** The rack's shape: slot centres and size, how deep, the spring rail's span, gussets' left edges, width. */
export function clampPlan(o: ClampRackOptions) {
  const c = o.clearance;
  const slotW = o.barT + 2 * c;
  const slotL = o.barW + 2 * c + 2;
  const D = Math.max(o.depth, CLAMP.back + slotL + 15);
  const g = CLAMP.gusset;
  const span = o.count * o.pitch + (o.springs > 0 ? o.springs + 2 * g : 0);
  // At least 50 mm wide (two columns of clips), what it holds in the middle.
  const W = Math.max(50, span);
  const x = (W - span) / 2;
  const comb = x + o.count * o.pitch;
  const rail = o.springs > 0 ? { x0: comb + g, x1: comb + g + o.springs } : null;
  const slots = Array.from({ length: o.count }, (_, k) => x + (k + 0.5) * o.pitch);
  // Gussets at the ends, and between slots where the teeth leave room for a jaw beside them.
  const gussets = [0, W - g];
  if (o.pitch >= 40) for (let k = 1; k < o.count; k++) gussets.push(x + k * o.pitch - g / 2);
  if (rail) gussets.push(comb - g / 2);
  return { slotW, slotL, D, slots, rail, W, gussets, z0: D - slotL };
}

const clampHeight = (o: ClampRackOptions, ctx: MountCtx) => Math.ceil(Math.max(o.height, minHeight(ctx), CLAMP.ledge + CLAMP.rail + 2));

registerAttachment<ClampRackOptions>({
  type: 'clampRack',
  defaults: CLAMP_RACK_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = CLAMP_RACK_DEFAULTS;
    return {
      count: int(r.count, 1, 12, d.count),
      barW: num(r.barW, 8, 50, d.barW),
      barT: num(r.barT, 3, 20, d.barT),
      pitch: num(r.pitch, 25, 150, d.pitch),
      depth: num(r.depth, 40, 200, d.depth),
      springs: num(r.springs, 0, 300, d.springs),
      edge: num(r.edge, 6, 25, d.edge),
      clearance: num(r.clearance, 0.3, 3, d.clearance),
      height: num(r.height, 40, 200, d.height),
    };
  },
  layout(o, ctx) {
    const p = clampPlan(o);
    const h = clampHeight(o, ctx);
    const m = backMounts(p.W, h, ctx, { rows: 3 });
    return { w: p.W, h, depth: p.D, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => `Clamp rack, ${o.count} slot${o.count === 1 ? '' : 's'}${o.springs > 0 ? ' + spring rail' : ''}`,
  backPlate(o, l) {
    // Over the ledge and its fillet (and over the spring rail, where it stands in front), between the gussets. The
    // clamps hang in front: screw it on first.
    const p = clampPlan(o);
    const g = CLAMP.gusset;
    const xs = [...p.gussets].sort((a, b) => a - b);
    return xs.slice(1).map((x, k) => {
      const x0 = xs[k] + g;
      const rail = p.rail && x0 < p.rail.x1 && x > p.rail.x0;
      return { x0, x1: x, y0: CLAMP.ledge + (rail ? CLAMP.rail : CLAMP.fillet), y1: l.h, z: CLAMP.back };
    });
  },
  notes(o, ctx) {
    const out = leverNotes(clampPlan(o).D, clampHeight(o, ctx));
    if (o.pitch < o.barT + 2 * o.clearance + 10) out.push('The slots are closer than the teeth between them can take: space them further apart.');
    return out;
  },
});
