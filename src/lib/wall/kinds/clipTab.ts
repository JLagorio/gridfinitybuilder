/**
 * Clip tab: a tongue standing up in front of the board, like a belt, that a
 * belt clip or pen clip slides down onto: tape measures, utility knives,
 * flashlights, radios, pens. Its leaf goes into the gap behind the tongue,
 * past a small bump that keeps it from riding up and off; the tongue's top is
 * chamfered to lead it on. One or a row of them. Printed upright as it hangs:
 * a foot on the bed joins each tongue to the back, the gap is open at the
 * top and the bump's faces are 45°. Clips across the top of the back.
 */
import { backMounts, minHeight } from '../mount';
import { int, num, obj, registerAttachment, type MountCtx } from '../registry';

export interface ClipTabOptions {
  /** The tongue: across, thick (like a belt) and tall, mm. */
  width: number;
  thick: number;
  length: number;
  /** Behind the tongue, for the clip's leaf, mm. */
  gap: number;
  /** The retaining bump on the tongue's back, mm (0 = none). */
  bump: number;
  count: number;
  /** Tongue centre to centre, mm. */
  pitch: number;
}

export const CLIP_TAB_DEFAULTS: ClipTabOptions = { width: 32, thick: 4, length: 40, gap: 3, bump: 0.8, count: 1, pitch: 90 };

/** Back plate thickness, the foot under the gap, margin at the ends, the bump's height up the tongue (share); mm. */
export const TAB = { back: 3, foot: 4, edge: 4, bumpAt: 0.5 } as const;

/** Tongue centres across, the part's width (at least 50: two columns of clips), height and depth, and where the bump is. */
export function tabPlan(o: ClipTabOptions, ctx: MountCtx) {
  const P = Math.max(o.pitch, o.width + 4);
  const span = (o.count - 1) * P + o.width + 2 * TAB.edge;
  const W = Math.max(50, span);
  const xs = Array.from({ length: o.count }, (_, k) => W / 2 + (k - (o.count - 1) / 2) * P);
  const H = Math.ceil(Math.max(minHeight(ctx), TAB.foot + o.length));
  const bump = Math.min(o.bump, o.gap - 0.8);
  return { xs, W, H, D: TAB.back + o.gap + o.thick, bump: Math.max(0, bump), bumpY: TAB.foot + TAB.bumpAt * o.length };
}

registerAttachment<ClipTabOptions>({
  type: 'clipTab',
  defaults: CLIP_TAB_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = CLIP_TAB_DEFAULTS;
    return {
      width: num(r.width, 6, 60, d.width),
      thick: num(r.thick, 1.5, 8, d.thick),
      length: num(r.length, 15, 80, d.length),
      gap: num(r.gap, 1, 8, d.gap),
      bump: num(r.bump, 0, 2, d.bump),
      count: int(r.count, 1, 8, d.count),
      pitch: num(r.pitch, 10, 150, d.pitch),
    };
  },
  layout(o, ctx) {
    const p = tabPlan(o, ctx);
    const m = backMounts(p.W, p.H, ctx, { rows: 2 });
    return { w: p.W, h: p.H, depth: p.D, anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => (o.count > 1 ? `Clip tabs ${o.count} × ${Math.round(o.width)} mm` : `Clip tab ${Math.round(o.width)} mm`),
  notes: (o) => (o.bump > o.gap - 0.8 ? [`The bump is cut to ${Math.max(0, Math.round((o.gap - 0.8) * 10) / 10)} mm, to leave the clip 0.8 mm past it.`] : []),
});
