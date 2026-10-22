/**
 * Label tag: a small upright card with a clip on its back that goes in any
 * slot, to name what hangs below it or a whole row. Its text stands out 0.6 mm
 * inside a raised rim, is cut 0.6 mm in, or is inlaid (cut in and filled
 * flush). Raised and inlaid letters are a body of their own in the board
 * text's colour (colours.ts 'wallText'): with multi-colour off, raised ones
 * print with the card and inlaid ones in filament 2. Printed upright, as it
 * hangs: the card stands on the bed, the clip behind it, and raised letters on
 * its face are short ledges a printer bridges cleanly.
 */
import { backMounts, minHeight } from '../mount';
import { num, obj, pick, registerAttachment, str } from '../registry';

export interface LabelTagOptions {
  width: number;
  height: number;
  text: string;
  /** Capital letter height, mm (smaller when the text needs it to fit). */
  size: number;
  style: 'raised' | 'engraved' | 'inlaid';
}

export const LABEL_TAG_DEFAULTS: LabelTagOptions = { width: 40, height: 20, text: 'Label', size: 6, style: 'raised' };

/** Card thickness, how far text stands out or goes in, the raised rim's width; mm. */
export const TAG = { card: 2.4, relief: 0.6, rim: 1.2 } as const;

registerAttachment<LabelTagOptions>({
  type: 'labelTag',
  defaults: LABEL_TAG_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = LABEL_TAG_DEFAULTS;
    return {
      width: num(r.width, 20, 250, d.width),
      height: num(r.height, 15, 100, d.height),
      text: typeof r.text === 'string' ? str(r.text, 40) : d.text,
      size: num(r.size, 3, 30, d.size),
      style: pick(r.style, ['raised', 'engraved', 'inlaid'] as const, d.style),
    };
  },
  layout(o, ctx) {
    const h = Math.max(o.height, minHeight(ctx));
    const m = backMounts(o.width, h, ctx, { rows: 1 });
    return { w: o.width, h, depth: TAG.card + (o.style === 'raised' ? TAG.relief : 0), anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
  },
  summary: (o) => (o.text.trim() ? `Label “${o.text.trim()}”` : 'Label tag'),
  notes: (o) => (o.text.trim() ? [] : ['It has no text yet.']),
  backPlate: () => null,
  inlaid: (o) => o.style === 'inlaid' && !!o.text.trim(),
});
