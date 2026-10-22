/**
 * What the first screen needs of a board's attachments' planning: the slot
 * math for dragging them in the 3D view (App.tsx, components/wallDrag.ts) and
 * whether a board's meshes print in a second filament (project.ts). The rest
 * of it (plan.ts, which re-exports these) loads with the first board.
 */
import type { Vec2 } from '../geometry/kernel';
import type { MeshSpec } from '../project';
import { attachmentDef, type AttachmentLayout, type MountCtx } from './registry';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A slot's key in a board's set of them (slotKeys). */
export const keyOf = (x: number, y: number) => `${r2(x)},${r2(y)}`;

/** Whether every mount of `layout` lands on a slot when its anchor is at (x, y). */
export function fitsAt(slots: ReadonlySet<string>, layout: Pick<AttachmentLayout, 'mounts'>, ctx: Pick<MountCtx, 'pitch'>, x: number, y: number): boolean {
  return layout.mounts.every((m) => slots.has(keyOf(x + m.di * ctx.pitch, y + m.dj * ctx.pitch)));
}

export const slotKeys = (slots: Vec2[]): Set<string> => new Set(slots.map(([x, y]) => keyOf(x, y)));

/** The slot nearest (x, y) where the whole layout fits, or null. */
export function snapAnchor(
  slots: Vec2[],
  keys: ReadonlySet<string>,
  layout: Pick<AttachmentLayout, 'mounts'>,
  ctx: Pick<MountCtx, 'pitch'>,
  x: number,
  y: number,
): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const s of slots) {
    const d = (s[0] - x) ** 2 + (s[1] - y) ** 2;
    if (d < bestD && fitsAt(keys, layout, ctx, s[0], s[1])) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** The slot nearest (x, y), or null on a board without slots. */
export function nearestSlot(slots: Vec2[], x: number, y: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const s of slots) {
    const d = (s[0] - x) ** 2 + (s[1] - y) ** 2;
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/**
 * Where an attachment dragged to (x, y) goes: the nearest slot where it fits, if one is near (within three lattice
 * steps), else the slot under the pointer, so it follows the drag even where it doesn't fit (it shows red there).
 */
export function dragAnchor(
  slots: Vec2[],
  keys: ReadonlySet<string>,
  layout: Pick<AttachmentLayout, 'mounts'>,
  ctx: Pick<MountCtx, 'pitch'>,
  x: number,
  y: number,
): { at: Vec2; fits: boolean } | null {
  const near = slots.filter((s) => Math.hypot(s[0] - x, s[1] - y) <= 3 * ctx.pitch);
  const fit = snapAnchor(near, keys, layout, ctx, x, y);
  if (fit) return { at: fit, fits: true };
  const at = nearestSlot(slots, x, y);
  return at ? { at, fits: false } : null;
}

/**
 * Whether a board's mesh has bodies that print in filament 2 with multi-colour off: an attachment's inlaid label or its
 * kind's own inlays (AttachmentDef.inlaid), a tile's inlaid zone text.
 */
export function wallInlaid(spec: MeshSpec | undefined): boolean {
  if (spec?.kind === 'attachment') return spec.extras?.label?.style === 'inlaid' || !!attachmentDef(spec.type)?.inlaid?.(spec.opts);
  return spec?.kind === 'piece' && spec.enclosure?.kind === 'skadis' && !!spec.enclosure.tile.text?.some((t) => t.inlay);
}
