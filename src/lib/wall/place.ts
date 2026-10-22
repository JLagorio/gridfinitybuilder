/**
 * Placing a board's attachments (plan.ts has what each needs): each on the slot it was put on, checked (its mounts
 * find slots, it's on the board, clear of the others and the frame), the nearest spot it would fit where it doesn't,
 * and where its mesh goes in the drawer view. Loaded with the kinds (kinds/all.ts loads parts.ts, which uses it) and by
 * the board editors, so it isn't on the first screen.
 */
import type { Vec2 } from '../geometry/kernel';
import { lockKey, mountBox, partBounds, printedSize, siteAt, viewTurn } from './mount';
import { attachmentDef, type AttachmentDef, type MountCtx, type PlacedAttachment } from './index';
import { attachmentLayout, fitsAt, keyOf, labelRelief, nearestSlot, planExtras, slotKeys, snapAnchor, type WallBoard, type WallPlacement } from './plan';
import { holding } from './follow';
import type { NamedDrawer } from '../project';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A warning when an attachment is meant to hold more than its mounts take, or null. */
export type LoadNote = (a: PlacedAttachment, def: AttachmentDef<object>, opts: object, ctx: MountCtx, has?: (x: number, y: number) => boolean) => string | null;

let loadNote: LoadNote | null = null;

/** The load check (load.ts) sets this as it loads, with the kinds: it stays off the first screen. */
export function setLoadNote(f: LoadNote): void {
  loadNote = f;
}

/** A part's front view on the board, wall coordinates. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Whether two front views overlap (by more than half a millimetre). */
export const overlaps = (p: Box, q: Box) => p.x0 < q.x1 - 0.5 && q.x0 < p.x1 - 0.5 && p.y0 < q.y1 - 0.5 && q.y0 < p.y1 - 0.5;

/** Whether a front view is on the board, off its frame's rim. */
export const onBoard = (b: Box, board: Pick<WallBoard, 'W' | 'H' | 'rim'>, r = board.rim ?? 0) =>
  b.x0 > r - 0.5 && b.y0 > r - 0.5 && b.x1 < board.W - r + 0.5 && b.y1 < board.H - r + 0.5;

/**
 * The nearest slot to a part's anchor where it would fit (its anchor there): on the board and clear of `others` when
 * there's one, else the nearest where its mounts all find slots; null: nowhere. `box`: its front view where it is.
 */
export function nearestFit(
  board: Pick<WallBoard, 'slots' | 'ctx' | 'W' | 'H' | 'rim'>,
  keys: ReadonlySet<string>,
  p: Pick<WallPlacement, 'x' | 'y' | 'layout'>,
  box: Box,
  others: readonly Box[],
): Vec2 | null {
  let fit: Vec2 | null = null;
  let clear: Vec2 | null = null;
  let df = Infinity;
  let dc = Infinity;
  for (const s of board.slots) {
    const dx = s[0] - p.x;
    const dy = s[1] - p.y;
    const d = dx * dx + dy * dy;
    if (d >= dc || !fitsAt(keys, p.layout, board.ctx, s[0], s[1])) continue;
    if (d < df) [fit, df] = [s, d];
    const b = { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy };
    if (onBoard(b, board) && !others.some((q) => overlaps(b, q))) [clear, dc] = [s, d];
  }
  return clear ?? fit;
}

/**
 * Plans a board's attachments. Each stays on the slot it was put on (its anchor; one saved off the slots, from
 * before the board changed, goes to the nearest): where its mounts don't all find slots there it isn't ok, shows
 * red, and `fit` says the nearest spot where it would fit, for the board editor to offer. With the project's
 * `drawers`, one that holds a bin is sized from it (follow.ts).
 */
