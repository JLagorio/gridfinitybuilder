/**
 * Fit test: small tabs with one clip each, to print before anything else.
 * Three tabs at the snug, normal and loose fit, or five on a ladder of slot
 * widths 0.1 mm apart around the board's (at its fit): each says on its front
 * what it is (and has one to five notches on top, should the text not show).
 * Pick the board's fit, or set its Slot width, from the tab that clicks in and
 * holds.
 *
 * And a thickness gauge: a flat comb with notches 4.6 to 5.6 mm wide, each
 * numbered, printed flat so the notches are as true as the printer makes
 * anything. Push a tooth through a slot and slide the board's edge into the
 * notches: the narrowest that goes on is how thick the board really is (they
 * run 4.8 to 5.5 mm), and the board's Thickness should say so: hooks and lock
 * keys are sized from it.
 */
import { backMounts, minHeight, printedSize } from '../mount';
import { bool, obj, pick, registerAttachment, type MountCtx } from '../registry';
import type { SlotFit } from '../../geometry/skadis';

export interface FitTestOptions {
  /** Three tabs (snug, normal, loose) or five (slot widths). */
  steps: 3 | 5;
  /** The thickness gauge too. */
  gauge: boolean;
}

export const FIT_TEST_DEFAULTS: FitTestOptions = { steps: 3, gauge: false };

export const FIT_TAB = { w: 16, depth: 3 };
export const FIT_ORDER: SlotFit[] = ['snug', 'normal', 'loose'];

/** The gauge: its notches (mm), the teeth between them and at its ends, how deep the notches go, the band for the numbers, its thickness. */
export const GAUGE = { notches: [4.6, 4.8, 5, 5.2, 5.4, 5.6], tooth: 4, end: 4, depth: 8, band: 8, t: 3 } as const;

/** The gauge's size as printed (flat). */
export const gaugeSize = () => ({
  w: 2 * GAUGE.end + GAUGE.notches.reduce((t, n) => t + n, 0) + (GAUGE.notches.length - 1) * GAUGE.tooth,
  d: GAUGE.depth + GAUGE.band,
  h: GAUGE.t,
});

/** One tab: the fit and slot width its clip is made for, what its front says and how many notches it has. */
export interface FitTab {
  fit: SlotFit;
  slotW: number;
  text: string;
  notches: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
/** A size as it reads on a tab: 5.0, 5.1, 5.15. */
export const mm = (v: number) => (Math.abs(v * 10 - Math.round(v * 10)) < 1e-6 ? v.toFixed(1) : String(r2(v)));

/** The tabs, in order; the board's own (its fit, its slot width) is the attachment itself, the others print beside it. */
export function fitTabs(o: FitTestOptions, ctx: MountCtx): FitTab[] {
  if (o.steps === 5)
    return [-2, -1, 0, 1, 2].map((k) => {
      const slotW = k ? r2(ctx.slotW + k / 10) : ctx.slotW;
      return { fit: ctx.fit, slotW, text: mm(slotW), notches: k + 3 };
    });
  return FIT_ORDER.map((fit, k) => ({ fit, slotW: ctx.slotW, text: fit.toUpperCase(), notches: k + 1 }));
}

/** The board a tab is made for. */
export const tabCtx = (t: Pick<FitTab, 'fit' | 'slotW'>, ctx: MountCtx): MountCtx => ({ ...ctx, fit: t.fit, slotW: t.slotW });

/** Whether a tab is the board's own. */
const own = (t: FitTab, ctx: MountCtx) => t.fit === ctx.fit && t.slotW === ctx.slotW;

export function fitTabLayout(ctx: MountCtx) {
  const h = minHeight(ctx) + 4;
  const m = backMounts(FIT_TAB.w, h, ctx, { rows: 1, columns: 1 });
  return { w: FIT_TAB.w, h, depth: FIT_TAB.depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' as const };
}

/** The board's own tab (the attachment's body). */
export const ownTab = (o: FitTestOptions, ctx: MountCtx) => fitTabs(o, ctx).find((t) => own(t, ctx))!;

registerAttachment<FitTestOptions>({
  type: 'fitTest',
  defaults: FIT_TEST_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    return { steps: Number(pick(String(r.steps), ['3', '5'], '3')) as 3 | 5, gauge: bool(r.gauge, FIT_TEST_DEFAULTS.gauge) };
  },
  layout: (_o, ctx) => fitTabLayout(ctx),
  summary: (o) => (o.steps === 5 ? 'Fit test, slot widths' : 'Fit test tabs'),
  parts(o, ctx) {
    const tabs = fitTabs(o, ctx)
      .filter((t) => !own(t, ctx))
      .map((tab) => {
        const c = tabCtx(tab, ctx);
        const key = o.steps === 5 ? `w${tab.slotW}` : tab.fit;
        return {
          key,
          name: o.steps === 5 ? `Fit test tab (${tab.text} mm slots)` : `Fit test tab (${tab.fit})`,
          spec: { tab },
          ...printedSize(fitTabLayout(c), c),
        };
      });
    return o.gauge ? [...tabs, { key: 'gauge', name: 'Thickness gauge', spec: { gauge: true }, ...gaugeSize() }] : tabs;
  },
});
