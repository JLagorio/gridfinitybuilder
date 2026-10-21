/**
 * Fit test: three small tabs with one clip each, at the snug, normal and
 * loose fit (one, two and three notches on the front). Print them first and
 * pick the board's fit (Attachments › Fit) from the one that clicks in and holds.
 */
import { backMounts, minHeight, printedSize } from '../mount';
import { registerAttachment, type MountCtx } from '../registry';
import type { SlotFit } from '../../geometry/skadis';

export type FitTestOptions = Record<string, never>;

export const FIT_TAB = { w: 16, depth: 3 };
export const FIT_ORDER: SlotFit[] = ['snug', 'normal', 'loose'];

export function fitTabLayout(ctx: MountCtx) {
  const h = minHeight(ctx) + 4;
  const m = backMounts(FIT_TAB.w, h, ctx, { rows: 1, columns: 1 });
  return { w: FIT_TAB.w, h, depth: FIT_TAB.depth, anchor: m.anchor, mounts: m.mounts, pose: 'upright' as const };
}

registerAttachment<FitTestOptions>({
  type: 'fitTest',
  defaults: {},
  sanitize: () => ({}),
  layout: (_o, ctx) => fitTabLayout(ctx),
  summary: () => 'Fit test tabs',
  parts(_o, ctx) {
    // The board's own fit is the tab itself; the other two print beside it.
    return FIT_ORDER.filter((f) => f !== ctx.fit).map((fit) => {
      const c = { ...ctx, fit };
      return { key: fit, name: `Fit test tab (${fit})`, spec: { fit }, ...printedSize(fitTabLayout(c), c) };
    });
  },
});
