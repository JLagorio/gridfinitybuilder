/**
 * Arranging a board's attachments in the board editor (components/WallEditor.tsx, WallPanel.tsx, App's 3D drag):
 * moving several together, lining them up and spacing them out, the guides shown while dragging, and where copies
 * go. Parts hang on slots, so everything here moves anchors from slot to slot: a group by the same lattice steps
 * for all (it keeps its shape, and every part stays on its slots), a part being lined up to the slot that brings
 * its edge nearest the line. Plain math on plan.ts's placements; state/wall.ts makes the edits.
 */
import type { Vec2 } from '../geometry/kernel';
import { fitsAt, nearestFit, nearestSlot, onBoard, overlaps, slotKeys, type Box, type WallBoard, type WallPlacement } from './plan';

/** Where a part goes: its anchor slot, and whether all its mounts find slots there. */
export interface Move {
  id: string;
  x: number;
  y: number;
  fits: boolean;
}

type Board = Pick<WallBoard, 'slots' | 'ctx' | 'hex'>;
type Part = Pick<WallPlacement, 'id' | 'x' | 'y' | 'layout'>;
type Placed = Part & Box;

/** Each board's slots by where they are (to the hundredth of a mm), made once. */
const bySpot = new WeakMap<readonly Vec2[], Map<string, Vec2>>();
const spot = (x: number, y: number) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;

/** The slot at (x, y), if there is one. */
function slotAt(slots: Vec2[], x: number, y: number): Vec2 | undefined {
  let m = bySpot.get(slots);
  if (!m) bySpot.set(slots, (m = new Map(slots.map((s) => [spot(s[0], s[1]), s]))));
  return m.get(spot(x, y));
}

/** The slot at (x, y), else the nearest (null: a board without slots). */
const slotNear = (slots: Vec2[], x: number, y: number): Vec2 | null => slotAt(slots, x, y) ?? nearestSlot(slots, x, y);

/** A front view moved by (dx, dy). */
const shift = (b: Box, dx: number, dy: number): Box => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });

/**
 * A part's anchor taken to near (x, y): the slot nearest there, and whether it fits on it. Off the slots (off the
 * board) it doesn't: it would have left its place in the group. On a board of hexagons, whose slots aren't in line
 * from one to the next, a slot within a lattice step will do.
 */
function land(board: Board, keys: ReadonlySet<string>, p: Part, x: number, y: number): (Move & { on: boolean }) | null {
  const at = slotNear(board.slots, x, y);
  if (!at) return null;
  const on = Math.hypot(at[0] - x, at[1] - y) <= (board.hex ? board.ctx.pitch : 0.01);
  return { id: p.id, x: at[0], y: at[1], fits: on && fitsAt(keys, p.layout, board.ctx, at[0], at[1]), on };
}

/**
 * Each part (of `ids`; default: all) that doesn't fit where it is to the nearest spot where it does (plan.ts
 * nearestFit: on the board and clear of the rest when there's one), one after another, so two don't go to the same
 * place. Only the parts that move.
 */
export function fitMoves(
  board: Pick<WallBoard, 'slots' | 'ctx' | 'W' | 'H' | 'rim'>,
  placed: readonly WallPlacement[],
  ids?: readonly string[],
): { id: string; x: number; y: number }[] {
  const keys = slotKeys(board.slots);
  // Lock keys included.
  const boxes = new Map<string, Box>(placed.map((p) => [p.id, { x0: p.x0, y0: p.y0, x1: p.x1, y1: p.top ?? p.y1 }]));
  const out: { id: string; x: number; y: number }[] = [];
  for (const p of placed) {
    if (p.ok || (ids && !ids.includes(p.id))) continue;
    const b = boxes.get(p.id)!;
    const rest = [...boxes].flatMap(([id, q]) => (id === p.id ? [] : [q]));
    const at = nearestFit(board, keys, p, b, rest);
    if (!at) continue;
    boxes.set(p.id, shift(b, at[0] - p.x, at[1] - p.y));
    out.push({ id: p.id, x: at[0], y: at[1] });
  }
  return out;
}