export function placeAttachments(
  list: readonly PlacedAttachment[],
  board: WallBoard,
  drawers?: readonly NamedDrawer[],
): { placed: WallPlacement[]; warnings: string[] } {
  const keys = slotKeys(board.slots);
  const warnings: string[] = [];
  const placed: WallPlacement[] = [];
  // How high each takes the board (its lock keys stand above it), wall y.
  const tops: number[] = [];
  for (const own of list) {
    const held = drawers && holding(own, drawers);
    const a = held ? { ...own, opts: held.opts } : own;
    const def = attachmentDef(a.type);
    const l = attachmentLayout(a, board.ctx);
    if (!def || !l) {
      warnings.push(`An attachment of a kind this version doesn't know (“${a.type}”) is left out.`);
      continue;
    }
    const name = a.name?.trim() || def.summary(l.opts as never);
    if (held?.note) warnings.push(`${name}: ${held.note}`);
    const on = keys.has(keyOf(a.x, a.y));
    // Saved before parts stayed where they're put (PlacedAttachment.snap): on the nearest slot where it fits, as then.
    const was = a.snap && !(on && fitsAt(keys, l.layout, board.ctx, a.x, a.y)) ? snapAnchor(board.slots, keys, l.layout, board.ctx, a.x, a.y) : null;
    const at = was ?? (on ? ([a.x, a.y] as Vec2) : nearestSlot(board.slots, a.x, a.y));
    const ok = !!at && fitsAt(keys, l.layout, board.ctx, at[0], at[1]);
    const [x, y] = at ?? [a.x, a.y];
    const ox = x - l.layout.anchor[0];
    const oy = y - l.layout.anchor[1];
    for (const msg of def.notes?.(l.opts as never, board.ctx) ?? []) warnings.push(`${name}: ${msg}`);
    // Its common options: bolts go through slots the board has.
    const has = ok ? (px: number, py: number) => keys.has(keyOf(ox + px, oy + py)) : undefined;
    const e = planExtras(a, def, l.opts, l.layout, board.ctx, has);
    for (const msg of e.notes) warnings.push(`${name}: ${msg}`);
    // More than its mounts take.
    const heavy = loadNote?.(a, def, l.opts, board.ctx, has);
    if (heavy) warnings.push(`${name}: ${heavy}`);
    const layout = e.layout;
    const b = partBounds(layout, board.ctx);
    // Lock keys stand on the board above it.
    const hooks = e.lock ? layout.mounts.filter((m) => m.kind === 'hook') : [];
    tops.push(Math.max(oy + b.y1, ...hooks.map((m) => oy + lockKey(siteAt(layout, m, board.ctx), board.ctx).top)));
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
      mounts: layout.mounts.map((m) => {
        const [mx, my] = siteAt(layout, m, board.ctx);
        return { x: r2(ox + mx), y: r2(oy + my), kind: m.kind };
      }),
      layout,
      opts: l.opts,
      ...(e.extras ? { extras: e.extras } : {}),
      ...(e.lock ? { lock: true } : {}),
      ...(tops[tops.length - 1] > oy + b.y1 + 0.01 ? { top: r2(tops[tops.length - 1]) } : {}),
    });
  }
  const boxes = placed.map((p, i) => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: tops[i] }));
  // One that doesn't fit where it is: the nearest spot where it would (first in the list, being the thing to fix).
  const misfits: string[] = [];
  placed.forEach((p, i) => {
    if (p.ok) return;
    p.fit = nearestFit(
      board,
      keys,
      p,
      boxes[i],
      boxes.filter((_, j) => j !== i),
    );
    misfits.push(
      p.fit
        ? `${p.name} doesn't fit where it is: its mounts don't all find slots there. Drag it, or move it to the nearest spot that fits.`
        : `${p.name} doesn't fit anywhere on this board: no spot has slots for all its mounts${board.hex ? ' (each hexagon has slots of its own, so it must fit on one)' : ''}. Make it narrower or shorter.`,
    );
  });
  warnings.unshift(...misfits);
  // Two in the same place (lock keys included).
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) if (overlaps(boxes[i], boxes[j])) warnings.push(`${placed[i].name} and ${placed[j].name} overlap.`);
  // A frame's rim stands proud of the front round the edge.
  const r = board.rim ?? 0;
  placed.forEach((p, i) => {
    if (r && (p.x0 < r || p.y0 < r || p.x1 > board.W - r || tops[i] > board.H - r)) warnings.push(`${p.name} stands on the frame: move it in from the edge.`);
  });
  // A clip needs room behind the board for its barbs.
  if (placed.some((p) => p.mounts.some((m) => m.kind === 'clip' || m.kind === 'hook'))) {
    const reach = Math.max(...placed.flatMap((p) => p.mounts.map((m) => -mountBox(m.kind, [0, 0], board.ctx).z0 - board.ctx.t)));
    if (board.ctx.behind < reach - 1e-6)
      warnings.push(`The clips and hooks reach ${r2(reach)} mm behind the board: hang it on standoffs (Off the wall on), or they'll hit the wall.`);
  }
  return { placed, warnings };
}

/** Its printed size, and the turn and min corner that put its mesh where it hangs in the drawer view. */
export function attachmentView(
  p: WallPlacement,
  board: WallBoard,
): { size: { w: number; d: number; h: number }; turn: [number, number, number]; at: [number, number, number] } {
  const b = partBounds(p.layout, board.ctx);
  const ox = p.x - p.layout.anchor[0];
  const oy = p.y - p.layout.anchor[1];
  // A raised label stands out past its front (or top): the print is that much bigger, the min corner the same.
  const r = labelRelief(p.extras, p.layout);
  return {
    size: printedSize(r.dz || r.dy ? { ...p.layout, depth: p.layout.depth + r.dz, h: p.layout.h + r.dy } : p.layout, board.ctx),
    turn: viewTurn(p.layout.pose),
    at: [r2(ox + b.x0), r2(oy + b.y0), r2(board.front + b.z0)],
  };
}
