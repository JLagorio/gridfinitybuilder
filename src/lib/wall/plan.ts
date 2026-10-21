/**
 * Planning attachments on a board: each one snapped to the slots its mounts
 * need, checked, and turned into parts and meshes for the print job and items
 * for the drawer view (project.ts planParts calls planWallParts for a board).
 */
import type { Vec2 } from '../geometry/kernel';
import type { SkadisOptions, SkadisPlan } from '../geometry/skadis';
import { boardSlots, tileOutlines } from '../geometry/skadis';
import { mountBox, partBounds, printedSize, siteAt, viewTurn } from './mount';
import { attachmentDef, type AttachmentLayout, type MountCtx, type MountKind, type PlacedAttachment } from './index';

const r2 = (v: number) => Math.round(v * 100) / 100;
const keyOf = (x: number, y: number) => `${r2(x)},${r2(y)}`;

/** A board as attachments see it (wall coordinates). */
export interface WallBoard {
  /** The space, mm. */
  W: number;
  H: number;
  /** Every usable slot's centre. */
  slots: Vec2[];
  ctx: MountCtx;
  /** Tile outlines, for drawing. */
  outlines: Vec2[][];
  /** Height of the board's front in the drawer view (it lies face up on its standoffs). */
  front: number;
}

export function wallBoard(plan: SkadisPlan, o: SkadisOptions): WallBoard {
  const behind = o.standoff === 'none' ? 0 : o.depth;
  return {
    W: o.width,
    H: o.height,
    slots: boardSlots(plan, o),
    ctx: { t: o.thickness, slotW: o.slotW, slotL: o.slotL, pitch: 20, fit: o.fit, behind },
    outlines: tileOutlines(plan, o),
    front: behind + o.thickness,
  };
}

/** An attachment where it ended up. */
export interface WallPlacement {
  id: string;
  type: string;
  name: string;
  /** Its anchor slot, snapped (wall coordinates). */
  x: number;
  y: number;
  /** Its front view on the wall, and how far it stands out. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  depth: number;
  /** Every mount on a slot of the board. */
  ok: boolean;
  /** Its mounts, wall coordinates. */
  mounts: { x: number; y: number; kind: MountKind }[];
  layout: AttachmentLayout;
  opts: object;
}

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

/** Each attachment's kind, cleaned options and layout (null: a kind that isn't registered). */
export function attachmentLayout(a: Pick<PlacedAttachment, 'type' | 'opts'>, ctx: MountCtx): { opts: object; layout: AttachmentLayout } | null {
  const def = attachmentDef(a.type);
  if (!def) return null;
  const opts = def.sanitize(a.opts);
  return { opts, layout: def.layout(opts, ctx) };
}

export function placeAttachments(list: readonly PlacedAttachment[], board: WallBoard): { placed: WallPlacement[]; warnings: string[] } {
  const keys = slotKeys(board.slots);
  const warnings: string[] = [];
  const placed: WallPlacement[] = [];
  for (const a of list) {
    const def = attachmentDef(a.type);
    const l = attachmentLayout(a, board.ctx);
    if (!def || !l) {
      warnings.push(`An attachment of a kind this version doesn't know (“${a.type}”) is left out.`);
      continue;
    }
    const name = a.name?.trim() || def.summary(l.opts as never);
    const at = snapAnchor(board.slots, keys, l.layout, board.ctx, a.x, a.y);
    const ok = !!at;
    if (!ok) warnings.push(`${name} doesn't fit on the board where it is: its mounts need slots that aren't there.`);
    const [x, y] = at ?? [a.x, a.y];
    const b = partBounds(l.layout, board.ctx);
    const ox = x - l.layout.anchor[0];
    const oy = y - l.layout.anchor[1];
    for (const msg of def.notes?.(l.opts as never, board.ctx) ?? []) warnings.push(`${name}: ${msg}`);
    placed.push({
      id: a.id,
      type: a.type,
      name,
      x,
      y,
      x0: r2(ox + b.x0),
      y0: r2(oy + b.y0),
      x1: r2(ox + b.x1),
      y1: r2(oy + b.y1),
      depth: l.layout.depth,
      ok,
      mounts: l.layout.mounts.map((m) => {
        const [mx, my] = siteAt(l.layout, m, board.ctx);
        return { x: r2(ox + mx), y: r2(oy + my), kind: m.kind };
      }),
      layout: l.layout,
      opts: l.opts,
    });
  }
  // Two in the same place.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const p = placed[i];
      const q = placed[j];
      if (p.x0 < q.x1 - 0.5 && q.x0 < p.x1 - 0.5 && p.y0 < q.y1 - 0.5 && q.y0 < p.y1 - 0.5) warnings.push(`${p.name} and ${q.name} overlap.`);
    }
  }
  // A clip needs room behind the board for its barbs.
  if (placed.some((p) => p.mounts.some((m) => m.kind === 'clip' || m.kind === 'hook'))) {
    const reach = Math.max(...placed.flatMap((p) => p.mounts.map((m) => -mountBox(m.kind, [0, 0], board.ctx).z0 - board.ctx.t)));
    if (board.ctx.behind < reach - 1e-6)
      warnings.push(`The clips and hooks reach ${r2(reach)} mm behind the board: hang it on standoffs (Off the wall on), or they'll hit the wall.`);
  }
  return { placed, warnings };
}

/** Mesh key text for an attachment: its kind, options and the board it's for. */
export const attachmentKey = (type: string, opts: object, ctx: MountCtx) => `att|${type}|${JSON.stringify(opts)}|${JSON.stringify(ctx)}`;

/** Its printed size, and the turn and min corner that put its mesh where it hangs in the drawer view. */
export function attachmentView(
  p: WallPlacement,
  board: WallBoard,
): { size: { w: number; d: number; h: number }; turn: [number, number, number]; at: [number, number, number] } {
  const b = partBounds(p.layout, board.ctx);
  const ox = p.x - p.layout.anchor[0];
  const oy = p.y - p.layout.anchor[1];
  return {
    size: printedSize(p.layout, board.ctx),
    turn: viewTurn(p.layout.pose),
    at: [r2(ox + b.x0), r2(oy + b.y0), r2(board.front + b.z0)],
  };
}