/**
 * Every part moved by (dx, dy), each to the slot nearest where that takes its anchor (on one lattice, exactly
 * there; off the slots it doesn't fit).
 */
export function groupMove(board: Board, keys: ReadonlySet<string>, parts: readonly Part[], dx: number, dy: number): Move[] {
  return parts.flatMap((p) => {
    const m = land(board, keys, p, p.x + dx, p.y + dy);
    return m ? [{ id: m.id, x: m.x, y: m.y, fits: m.fits }] : [];
  });
}

/**
 * A group dragged by one of its parts (`held`), that one's anchor to near (x, y), all of them by the same steps so
 * every part stays on slots: the nearest such spot within three lattice steps where every part fits, else where the
 * held one does, else any (red where they don't fit). Null where the group can't go near there whole (off the
 * board: it stays where it was), or `held` isn't in it.
 */
export function dragGroup(board: Board, keys: ReadonlySet<string>, parts: readonly Part[], held: string, x: number, y: number): Move[] | null {
  const h = parts.find((p) => p.id === held);
  if (!h) return null;
  const by = (s: Vec2) => Math.hypot(s[0] - x, s[1] - y);
  const near = board.slots.filter((s) => by(s) <= 3 * board.ctx.pitch).sort((a, b) => by(a) - by(b));
  let best: { moves: Move[]; rank: number } | null = null;
  for (const s of near) {
    // (On one lattice, every anchor on a slot exactly: a quick look first.)
    if (!board.hex && !parts.every((p) => slotAt(board.slots, p.x + s[0] - h.x, p.y + s[1] - h.y))) continue;
    const landed = parts.map((p) => land(board, keys, p, p.x + s[0] - h.x, p.y + s[1] - h.y));
    if (!landed.every((m) => m?.on)) continue;
    const moves = landed.map((m) => ({ id: m!.id, x: m!.x, y: m!.y, fits: m!.fits }));
    if (moves.every((m) => m.fits)) return moves;
    const rank = moves.find((m) => m.id === held)!.fits ? 1 : 2;
    if (!best || rank < best.rank) best = { moves, rank };
  }
  return best?.moves ?? null;
}

