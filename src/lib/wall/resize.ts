/**
 * Resizing an attachment by dragging its edges in the board editor (components/WallEditor.tsx). Every kind has its
 * own options, so which one sizes a part is the kind's own say (AttachmentUi.resize) or the first of the usual names
 * (width, length, cells, columns, count across; height, back, rows up) that it has; either way it's tried: a little
 * more of it, and the kind's layout says how much wider or taller the part gets (`per`), which turns a drag into an
 * option's value. A length moves smoothly, a count (cells, hooks, slots) in whole steps.
 */
import type { AttachmentDef, AttachmentField, MountCtx } from './registry';
import type { AttachmentUi } from './uiRegistry';
import { partBounds } from './mount';

/** An option that sizes the part along one axis: about `per` mm of the part per unit of the option. */
export interface ResizeAxis {
  key: string;
  per: number;
  /** Whole steps of this size (counts); 0: any value. */
  step: number;
  min: number;
  max: number;
}

type Sized = Extract<AttachmentField, { kind: 'length' | 'number' }>;

/** The usual names of the options that size a part across and up the board, most likely first. */
const USUAL = {
  w: ['width', 'length', 'cellsX', 'cells', 'columns', 'count'],
  h: ['height', 'back', 'cellsY', 'rows', 'tiers', 'units'],
} as const;

/** The part's front view size (its body and mounts), mm. */
function frontSize(def: AttachmentDef<object>, o: object, ctx: MountCtx): { w: number; h: number } {
  const b = partBounds(def.layout(o, ctx), ctx);
  return { w: b.x1 - b.x0, h: b.y1 - b.y0 };
}

/** The options that size a part across and up the board, as it is now (null: none does). */
export function resizeAxes(def: AttachmentDef<object>, ui: AttachmentUi | null, opts: object, ctx: MountCtx): { w: ResizeAxis | null; h: ResizeAxis | null } {
  const o = def.sanitize(opts) as Record<string, unknown>;
  const base = frontSize(def, o, ctx);
  const shown = (f: AttachmentField) => !f.when || (f.when as (v: object) => boolean)(o);
  const sized = (ui?.fields ?? []).filter((f): f is Sized => (f.kind === 'length' || f.kind === 'number') && shown(f));
  /** How much the part grows across and up per unit of an option, here (null: it doesn't move, or can't). */
  const rate = (f: Sized) => {
    const v = Number(o[f.key]);
    if (!Number.isFinite(v)) return null;
    const step = f.kind === 'number' ? (f.step ?? 1) : 0;
    // A little more (or less, at the top of its range): a step, or 10 mm.
    const d = step || 10;
    const o2 = def.sanitize({ ...o, [f.key]: v + d <= f.max ? v + d : v - d }) as Record<string, unknown>;
    const dv = Number(o2[f.key]) - v;
    if (!dv) return null;
    const s2 = frontSize(def, o2, ctx);
    return { step, w: (s2.w - base.w) / dv, h: (s2.h - base.h) / dv };
  };
  const axis = (a: 'w' | 'h'): ResizeAxis | null => {
    const b = a === 'w' ? 'h' : 'w';
    const names = ui?.resize?.[a] !== undefined ? [ui.resize[a]] : USUAL[a];
    for (const key of names) {
      const f = key ? sized.find((q) => q.key === key) : undefined;
      const r = f && rate(f);
      // It sizes that way, and hardly the other.
      if (f && r && r[a] >= 0.3 && Math.abs(r[b]) <= 0.25 * r[a]) return { key: f.key, per: r[a], step: r.step, min: f.min, max: f.max };
    }
    return null;
  };
  return { w: axis('w'), h: axis('h') };
}

/** The options for a part `dw` wider and `dh` taller than with `opts` (mm), on the axes found by resizeAxes. */
export function resized(
  def: AttachmentDef<object>,
  opts: object,
  axes: { w: ResizeAxis | null; h: ResizeAxis | null },
  dw: number,
  dh: number,
): Record<string, unknown> {
  const o = def.sanitize(opts) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [a, d] of [
    [axes.w, dw],
    [axes.h, dh],
  ] as const) {
    if (!a || !d) continue;
    let v = Number(o[a.key]) + d / a.per;
    v = a.step ? Math.round(v / a.step) * a.step : Math.round(v * 2) / 2;
    patch[a.key] = Math.min(a.max, Math.max(a.min, Math.round(v * 1000) / 1000));
  }
  return patch;
}
