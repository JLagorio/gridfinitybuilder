import { Scope, assertValid, toMeshData, type Manifold, type Wasm } from '../../geometry/kernel';
import { boxAt } from '../../geometry/shapes';
import { hasFont, textOutline, textSolid } from '../../geometry/text';
import { mountSolids } from '../mount';
import { labelCut, posed, type AttachmentBuilder } from '../build';
import type { MountCtx } from '../registry';
import { FIT_TAB, GAUGE, fitTabLayout, gaugeSize, mm, ownTab, tabCtx, type FitTab, type FitTestOptions } from './fitTest';

/** A tab with its name (or slot width) on its front and notches across its top, for the board `ctx` it's made for. */
function tab(w: Wasm, s: Scope, ctx: MountCtx, t: FitTab): Manifold {
  const l = fitTabLayout(ctx);
  let m = s.t(boxAt(w, 0, 0, 0, l.w, l.h, FIT_TAB.depth));
  const cuts: Manifold[] = [];
  for (let k = 0; k < t.notches; k++) {
    const x = l.w / 2 + (k - (t.notches - 1) / 2) * 3;
    cuts.push(s.t(boxAt(w, x - 0.6, l.h - 5, FIT_TAB.depth - 0.6, x + 0.6, l.h + 1, FIT_TAB.depth + 1)));
  }
  const text = labelCut(w, s, t.text, { x: 1.5, y: 1.5, w: l.w - 3, h: l.h - 8, z: FIT_TAB.depth, normal: 'front' });
  if (text) cuts.push(text);
  m = s.t(m.subtract(s.t(w.Manifold.union(cuts))));
  return m;
}

/** The thickness gauge, flat as printed: notches along its front edge, each with its width engraved behind it. */
function gauge(w: Wasm, s: Scope): Manifold {
  const g = gaugeSize();
  const cuts: Manifold[] = [];
  let x = GAUGE.end;
  for (const n of GAUGE.notches) {
    cuts.push(s.t(boxAt(w, x, -1, -1, x + n, GAUGE.depth, g.h + 1)));
    if (hasFont()) {
      const t = textSolid(w, textOutline(mm(n), { size: 3, maxWidth: n + GAUGE.tooth - 1 }), x + n / 2, GAUGE.depth + GAUGE.band / 2, g.h - 0.6, 1);
      if (t) cuts.push(s.t(t));
    }
    x += n + GAUGE.tooth;
  }
  return s.t(s.t(boxAt(w, 0, 0, 0, g.w, g.d, g.h)).subtract(s.t(w.Manifold.union(cuts))));
}

export const fitTestBuilder: AttachmentBuilder<FitTestOptions> = {
  body: (w, s, o, _l, ctx) => tab(w, s, ctx, ownTab(o, ctx)),
  part(w, spec: { tab: FitTab } | { gauge: true }, ctx) {
    const s = new Scope();
    try {
      if ('gauge' in spec) {
        const m = gauge(w, s);
        assertValid(m, 'thickness gauge');
        return toMeshData(m);
      }
      const c = tabCtx(spec.tab, ctx);
      const l = fitTabLayout(c);
      const all = s.t(w.Manifold.union([tab(w, s, c, spec.tab), ...mountSolids(w, s, l, c)]));
      return posed(s, all, l, 'fit test tab');
    } finally {
      s.dispose();
    }
  },
};