/** Whether one list of numbers sorts before another (the first that differs decides). */
function less(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * A part's anchor to the slot nearest `want` along one axis (x: across, y: up), keeping off the line it's on by
 * at most a lattice step (on a staggered pattern the next row over may have a slot in just the right place):
 * nearest the line first, then one where it fits, then one clear of `others`, then the least sideways.
 */
function slotAlong(board: Board, keys: ReadonlySet<string>, p: Placed, axis: 'x' | 'y', want: number, others: readonly Box[]): Move | null {
  const a = axis === 'x' ? 0 : 1;
  const b = 1 - a;
  const from = [p.x, p.y];
  let best: { s: Vec2; key: number[] } | null = null;
  for (const s of board.slots) {
    const side = Math.abs(s[b] - from[b]);
    const off = Math.round(Math.abs(s[a] - want) * 100);
    if (side > board.ctx.pitch + 1e-6 || (best && off > best.key[0])) continue;
    const fits = fitsAt(keys, p.layout, board.ctx, s[0], s[1]);
    const moved = shift(p, s[0] - p.x, s[1] - p.y);
    // Ties: up before down (across), right before left (up).
    const key = [off, fits ? 0 : 1, others.some((q) => overlaps(moved, q)) ? 1 : 0, Math.round(side * 100), -s[b]];
    if (!best || less(key, best.key)) best = { s, key };
  }
  return best && { id: p.id, x: best.s[0], y: best.s[1], fits: !best.key[1] };
}

/** Parts each to the slot nearest its target along an axis (slotAlong), one after another, clear of `others` and of each other where they can be. */
function along(board: Board, keys: ReadonlySet<string>, parts: readonly Placed[], axis: 'x' | 'y', want: Map<string, number>, others: readonly Box[]): Move[] {
  const boxes = new Map<string, Box>(parts.map((p) => [p.id, p]));
  const out: Move[] = [];
  for (const p of parts) {
    const w = want.get(p.id);
    if (w === undefined) continue;
    const rest = [...others, ...[...boxes].flatMap(([id, q]) => (id === p.id ? [] : [q]))];
    const m = slotAlong(board, keys, p, axis, w, rest);
    if (!m || (m.x === p.x && m.y === p.y)) continue;
    boxes.set(p.id, shift(p, m.x - p.x, m.y - p.y));
    out.push(m);
  }
  return out;
}

/** How to line parts up: by their left, centre or right edges (across), or top, middle or bottom (up). */
export type AlignHow = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

const AXIS: Record<AlignHow, 'x' | 'y'> = { left: 'x', centre: 'x', right: 'x', top: 'y', middle: 'y', bottom: 'y' };

/** A part's edge (or centre) that lines up. */
function edge(p: Box, how: AlignHow): number {
  if (how === 'left') return p.x0;
  if (how === 'right') return p.x1;
  if (how === 'centre') return (p.x0 + p.x1) / 2;
  if (how === 'bottom') return p.y0;
  if (how === 'top') return p.y1;
  return (p.y0 + p.y1) / 2;
}

/**
 * Line parts up with the box round them all (its left edge, centre, …): each to the slot that brings its edge
 * nearest the line, clear of `others` (the board's other parts) where it can be. Only the parts that move.
 */
export function align(board: Board, keys: ReadonlySet<string>, parts: readonly Placed[], how: AlignHow, others: readonly Box[] = []): Move[] {
  if (parts.length < 2) return [];
  const line = edge(bounds(parts), how);
  const axis = AXIS[how];
  const want = new Map<string, number>();
  for (const p of parts) if (Math.abs(line - edge(p, how)) >= 0.01) want.set(p.id, (axis === 'x' ? p.x : p.y) + line - edge(p, how));
  return along(board, keys, parts, axis, want, others);
}

/**
 * Space three or more parts out evenly across (x) or up (y): the outermost two stay, the gaps between them all come
 * out the same, each part to the slot nearest its share, clear of `others` where it can be. Only the parts that move.
 */
export function distribute(board: Board, keys: ReadonlySet<string>, parts: readonly Placed[], axis: 'x' | 'y', others: readonly Box[] = []): Move[] {
  if (parts.length < 3) return [];
  const lo = (p: Box) => (axis === 'x' ? p.x0 : p.y0);
  const size = (p: Box) => (axis === 'x' ? p.x1 - p.x0 : p.y1 - p.y0);
  const order = [...parts].sort((p, q) => lo(p) + size(p) / 2 - (lo(q) + size(q) / 2));
  const last = order[order.length - 1];
  const gap = (lo(last) + size(last) - lo(order[0]) - order.reduce((t, p) => t + size(p), 0)) / (order.length - 1);
  const want = new Map<string, number>();
  let at = lo(order[0]);
  order.forEach((p, i) => {
    const off = at - lo(p);
    at += size(p) + gap;
    if (i > 0 && i < order.length - 1 && Math.abs(off) >= 0.01) want.set(p.id, (axis === 'x' ? p.x : p.y) + off);
  });
  return along(board, keys, order, axis, want, others);
}

/** The box round several front views. */
export function bounds(boxes: readonly Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** A guide line: across (axis y, at a height) or up (axis x, at a distance across), from one end to the other. */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}

/** A gap to a neighbour: along the axis from one edge to the other, drawn level with both (`at`), and how wide, mm. */
export interface Gap {
  axis: 'x' | 'y';
  from: number;
  to: number;
  at: number;
  mm: number;
}

/**
 * While dragging: a line wherever the dragged box's edges or centre line up with another part's (within `tol` mm),
 * and the gap to its nearest neighbour on each side among the parts level with it.
 */
export function dragGuides(moving: Box, others: readonly Box[], tol = 0.5): { lines: Guide[]; gaps: Gap[] } {
  const lines: Guide[] = [];
  const gaps: Gap[] = [];
  for (const axis of ['x', 'y'] as const) {
    const [lo, hi, plo, phi] = axis === 'x' ? (['x0', 'x1', 'y0', 'y1'] as const) : (['y0', 'y1', 'x0', 'x1'] as const);
    const marks = (b: Box) => [b[lo], (b[lo] + b[hi]) / 2, b[hi]];
    for (const q of others)
      for (const m of marks(moving))
        if (marks(q).some((v) => Math.abs(v - m) <= tol)) {
          const from = Math.min(moving[plo], q[plo]);
          const to = Math.max(moving[phi], q[phi]);
          const same = lines.find((g) => g.axis === axis && Math.abs(g.at - m) <= tol);
          if (same) [same.from, same.to] = [Math.min(same.from, from), Math.max(same.to, to)];
          else lines.push({ axis, at: m, from, to });
        }
    // Neighbours level with it (their spans across the axis overlap), on either side.
    const level = others.filter((q) => q[plo] < moving[phi] && q[phi] > moving[plo]);
    const before = level.filter((q) => q[hi] <= moving[lo] + tol).sort((p, q) => q[hi] - p[hi])[0];
    const after = level.filter((q) => q[lo] >= moving[hi] - tol).sort((p, q) => p[lo] - q[lo])[0];
    for (const [q, from, to] of [
      [before, before?.[hi], moving[lo]],
      [after, moving[hi], after?.[lo]],
    ] as const) {
      if (!q || to! - from! < 0.05) continue;
      const at = (Math.max(q[plo], moving[plo]) + Math.min(q[phi], moving[phi])) / 2;
      gaps.push({ axis, from: from!, to: to!, at, mm: Math.round((to! - from!) * 10) / 10 });
    }
  }
  return { lines, gaps };
}

/** Something to paste: its anchor where it was copied, and its front view (lock keys included) as it would be on this board, from its anchor. */
export interface PasteItem {
  x: number;
  y: number;
  layout: WallPlacement['layout'];
  /** Its front view with its anchor at (0, 0). */
  box: Box;
}

/**
 * Where copies go: their anchors as far apart as the originals', the first's on the slot nearest `near` where every
 * one fits, is on the board and clear of `others` (and of each other); failing that, the nearest where they all fit;
 * failing that, at `near` (they show red there). One anchor per item; null on a board without slots.
 */
export function pasteSpot(
  board: Pick<WallBoard, 'slots' | 'ctx' | 'W' | 'H' | 'rim'>,
  keys: ReadonlySet<string>,
  items: readonly PasteItem[],
  others: readonly Box[],
  near: Vec2,
): Vec2[] | null {
  if (!items.length || !board.slots.length) return null;
  const [fx, fy] = [items[0].x, items[0].y];
  const at = (s: Vec2) => items.map((it) => [s[0] + it.x - fx, s[1] + it.y - fy] as Vec2);
  const onSlots = (spots: Vec2[]) => spots.map(([x, y]) => slotNear(board.slots, x, y)!);
  const by = (s: Vec2) => Math.hypot(s[0] - near[0], s[1] - near[1]);
  let fit: Vec2[] | null = null;
  for (const s of [...board.slots].sort((a, b) => by(a) - by(b))) {
    const spots = at(s);
    // On one lattice the copies land on slots exactly; anywhere else they would lose their places in the group.
    if (!spots.every(([x, y], i) => keys.has(spot(x, y)) && fitsAt(keys, items[i].layout, board.ctx, x, y))) continue;
    fit ??= spots;
    const boxes = spots.map(([x, y], i) => shift(items[i].box, x, y));
    if (boxes.every((b, i) => onBoard(b, board) && !others.some((q) => overlaps(b, q)) && !boxes.slice(0, i).some((q) => overlaps(b, q))))
      return onSlots(spots);
  }
  return onSlots(fit ?? at(slotNear(board.slots, near[0], near[1])!));
}
