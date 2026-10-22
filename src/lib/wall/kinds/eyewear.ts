/**
 * Glasses rest: one to four pairs, one above the other, each on an arm out
 * from the board:
 * - bridge: folded glasses hang by the bridge over a nose at the arm's end,
 *   its sides at 45° and its crest rounded off, so the nose pads rest on it;
 *   the lenses hang in front, the folded temples behind;
 * - temple: one folded temple drops into a slot by the board and the glasses
 *   hang in front of its lip, as from a shirt pocket; any glasses fit;
 * - strap: goggles and strapped safety glasses hang by the strap over a wide
 *   arm with a lip.
 * The arms can point up a little so the glasses sit back against the board.
 * Printed on its side: the arms' profile lies on the bed, the nose's 45° sides
 * build up across it without support. A pegboard hook at the top of the back,
 * studs below; a 45° brace under each arm.
 */
import { backMounts, mountBox } from '../mount';
import { int, num, obj, pick, registerAttachment, type MountCtx } from '../registry';
import { hookAndStud } from './saddle';
import { leverNotes } from './shelf';

export interface EyewearOptions {
  style: 'bridge' | 'temple' | 'strap';
  /** Pairs, one above the other. */
  pairs: number;
  /** Out from the board (bridge, strap), mm. */
  reach: number;
  /** One arm above the next, mm. */
  spacing: number;
  /** Across, mm. */
  width: number;
  /** The nose's height (bridge), the lip's (strap), the slot's depth (temple), mm. */
  tip: number;
  /** The arms point up this much, degrees. */
  angle: number;
  /** Temple: the slot's width, mm. */
  slot: number;
}

export const EYEWEAR_DEFAULTS: EyewearOptions = { style: 'bridge', pairs: 2, reach: 50, spacing: 60, width: 24, tip: 10, angle: 10, slot: 5 };

/** Back plate, arm, nose and lip thickness, the nose's crest (half), the largest brace; mm. */
export const EYE = { back: 4, arm: 6, tipT: 5, lipT: 3, crest: 2, brace: 15 } as const;

/** The arms' length and slope, the braces, and how far each rises from its underside at the back to its nose's top. */
function eyeArm(o: EyewearOptions) {
  const B = EYE.back;
  const temple = o.style === 'temple';
  const R = temple ? B + o.slot + EYE.lipT : Math.max(o.reach, B + 15);
  const t = temple ? 0 : Math.tan((o.angle * Math.PI) / 180);
  const brace = Math.max(2, Math.min(EYE.brace, 0.4 * (R - B), o.spacing - EYE.arm - 4));
  // From an arm's underside at the back to the top of its nose, lip or slot at the front.
  return { R, t, brace, rise: (R - B) * t + EYE.arm + o.tip };
}

/** Each arm's underside at the back of a back `H` tall, the top one at the top. */
const eyeArms = (o: EyewearOptions, H: number, rise: number) => Array.from({ length: o.pairs }, (_, k) => H - rise - (o.pairs - 1 - k) * o.spacing);

/** Each arm's underside at the back, the arms' length and slope, the braces, and the back's height. */
export function eyeShape(o: EyewearOptions, ctx: MountCtx) {
  const { R, t, brace, rise } = eyeArm(o);
  const H = Math.ceil(Math.max(brace + 2 + (o.pairs - 1) * o.spacing + rise, hookAndStud(ctx)));
  return { R, t, brace, arms: eyeArms(o, H, rise), tipTop: (yb: number) => yb + rise, H };
}

const eyeWidth = (o: EyewearOptions, ctx: MountCtx) => Math.max(o.width, 2 * mountBox('stud', [0, 0], ctx).x1);

registerAttachment<EyewearOptions>({
  type: 'eyewear',
  defaults: EYEWEAR_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = EYEWEAR_DEFAULTS;
    return {
      style: pick(r.style, ['bridge', 'temple', 'strap'] as const, d.style),
      pairs: int(r.pairs, 1, 4, d.pairs),
      reach: num(r.reach, 25, 120, d.reach),
      spacing: num(r.spacing, 30, 150, d.spacing),
      width: num(r.width, 14, 60, d.width),
      tip: num(r.tip, 4, 40, d.tip),
      angle: num(r.angle, 0, 30, d.angle),
      slot: num(r.slot, 2, 10, d.slot),
    };
  },
  layout(o, ctx) {
    const e = eyeShape(o, ctx);
    const w = eyeWidth(o, ctx);
    const m = backMounts(w, e.H, ctx, { kind: 'hook', rows: 3, columns: 1, left: true });
    return { w, h: e.H, depth: e.R, anchor: m.anchor, mounts: m.mounts, pose: 'side' };
  },
  summary(o) {
    const n = `${o.pairs} pair${o.pairs === 1 ? '' : 's'}`;
    return o.style === 'strap' ? `Goggle hook${o.pairs > 1 ? ` × ${o.pairs}` : ''}` : `Glasses ${o.style === 'temple' ? 'hanger' : 'rest'}, ${n}`;
  },
  backPlate(o, l) {
    // Under each arm's brace, over the one below's nose (or lip): the arms and their braces take the rest.
    const { brace, rise } = eyeArm(o);
    const arms = eyeArms(o, l.h, rise);
    return arms.map((yb, k) => ({ x0: 0, x1: l.w, y0: k ? arms[k - 1] + rise : 0, y1: yb - brace, z: EYE.back }));
  },
  notes(o, ctx) {
    const e = eyeShape(o, ctx);
    return leverNotes(e.R, e.H);
  },
});
