import { boxAt } from '../../geometry/shapes';
import { hasFont, textOutline, textSolid } from '../../geometry/text';
import { splitInlay } from '../../geometry/inlay';
import type { AttachmentBuilder } from '../build';
import { TAG, type LabelTagOptions } from './labelTag';

export const labelTagBuilder: AttachmentBuilder<LabelTagOptions> = {
  body(w, s, o, layout) {
    const W = layout.w;
    const H = layout.h;
    const T = TAG.card;
    const R = TAG.relief;
    const card = s.t(boxAt(w, 0, 0, 0, W, H, T));
    // The text fits inside the rim with a millimetre to spare.
    const m = TAG.rim + 1;
    const t = o.text.trim() && hasFont() ? textOutline(o.text, { size: o.size, maxWidth: W - 2 * m, maxHeight: H - 2 * m }) : null;
    if (o.style !== 'raised') {
      // Cut in, or inlaid: what the text cuts out of the card fills it flush (the board text's colour).
      const cut = t && textSolid(w, t, W / 2, H / 2, T - R, R + 1);
      if (!cut) return card;
      s.t(cut);
      if (o.style === 'engraved') return s.t(card.subtract(cut));
      const { body, fill } = splitInlay(s, card, cut);
      return { body, inlays: fill ? [{ name: 'Label text', role: 'wallText', filament: 2, m: fill }] : [] };
    }
    // Raised: the letters stand on the card inside the rim, a body of their own (the board text's colour).
    const rim = s.t(s.t(boxAt(w, 0, 0, T - 0.5, W, H, T + R)).subtract(s.t(boxAt(w, TAG.rim, TAG.rim, T - 1, W - TAG.rim, H - TAG.rim, T + R + 1))));
    const body = s.t(w.Manifold.union([card, rim]));
    const raised = t && textSolid(w, t, W / 2, H / 2, T, R);
    return { body, inlays: raised ? [{ name: 'Label text', role: 'wallText', filament: 1, m: s.t(raised) }] : [] };
  },
};
