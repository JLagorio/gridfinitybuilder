import type { Manifold } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { hasFont, textOutline, textSolid } from '../../geometry/text';
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
    if (o.style === 'engraved') {
      const cut = t && textSolid(w, t, W / 2, H / 2, T - R, R + 1);
      return cut ? s.t(card.subtract(s.t(cut))) : card;
    }
    const rim = s.t(s.t(boxAt(w, 0, 0, T - 0.5, W, H, T + R)).subtract(s.t(boxAt(w, TAG.rim, TAG.rim, T - 1, W - TAG.rim, H - TAG.rim, T + R + 1))));
    const raised = t && textSolid(w, t, W / 2, H / 2, T - 0.5, R + 0.5);
    const parts: Manifold[] = [card, rim];
    if (raised) parts.push(s.t(raised));
    return s.t(w.Manifold.union(parts));
  },
};
