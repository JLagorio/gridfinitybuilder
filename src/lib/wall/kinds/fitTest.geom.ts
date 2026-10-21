import { Scope, type Manifold, type Wasm } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { mountSolids } from '../mount';
import { posed, type AttachmentBuilder } from '../build';
import type { MountCtx } from '../registry';
import { FIT_ORDER, FIT_TAB, fitTabLayout } from './fitTest';

/** A tab with notches across its front: one per step looser. */
function tab(w: Wasm, s: Scope, ctx: MountCtx): Manifold {
  const l = fitTabLayout(ctx);
  let m = s.t(boxAt(w, 0, 0, 0, l.w, l.h, FIT_TAB.depth));
  const n = FIT_ORDER.indexOf(ctx.fit) + 1;
  for (let k = 0; k < n; k++) {
    const x = l.w / 2 + (k - (n - 1) / 2) * 3;
    m = s.t(m.subtract(s.t(boxAt(w, x - 0.6, l.h - 5, FIT_TAB.depth - 0.6, x + 0.6, l.h + 1, FIT_TAB.depth + 1))));
  }
  return m;
}

export const fitTestBuilder: AttachmentBuilder<Record<string, never>> = {
  body: (w, s, _o, _l, ctx) => tab(w, s, ctx),
  part(w, spec: { fit: MountCtx['fit'] }, ctx) {
    const s = new Scope();
    try {
      const c = { ...ctx, fit: spec.fit };
      const l = fitTabLayout(c);
      const all = s.t(w.Manifold.union([tab(w, s, c), ...mountSolids(w, s, l, c)]));
      return posed(s, all, l, 'fit test tab');
    } finally {
      s.dispose();
    }
  },
};
